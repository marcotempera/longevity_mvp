// /api/generate-report.js
// Generazione report LLM (OpenAI) — Vercel Serverless (Node)

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
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY non configurata');
    return res.status(500).json({ 
      error: 'Missing OPENAI_API_KEY on server',
      hint: 'Configura la variabile d\'ambiente OPENAI_API_KEY nelle impostazioni Vercel'
    });
  }

  try {
    const { macroarea, yamlOutput, rawAnswers } = (req.body || {});
    if (!macroarea || !yamlOutput) {
      return res.status(400).json({ error: 'Missing required fields: macroarea, yamlOutput' });
    }

    // Normalizza/Default per evitare crash
    const safeYaml = {
      score: yamlOutput?.score ?? 0,
      riskClass: yamlOutput?.riskClass ?? 'pending',
      narrative: yamlOutput?.narrative ?? '',
      topDrivers: Array.isArray(yamlOutput?.topDrivers) ? yamlOutput.topDrivers : [],
      redFlags: Array.isArray(yamlOutput?.redFlags) ? yamlOutput.redFlags : [],
      actions: yamlOutput?.actions ?? {}
    };

    const prompt = buildPrompt(macroarea, safeYaml, rawAnswers || {});
    
    // ✅ USA UN MODELLO VALIDO (gpt-4o-mini è economico e veloce)
    const model = process.env.OPENAI_MODEL || 'gpt-5-nano';
    
    const report = await generateWithOpenAI({
      apiKey: OPENAI_API_KEY,
      prompt,
      model
    });

    return res.status(200).json({ report });
  } catch (err) {
    console.error('LLM API Error:', err);
    return res.status(502).json({
      error: 'Errore generazione report LLM',
      details: err?.message || String(err)
    });
  }
}

/** Costruisce il prompt per l'LLM (robusto ai campi mancanti) */
function buildPrompt(macroarea, yamlOutput, rawAnswers) {
  const { score, riskClass, narrative, topDrivers, redFlags, actions } = yamlOutput;

  const riskLabel =
    riskClass === 'low' ? 'basso' :
    riskClass === 'medium' ? 'moderato' :
    riskClass === 'high' ? 'alto' : 'da definire';

  const topDriversText = (topDrivers || [])
    .map((d, i) => {
      const feat = d?.feature ?? 'Fattore';
      const contr = d?.contribution ?? 'n/d';
      const expl = d?.explanation ?? '';
      return `${i + 1}. **${feat}** (contributo: ${contr})\n   - ${expl}`;
    })
    .join('\n\n');

  const redFlagsText = Array.isArray(redFlags) && redFlags.length > 0
    ? `\n## ⚠️ RED FLAGS (Segnali che richiedono attenzione)\n\n${
        redFlags.map((rf, i) => `${i + 1}. ${rf?.action || rf?.condition || 'Segnale da monitorare'}`).join('\n')
      }\n`
    : '';

  const actionsText = formatActions(actions);

  const macroareaLabel = macroarea.replace(/_/g, ' ');

  return `Sei un assistente medico specializzato in medicina preventiva. Il tuo compito è generare un report chiaro e comprensibile in italiano per un paziente, basato sui risultati di un questionario sulla macroarea: **${macroareaLabel}**.

## DATI DEL QUESTIONARIO

**Score totale**: ${score}/100  
**Classe di rischio**: ${riskClass} (${riskLabel})

**Narrativa generale**: ${narrative || '—'}

## TOP DRIVER (Fattori principali che influenzano lo score)

${topDriversText || 'Nessun driver principale identificato.'}

${redFlagsText}
## AZIONI CONSIGLIATE

${actionsText}

---

**ISTRUZIONI PER IL REPORT**:

1. **Tono**: Professionale ma empatico, chiaro e rassicurante  
2. **Struttura**: 
   - Introduzione breve (2–3 frasi) che contestualizza lo score
   - Sezione "Cosa significa il tuo score" con spiegazione semplice
   - Sezione "Fattori chiave" che spiega i top driver in linguaggio naturale
   ${Array.isArray(redFlags) && redFlags.length > 0 ? '- Sezione "⚠️ Segnali da monitorare" per i red flags' : ''}
   - Sezione "Cosa puoi fare" con consigli pratici divisi per:
     * 🏃 Stile di vita
     * 🩺 Follow-up medico
     * 💊 Nutraceutica (se applicabile)
   - Conclusione positiva e motivante
3. **Lunghezza**: 300–500 parole
4. **Linguaggio**: Evita termini tecnici non necessari, usa analogie quando utile
5. **Privacy**: Non menzionare dati personali specifici (età, nomi)

Genera il report in **formato Markdown**.`;
}

/** Rende leggibili le azioni per categoria, ignorando quelle vuote */
function formatActions(actions = {}) {
  const titles = {
    lifestyle: '### 🏃 Stile di vita',
    followup: '### 🩺 Follow-up medico',
    nutraceutica: '### 💊 Nutraceutica',
    medical: '### 👨‍⚕️ Consulenze specialistiche'
  };

  let out = '';
  for (const [, actionSet] of Object.entries(actions)) {
    for (const [cat, items] of Object.entries(actionSet || {})) {
      if (!Array.isArray(items) || items.length === 0) continue;
      if (!out.includes(titles[cat])) out += `\n${titles[cat]}\n\n`;
      items.forEach(item => { out += `- ${item}\n`; });
    }
  }

  return out.trim() || [
    '### 🏃 Stile di vita',
    '- Mantieni uno stile di vita sano e regolare',
    '### 🩺 Follow-up medico',
    '- Programma controlli periodici con il tuo medico'
  ].join('\n');
}

/** Chiamata all'OpenAI Chat Completions API */
async function generateWithOpenAI({ apiKey, prompt, model }) {
  // ✅ USA L'ENDPOINT CORRETTO: chat/completions
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model, // es: 'gpt-4o-mini' o 'gpt-4-turbo'
      messages: [
        {
          role: 'system',
          content: 'Sei un assistente medico specializzato in medicina preventiva. Scrivi report chiari, accurati e comprensibili per i pazienti.'
        },
        { 
          role: 'user', 
          content: prompt 
        }
      ],
      temperature: 0.7,
      max_tokens: 1500
    })
  });

  if (!resp.ok) {
    const text = await safeRead(resp);
    throw new Error(`OpenAI API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();

  // Estrai il testo dalla risposta
  const text = data?.choices?.[0]?.message?.content;
  
  if (!text) {
    throw new Error('OpenAI response parsing failed: no content in response');
  }
  
  return text;
}

async function safeRead(resp) {
  try { return await resp.text(); } catch { return '<no body>'; }
}