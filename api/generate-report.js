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
    
    // ✅ USA UN MODELLO VALIDO
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    
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
    riskClass === 'low' ? 'Basso Rischio / Ottima Salute' :
    riskClass === 'medium' ? 'Rischio Moderato / Salute Discreta' :
    riskClass === 'high' ? 'Alto Rischio / Attenzione' : 'da definire';

  // Controlla se ci sono segnali critici
  const hasRedFlags = Array.isArray(redFlags) && redFlags.length > 0;
  const hasRiskDrivers = topDrivers.some(d => d.contribution > 0); 

  const topDriversText = (topDrivers || [])
    .map((d, i) => {
      const feat = d?.feature ?? 'Fattore';
      const contr = d?.contribution ?? 'n/d';
      const expl = d?.explanation ?? '';
      const prefix = d.contribution > 0 ? "⚠️ FATTORE DI RISCHIO:" : "✅ Fattore protettivo:";
      return `${i + 1}. **${feat}** (${prefix} impatto ${contr})\n   - ${expl}`;
    })
    .join('\n\n');

  const redFlagsText = hasRedFlags
    ? `\n## ⚠️ RED FLAGS (Segnali CRITICI rilevati)\nQuesti elementi richiedono attenzione IMMEDIATA:\n\n${
        redFlags.map((rf, i) => `🚨 **${i + 1}. ${rf?.condition || 'Segnale'}**: ${rf?.action || 'Approfondire con il medico'}`).join('\n')
      }\n`
    : '';

  const actionsText = formatActions(actions);
  const macroareaLabel = macroarea.replace(/_/g, ' ');

  return `Sei un assistente medico specializzato in medicina preventiva. Il tuo compito è generare un report chiaro, DIRETTO e orientato all'azione per la macroarea: **${macroareaLabel}**.

## DATI DEL QUESTIONARIO

**Score totale**: ${score}/10 (10 = Ottima salute, 0 = Grave rischio)
**Classe**: ${riskLabel}

**Narrativa tecnica**: ${narrative || '—'}

## TOP DRIVER (Elementi determinanti)
${topDriversText || 'Nessun driver principale identificato.'}

${redFlagsText}

## AZIONI CONSIGLIATE (Da includere nel piano d'azione)
${actionsText}

---

**ISTRUZIONI CRITICHE PER IL REPORT**:

1. **SII SPECIFICO NELLE RACCOMANDAZIONI MEDICHE**:
   - ❌ NON SCRIVERE MAI frasi generiche come "Consulta il tuo medico per valutare la situazione" se hai un'azione specifica disponibile.
   - ✅ SCRIVI INVECE: "Si raccomanda una **Visita Cardiologica con ECG**" o "È consigliata una **Spirometria**" (usa le azioni fornite nella sezione 'AZIONI CONSIGLIATE' o 'RED FLAGS').
   - Se ci sono Red Flags, la visita specialistica deve essere il PRIMO punto del piano d'azione.

2. **GESTIONE DEI RISCHI SPECIFICI**:
   - Anche se lo score complessivo è alto (es. 8/10 o 9/10), se c'è una "Red Flag" o un driver negativo, devi dargli **massima priorità**.
   - Esempio: "Sebbene il tuo stato di salute generale sia ottimo, l'ipertensione non trattata rappresenta un rischio puntuale che va gestito immediatamente con uno specialista."

3. **STRUTTURA DEL REPORT**:
   - **Sintesi Clinica**: Panoramica dello stato di salute. Se ci sono rischi specifici, citali subito.
   - **Analisi dei Fattori**: Spiega i driver positivi e negativi.
   - **⚠️ Punti di Attenzione (Solo se presenti)**: Sezione dedicata ai rischi rilevati. Sii diretto sulle conseguenze se non trattati.
   - **Piano d'Azione Pratico**:
     * **🩺 Controlli Medici**: Elenca le visite/esami specifici (es. "Visita Oculistica", "Esami della tiroide").
     * **🏃 Stile di Vita**: Consigli pratici su dieta, sonno, attività.
     * **💊 Nutraceutica**: Consigli sugli integratori (se presenti nei dati).

Genera il report in **formato Markdown**. Usa il grassetto per le azioni mediche raccomandate.`;
}

/** Rende leggibili le azioni per categoria */
function formatActions(actions = {}) {
  const titles = {
    lifestyle: '### 🏃 Stile di vita e abitudini',
    nutraceutical: '### 💊 Nutraceutica', 
    nutraceutica: '### 💊 Nutraceutica', // Alias
    clinical: '### 🩺 VISITE E ESAMI RACCOMANDATI (Priorità Alta)',
    specialist: '### 👨‍⚕️ VISITE E ESAMI RACCOMANDATI (Priorità Alta)' // Alias
  };

  let out = '';
  // Priorità: prima clinical/specialist, poi il resto
  const orderedCategories = ['clinical', 'specialist', 'lifestyle', 'nutraceutical', 'nutraceutica'];
  
  // Raggruppa tutte le azioni
  const allActions = {};
  for (const [, actionSet] of Object.entries(actions)) {
    for (const [cat, items] of Object.entries(actionSet || {})) {
      if (!Array.isArray(items) || items.length === 0) continue;
      if (!allActions[cat]) allActions[cat] = [];
      allActions[cat].push(...items);
    }
  }

  // Genera testo ordinato
  for (const cat of orderedCategories) {
    if (allActions[cat] && allActions[cat].length > 0) {
        // Deduplica
        const uniqueItems = [...new Set(allActions[cat])];
        const title = titles[cat] || `### ${cat.toUpperCase()}`;
        out += `\n${title}\n\n`;
        uniqueItems.forEach(item => {
            out += `- ${item}\n`;
        });
        delete allActions[cat]; // Rimuovi per non duplicare se ci sono altre categorie non standard
    }
  }

  // Aggiungi eventuali categorie rimaste
  for (const [cat, items] of Object.entries(allActions)) {
      if (items.length > 0) {
        const uniqueItems = [...new Set(items)];
        out += `\n### ${cat.toUpperCase()}\n\n`;
        uniqueItems.forEach(item => {
            out += `- ${item}\n`;
        });
      }
  }

  return out.trim();
}

/** Chiamata all'OpenAI Chat Completions API */
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
          content: 'Sei un medico esperto in medicina preventiva. Il tuo obiettivo è fornire piani d\'azione concreti e specifici, evitando consigli generici quando sono presenti indicazioni cliniche precise.'
        },
        { 
          role: 'user', 
          content: prompt 
        }
      ],
      temperature: 0.5, // Abbassato per essere più deterministico e meno "creativo/vago"
      max_tokens: 1500
    })
  });

  if (!resp.ok) {
    const text = await safeRead(resp);
    throw new Error(`OpenAI API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  
  if (!text) throw new Error('OpenAI response parsing failed: no content');
  return text;
}

async function safeRead(resp) {
  try { return await resp.text(); } catch { return '<no body>'; }
}