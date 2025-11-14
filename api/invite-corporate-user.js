// /api/invite-corporate-user.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // 🔒 service role, mai esporla al frontend
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, companyName } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  try {
    // 1️⃣ Provo a creare l'utente (se esiste già, gestisco l'errore)
    let userId = null;

    const { data: createdUser, error: createErr } =
      await supabase.auth.admin.createUser({
        email,
        email_confirm: false, // lo conferma col magic link
      });

    if (createErr) {
      // Se l'utente esiste già, ignoro l'errore e continuo col magic link
      if (
        createErr.message?.includes('User already registered') ||
        createErr.status === 422
      ) {
        console.log('Utente già esistente, genero solo magic link');
      } else {
        throw createErr;
      }
    } else {
      userId = createdUser?.user?.id || null;
    }

    // 2️⃣ (Opzionale) aggiorno il profilo a corporate se hai la tabella profiles
    if (userId) {
      await supabase
        .from('profiles')
        .upsert(
          { user_id: userId, user_type: 'corporate' },
          { onConflict: 'user_id' }
        );
    }

    // 3️⃣ Genero magic link
    const { data: linkData, error: linkErr } =
      await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          // dopo il login, supabase ti manda qui
          redirectTo: `${process.env.APP_URL}/auth/callback.html`,
        },
      });

    if (linkErr) throw linkErr;

    const magicLink = linkData?.properties?.action_link;
    if (!magicLink) {
      throw new Error('Magic link non generato');
    }

    // 4️⃣ Mando email con il magic link (qui esempio con SendGrid o altro)
    await sendMagicLinkEmail({
      to: email,
      magicLink,
      companyName,
    });

    return res.json({ success: true, message: 'Magic link inviato' });
  } catch (err) {
    console.error('Errore invite-corporate-user:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function sendMagicLinkEmail({ to, magicLink, companyName }) {
  // Qui puoi usare SendGrid, Resend, Mailersend, quello che vuoi
  // Esempio: per ora solo log, così non esplode se non hai ancora il provider
  console.log('Invio magic link a:', to);
  console.log('Link:', magicLink);

  // Se vuoi usare SendGrid:
  
  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }],
          subject: `${companyName || 'La tua azienda'} - Accedi al questionario di benessere`,
        },
      ],
      from: { email: 'noreply@longevity-mvp.com', name: 'Longevity MVP' },
      content: [
        {
          type: 'text/html',
          value: `
            <h2>Ciao!</h2>
            <p>Sei stato invitato a compilare il questionario sulla salute e benessere.</p>
            <p>Clicca sul pulsante per accedere (non serve password):</p>
            <p>
              <a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#00c2ff;color:white;text-decoration:none;border-radius:8px;font-weight:600">
                🔗 Accedi al questionario
              </a>
            </p>
            <p style="color:#666;font-size:12px;margin-top:20px">
              Il link è valido per 1 ora. Se hai problemi, contatta HR.
            </p>
          `,
        },
      ],
    }),
  });
}