// /api/generate-corporate-report.js
// Genera report per questionario corporate e invia email all'admin

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'marcotempera23@gmail.com';
    
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }
  
    try {
      const { userId, userEmail, answers, domainScores, globalIndex } = req.body;
  
      if (!userId || !answers) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
  
      // 1. Genera report con LLM
      const prompt = buildCorporatePrompt({ answers, domainScores, globalIndex });
      const llmReport = await generateWithOpenAI({
        apiKey: OPENAI_API_KEY,
        prompt,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
      });
  
      // 2. Prepara dati per email
      const reportData = {
        userId,
        userEmail,
        submittedAt: new Date().toISOString(),
        answers,
        domainScores,
        globalIndex,
        llmReport
      };
  
      // 3. Invia email all'admin (se configurato)
      if (SENDGRID_API_KEY) {
        await sendEmailToAdmin({
          apiKey: SENDGRID_API_KEY,
          adminEmail: ADMIN_EMAIL,
          reportData
        });
      }
  
      return res.status(200).json({ 
        success: true,
        report: llmReport,
        message: 'Report generato e inviato all\'amministratore'
      });
  
    } catch (err) {
      console.error('Corporate report error:', err);
      return res.status(502).json({
        error: 'Errore generazione report corporate',
        details: err?.message || String(err)
      });
    }
  }
  
  /** Costruisce il prompt per il report corporate */
  function buildCorporatePrompt({ answers, domainScores, globalIndex }) {
    const domains = domainScores || {};
    
    return `Sei un medico specializzato in medicina del lavoro e benessere aziendale. Analizza i risultati di un questionario di salute compilato da un dipendente.
  
  ## DATI DIPENDENTE
  
  **Dati anagrafici**:
  - Sesso: ${answers.sesso || 'N/D'}
  - Età: ${answers.eta || 'N/D'}
  - Scolarità: ${answers.scolarita || 'N/D'}
  - Stato civile: ${answers.stato_civile || 'N/D'}
  
  **Indice globale di benessere**: ${globalIndex?.value?.toFixed(1) || 'N/D'}/5
  
  **Score per dominio** (scala 0-5):
  ${domains.physical_health ? `- Salute fisica: ${domains.physical_health.toFixed(1)}` : ''}
  ${domains.psychological ? `- Benessere psicologico: ${domains.psychological.toFixed(1)}` : ''}
  ${domains.social ? `- Relazioni e supporto: ${domains.social.toFixed(1)}` : ''}
  ${domains.environment ? `- Ambiente e risorse: ${domains.environment.toFixed(1)}` : ''}
  ${domains.pain_perception ? `- Dolore e salute percepita: ${domains.pain_perception.toFixed(1)}` : ''}
  
  ## RISPOSTE CHIAVE
  
  ${formatKeyAnswers(answers)}
  
  ---
  
  **GENERA UN REPORT CLINICO STRUTTURATO** per il datore di lavoro/medico aziendale che includa:
  
  1. **Executive Summary** (3-4 frasi)
     - Quadro generale dello stato di salute del dipendente
     - Livello di rischio complessivo (basso/medio/alto)
  
  2. **Analisi per Domini**
     Per ogni dominio con criticità evidenti:
     - Descrizione dello stato attuale
     - Fattori di rischio identificati
     - Impatto potenziale sulla capacità lavorativa
  
  3. **Segnali di Allarme** (se presenti)
     - Condizioni che richiedono attenzione immediata
     - Situazioni che potrebbero peggiorare senza intervento
  
  4. **Raccomandazioni Prioritarie**
     - 3-5 interventi consigliati per il datore di lavoro:
       * Visite specialistiche raccomandate
       * Programmi di wellness aziendale applicabili
       * Modifiche ergonomiche/organizzative
       * Supporto psicologico/coaching
  
  5. **Prognosi Lavorativa**
     - Idoneità attuale al lavoro (piena/con limitazioni/da valutare)
     - Aree di miglioramento per ottimizzare performance e benessere
  
  **FORMATO**: Markdown professionale, tono clinico ma comprensibile.
  **LUNGHEZZA**: 500-800 parole.
  **PRIVACY**: Usa solo codice dipendente, no nomi.`;
  }
  

  
  /** Chiamata a OpenAI */
  async function generateWithOpenAI({ apiKey, prompt, model }) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Sei un medico del lavoro esperto in valutazioni aziendali. Scrivi report clinici chiari, professionali e orientati all\'azione.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });
  
    if (!resp.ok) {
      const text = await resp.text().catch(() => '<no body>');
      throw new Error(`OpenAI API error ${resp.status}: ${text}`);
    }
  
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    
    if (!text) {
      throw new Error('OpenAI response parsing failed');
    }
    
    return text;
  }
  
  /** Invia email all'admin con SendGrid */
  async function sendEmailToAdmin({ apiKey, adminEmail, reportData }) {
    const { userEmail, submittedAt, llmReport, globalIndex, domainScores } = reportData;
  
    const htmlContent = `
      <h2>🏥 Nuovo Report Corporate - HealthInsight</h2>
      
      <div style="background:#f5f5f5;padding:20px;border-radius:8px;margin:20px 0">
        <h3>Informazioni Dipendente</h3>
        <p><strong>Email:</strong> ${userEmail}</p>
        <p><strong>Data compilazione:</strong> ${new Date(submittedAt).toLocaleString('it-IT')}</p>
        <p><strong>Score globale:</strong> ${globalIndex?.value?.toFixed(1) || 'N/D'}/5</p>
      </div>
  
      <div style="background:#fff;padding:20px;border:1px solid #ddd;border-radius:8px;margin:20px 0">
        <h3>📊 Score per Domini</h3>
        ${domainScores?.physical_health ? `<p>💪 Salute fisica: ${domainScores.physical_health.toFixed(1)}/5</p>` : ''}
        ${domainScores?.psychological ? `<p>🧠 Benessere psicologico: ${domainScores.psychological.toFixed(1)}/5</p>` : ''}
        ${domainScores?.social ? `<p>❤️ Relazioni: ${domainScores.social.toFixed(1)}/5</p>` : ''}
        ${domainScores?.environment ? `<p>🏠 Ambiente: ${domainScores.environment.toFixed(1)}/5</p>` : ''}
        ${domainScores?.pain_perception ? `<p>⚡ Dolore: ${domainScores.pain_perception.toFixed(1)}/5</p>` : ''}
      </div>
  
      <div style="background:#fff;padding:20px;border:1px solid #ddd;border-radius:8px;margin:20px 0">
        <h3>📄 Report Clinico</h3>
        <div style="white-space:pre-wrap;font-family:monospace;font-size:14px">
          ${llmReport}
        </div>
      </div>
  
      <hr style="margin:30px 0">
      <p style="color:#666;font-size:12px">
        Questo report è stato generato automaticamente da HealthInsight AI.
        Per accedere ai dettagli completi, visita il pannello amministratore.
      </p>
    `;
  
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: adminEmail }],
          subject: `📋 Nuovo Report Corporate - ${userEmail}`
        }],
        from: { email: 'noreply@healthinsight.com', name: 'HealthInsight System' },
        content: [{
          type: 'text/html',
          value: htmlContent
        }]
      })
    });
  
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('SendGrid error:', resp.status, text);
      throw new Error(`SendGrid error: ${resp.status}`);
    }
  
    return true;
  }