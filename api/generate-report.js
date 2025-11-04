// /api/generate-report.js
// Endpoint serverless per generare report con LLM (OpenAI/Anthropic)

export const config = {
    runtime: 'edge', // Vercel Edge / Cloudflare Workers
  };
  
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MODEL = 'gpt-5-nano'; // o 'gpt-4o' per maggiore qualità
  
  export default async function handler(req) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
  
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
  
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405, 
        headers: corsHeaders 
      });
    }
  
    try {
      const body = await req.json();
      const { macroarea, yamlOutput, rawAnswers } = body;
  
      if (!macroarea || !yamlOutput) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields' }), 
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
  
      // Genera prompt per l'LLM
      const prompt = buildPrompt(macroarea, yamlOutput, rawAnswers);
  
      // Chiama OpenAI
      const report = await generateWithOpenAI(prompt);
  
      return new Response(
        JSON.stringify({ report }), 
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
  
    } catch (error) {
      console.error('LLM API Error:', error);
      return new Response(
        JSON.stringify({ error: error.message }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
  
  /**
   * Costruisce il prompt per l'LLM
   */
  function buildPrompt(macroarea, yamlOutput, rawAnswers) {
    const { score, riskClass, narrative, topDrivers, redFlags, actions } = yamlOutput;
  
    return `Sei un assistente medico specializzato in medicina preventiva. Il tuo compito è generare un report chiaro e comprensibile in italiano per un paziente, basato sui risultati di un questionario sulla macroarea: **${macroarea.replace(/_/g, ' ')}**.
  
  ## DATI DEL QUESTIONARIO
  
  **Score totale**: ${score}/100
  **Classe di rischio**: ${riskClass} (${riskClass === 'low' ? 'basso' : riskClass === 'medium' ? 'moderato' : 'alto'})
  
  **Narrativa generale**: ${narrative}
  
  ## TOP DRIVER (Fattori principali che influenzano lo score)
  
  ${topDrivers.map((d, i) => `${i + 1}. **${d.feature}** (contributo: ${d.contribution})
     - ${d.explanation}`).join('\n\n')}
  
  ${redFlags.length > 0 ? `
  ## ⚠️ RED FLAGS (Segnali che richiedono attenzione)
  
  ${redFlags.map((rf, i) => `${i + 1}. ${rf.action || rf.condition}`).join('\n')}
  ` : ''}
  
  ## AZIONI CONSIGLIATE
  
  ${formatActions(actions)}
  
  ---
  
  **ISTRUZIONI PER IL REPORT**:
  
  1. **Tono**: Professionale ma empatico, chiaro e rassicurante
  2. **Struttura**: 
     - Introduzione breve (2-3 frasi) che contestualizza lo score
     - Sezione "Cosa significa il tuo score" con spiegazione semplice
     - Sezione "Fattori chiave" che spiega i top driver in linguaggio naturale
     ${redFlags.length > 0 ? '- Sezione "⚠️ Segnali da monitorare" per i red flags' : ''}
     - Sezione "Cosa puoi fare" con consigli pratici divisi per:
       * 🏃 Stile di vita
       * 🩺 Follow-up medico
       * 💊 Nutraceutica (se applicabile)
     - Conclusione positiva e motivante
  3. **Lunghezza**: 300-500 parole
  4. **Linguaggio**: Evita termini tecnici non necessari, usa analogie quando utile
  5. **Privacy**: Non menzionare dati personali specifici (età, nomi)
  
  Genera il report in **formato Markdown**.`;
  }
  
  /**
   * Formatta le azioni in modo leggibile
   */
  function formatActions(actions) {
    const categories = {
      lifestyle: '### 🏃 Stile di vita',
      followup: '### 🩺 Follow-up medico',
      nutraceutica: '### 💊 Nutraceutica',
      medical: '### 👨‍⚕️ Consulenze specialistiche'
    };
  
    let formatted = '';
  
    for (const [feature, actionSet] of Object.entries(actions)) {
      for (const [category, items] of Object.entries(actionSet)) {
        if (!Array.isArray(items) || items.length === 0) continue;
        
        if (!formatted.includes(categories[category])) {
          formatted += `\n${categories[category]}\n\n`;
        }
  
        items.forEach(item => {
          formatted += `- ${item}\n`;
        });
      }
    }
  
    return formatted || '- Mantieni uno stile di vita sano e regolare\n- Consulta il medico per controlli periodici';
  }
  
  /**
   * Chiama OpenAI API
   */
  async function generateWithOpenAI(prompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
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
  
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }
  
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  