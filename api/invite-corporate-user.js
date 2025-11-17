// /api/invite-corporate-user.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verifica variabili d'ambiente
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing env vars:', {
      url: !!process.env.SUPABASE_URL,
      key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    });
    return res.status(500).json({ 
      error: 'Server configuration error',
      details: 'Missing Supabase credentials'
    });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  try {
    const { email, companyName } = req.body;

    // Validazione input
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ 
        error: 'Email non valida',
        details: 'Fornire un indirizzo email valido'
      });
    }

    // 1. Verifica se l'utente esiste già
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const userExists = existingUser?.users?.some(u => u.email === email);

    let userId;

    if (userExists) {
      // Utente già registrato
      const user = existingUser.users.find(u => u.email === email);
      userId = user.id;
      
      console.log(`✅ Utente esistente trovato: ${email}`);
    } else {
      // 2. Crea nuovo utente con password temporanea
      const tempPassword = Math.random().toString(36).slice(-16) + 'A1!';
      
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: false, // Richiede conferma email
        user_metadata: {
          company_name: companyName || '',
          invited_at: new Date().toISOString()
        }
      });

      if (createError) {
        console.error('❌ Errore creazione utente:', createError);
        throw createError;
      }

      userId = newUser.user.id;
      console.log(`✅ Nuovo utente creato: ${email}`);
    }

    // 3. Crea/Aggiorna profilo corporate
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        user_id: userId,
        user_type: 'corporate',
        company_name: companyName || null,
        updated_at: new Date().toISOString()
      }, { 
        onConflict: 'user_id',
        ignoreDuplicates: false 
      });

    if (profileError) {
      console.error('❌ Errore profilo:', profileError);
      // Non bloccare per questo - potrebbe non esistere la tabella
    }

    // 4. Genera Magic Link (IMPORTANTE: usa admin API)
    // Riga ~90
    const { data: magicLinkData, error: magicError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
        // FIX: Aggiungi https:// e usa il percorso corretto
        redirectTo: `https://${process.env.VERCEL_URL || 'localhost:3000'}/auth/callback.html`
        }
    });

    if (magicError) {
      console.error('❌ Errore generazione magic link:', magicError);
      throw magicError;
    }

    const magicLink = magicLinkData.properties?.action_link;

    if (!magicLink) {
      throw new Error('Magic link non generato');
    }

    console.log(`✅ Magic link generato per ${email}`);

    // 5. Invia email con Magic Link (OPZIONALE: usa SendGrid se configurato)
    if (process.env.SENDGRID_API_KEY) {
      try {
        await sendEmailWithSendGrid({
          apiKey: process.env.SENDGRID_API_KEY,
          to: email,
          magicLink,
          companyName
        });
        console.log(`✅ Email inviata a ${email}`);
      } catch (emailError) {
        console.warn('⚠️ Errore invio email, ma magic link generato:', emailError);
        // Non bloccare - il magic link è comunque valido
      }
    }

    // 6. Risposta di successo
    return res.status(200).json({
      success: true,
      message: 'Invito inviato con successo',
      email,
      userId,
      magicLink, // Includi per debug/test (RIMUOVI in produzione)
      companyName: companyName || null
    });

  } catch (error) {
    console.error('❌ Errore invite-corporate-user:', error);
    
    return res.status(500).json({
      error: 'Errore durante l\'invio dell\'invito',
      details: error.message,
      code: error.code || 'UNKNOWN_ERROR'
    });
  }
}

// Funzione helper per SendGrid (opzionale)
async function sendEmailWithSendGrid({ apiKey, to, magicLink, companyName }) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: to }],
        subject: '🏥 Invito a compilare il questionario aziendale'
      }],
      from: { 
        email: 'noreply@healthinsight.com', 
        name: 'HealthInsight Team' 
      },
      content: [{
        type: 'text/html',
        value: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <h1 style="color:#00c2ff">🏥 Questionario di Benessere Aziendale</h1>
            
            <p>Ciao,</p>
            
            <p>${companyName ? `<strong>${companyName}</strong> ti invita` : 'Sei stato invitato'} a compilare un questionario sul benessere lavorativo.</p>
            
            <p>Clicca sul pulsante qui sotto per accedere:</p>
            
            <div style="text-align:center;margin:30px 0">
              <a href="${magicLink}" 
                 style="display:inline-block;background:linear-gradient(90deg,#00c2ff,#0077ff);color:#0d1624;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">
                📋 Compila Questionario
              </a>
            </div>
            
            <p style="color:#666;font-size:12px">
              Questo link è valido per 24 ore e può essere usato una sola volta.<br>
              Se non hai richiesto questo invito, ignora questa email.
            </p>
            
            <hr style="margin:30px 0;border:none;border-top:1px solid #eee">
            
            <p style="color:#999;font-size:11px;text-align:center">
              © ${new Date().getFullYear()} HealthInsight - Piattaforma di Benessere Aziendale
            </p>
          </div>
        `
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SendGrid error: ${response.status} - ${errorText}`);
  }

  return true;
}