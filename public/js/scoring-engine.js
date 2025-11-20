// /public/js/scoring-engine.js
// Motore per calcolare score da risposte + file YAML

import { parse as parseYAML } from 'https://esm.sh/yaml@2';

/**
 * Carica i file YAML di una macroarea
 * @param {string} macroarea - Nome della macroarea (es: 'genetica_epigenetica_storiafamiliare')
 * @returns {Promise<Object>} - Oggetto con features, scoring, actions, validation, mapping
 */
export async function loadYAMLConfigs(macroarea) {
  const basePath = `/configs/macroaree/${macroarea}`;
  
  const [features, scoring, actions, validation, mapping] = await Promise.all([
    fetch(`${basePath}/features.yaml`).then(r => r.text()).then(parseYAML),
    fetch(`${basePath}/scoring.yaml`).then(r => r.text()).then(parseYAML),
    fetch(`${basePath}/actions.yaml`).then(r => r.text()).then(parseYAML),
    fetch(`${basePath}/validation.yaml`).then(r => r.text()).then(parseYAML),
    fetch(`${basePath}/mapping_form.yaml`).then(r => r.text()).then(parseYAML)
  ]);

  return { features, scoring, actions, validation, mapping };
}

/**
 * Mappa le risposte del form ai nomi delle feature YAML
 * @param {Object} rawAnswers - Risposte raw dal form (es: {fh_ipertensione: 'dopo_40'})
 * @param {Object} mapping - mapping_form.yaml
 * @returns {Object} - Risposte mappate per le feature
 */
export function mapAnswersToFeatures(rawAnswers, mapping) {
  const mapped = {};
  
  for (const [formKey, config] of Object.entries(mapping.map || {})) {
    const featureName = config.feature.replace(/\[\]$/, ''); // rimuovi [] se array
    const isArray = config.feature.endsWith('[]');
    
    // Gestione passthrough (testo libero)
    if (config.passthrough) {
      mapped[featureName] = rawAnswers[formKey.replace(/\[\]$/, '')];
      continue;
    }

    // Gestione array (checkbox multiple)
    if (isArray) {
      const formValue = rawAnswers[formKey.replace(/\[\]$/, '')];
      if (!formValue) continue;
      
      const values = Array.isArray(formValue) ? formValue : [formValue];
      mapped[featureName] = values.map(v => config.values[v] || v);
      continue;
    }

    // Gestione singolo valore
    const formValue = rawAnswers[formKey];
    if (formValue && config.values) {
      mapped[featureName] = config.values[formValue] || formValue;
    }
  }

  return mapped;
}

/**
 * Calcola lo score per una singola feature
 * @param {Object} feature - Definizione della feature da features.yaml
 * @param {any} value - Valore della risposta (già mappato)
 * @returns {number} - Score calcolato
 */
function calculateFeatureScore(feature, value) {
  if (value == null || value === '') return 0;

  // Gestione categorical_multi (checkbox multiple)
  if (feature.type === 'categorical_multi') {
    if (!Array.isArray(value)) value = [value];
    
    // Se "nessuna" o simile è presente, azzera
    const noneValues = ['nessuna', 'nessuno', 'nessuna_misura', 'no'];
    if (value.some(v => noneValues.includes(v))) return 0;

    let total = 0;
    for (const v of value) {
      total += feature.per_item_score[v] || 0;
    }
    
    // Applica cap
    if (feature.cap_score != null) {
      if (feature.cap_score < 0) {
        return Math.max(feature.cap_score, total); // cap negativo = minimo
      } else {
        return Math.min(feature.cap_score, total); // cap positivo = massimo
      }
    }
    
    return total;
  }

  // Gestione categorical (radio button)
  if (feature.type === 'categorical') {
    return feature.map_to_score[value] ?? 0;
  }

  // Gestione text (store only, no score)
  if (feature.type === 'text') {
    return 0;
  }

  return 0;
}

/**
 * Identifica i red flags basati sulle risposte
 * @param {Object} mappedAnswers - Risposte mappate
 * @param {Object} features - features.yaml
 * @param {Object} scoring - scoring.yaml
 * @returns {Array} - Lista di red flags {feature, value, action}
 */
function identifyRedFlags(mappedAnswers, features, scoring) {
  const redFlags = [];

  // Red flags dalle feature definitions
  for (const feature of features.features || []) {
    if (!feature.red_flag_if_in) continue;

    const value = mappedAnswers[feature.name];
    if (!value) continue;

    const values = Array.isArray(value) ? value : [value];
    const hasFlag = values.some(v => feature.red_flag_if_in.includes(v));

    if (hasFlag) {
      redFlags.push({
        feature: feature.name,
        value,
        source: 'feature_definition'
      });
    }
  }

  // Red flags dalle regole in scoring.yaml
  for (const rule of scoring.red_flags || []) {
    try {
      // Parse semplice delle condizioni (es: "fh_tumori_brca in ['mutazione_brca_nota']")
      if (evaluateCondition(rule.condition, mappedAnswers)) {
        redFlags.push({
          condition: rule.condition,
          action: rule.action,
          source: 'scoring_rules'
        });
      }
    } catch (err) {
      console.warn('Errore valutazione red flag:', rule.condition, err);
    }
  }

  return redFlags;
}

/**
 * Valuta una condizione semplice (es: "fh_diabete in ['tipo1','multipli_tipo2']")
 */
function evaluateCondition(condition, answers) {
  // Regex per parsing: "feature in ['val1','val2']"
  const match = condition.match(/(\w+)\s+in\s+\[([^\]]+)\]/);
  if (!match) return false;

  const [, feature, valuesStr] = match;
  const values = valuesStr.split(',').map(v => v.trim().replace(/['"]/g, ''));
  
  const answer = answers[feature];
  if (!answer) return false;

  const answerArray = Array.isArray(answer) ? answer : [answer];
  return answerArray.some(a => values.includes(a));
}

/**
 * Identifica i top driver (feature con maggior contributo allo score)
 * @param {Object} featureScores - Mappa {featureName: score}
 * @param {Object} weights - Pesi da scoring.yaml
 * @param {Object} explanations - Spiegazioni da scoring.yaml
 * @returns {Array} - Top driver ordinati per impatto
 */
function identifyDrivers(featureScores, weights, explanations) {
  const drivers = [];

  for (const [feature, score] of Object.entries(featureScores)) {
    if (score === 0) continue;

    const weight = weights[feature] || 1;
    const contribution = score * weight;

    drivers.push({
      feature,
      score,
      weight,
      contribution,
      explanation: explanations?.driver_templates?.[feature] || `Contributo da ${feature}`
    });
  }

  // Ordina per contributo assoluto
  drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  // Filtra driver con impatto minimo
  const minPct = explanations?.min_contribution_pct || 5;
  const totalContribution = drivers.reduce((sum, d) => sum + Math.abs(d.contribution), 0);
  
  return drivers.filter(d => {
    const pct = (Math.abs(d.contribution) / totalContribution) * 100;
    return pct >= minPct;
  }).slice(0, explanations?.top_k_drivers || 5);
}

/**
 * Calcola lo score totale di una macroarea
 * @param {Object} rawAnswers - Risposte raw dal form
 * @param {Object} configs - Configurazioni YAML caricate
 * @returns {Object} - {score, drivers, redFlags, featureScores, actions}
 */
export function computeScore(rawAnswers, configs) {
  const { features, scoring, actions, mapping } = configs;

  // 1. Mappa risposte
  const mappedAnswers = mapAnswersToFeatures(rawAnswers, mapping);

  // 2. Calcola score per ogni feature (Punti alti = problema)
  const featureScores = {};
  for (const feature of features.features || []) {
    const value = mappedAnswers[feature.name];
    featureScores[feature.name] = calculateFeatureScore(feature, value);
  }

  // 3. Calcola score totale (weighted sum)
  const weights = scoring.aggregation?.weights || {};
  let totalScore = 0;

  for (const [featureName, score] of Object.entries(featureScores)) {
    const weight = weights[featureName] || 1;
    totalScore += score * weight;
  }

  // Applica cap totale e SCALA A 0-100
  const cap = scoring.aggregation?.cap_total || 100;
  totalScore = Math.max(0, Math.min(cap, totalScore));

  // Calcolo del RISK SCORE (0 = Sano, 100 = Rischio Alto)
  const normalizedRiskScore = (totalScore / cap) * 100; 

  // 4. Determina classificazione (usa normalizedRiskScore come previsto dal YAML)
  let riskClass = 'medium';
  const { classification } = scoring;
  // 'low' nel YAML significa "Basso Rischio" (quindi Salute Alta)
  if (normalizedRiskScore <= (classification.low?.max || 40)) riskClass = 'low';
  else if (normalizedRiskScore >= (classification.high?.min || 70)) riskClass = 'high';

  // 5. Identifica drivers
  const drivers = identifyDrivers(featureScores, weights, scoring.explanations);

  // 6. Identifica red flags
  const redFlags = identifyRedFlags(mappedAnswers, features, scoring);

  // 7. Recupera azioni consigliate
  const relevantActions = {};
  for (const [featureName, score] of Object.entries(featureScores)) {
    if (score !== 0 && actions.actions[featureName]) {
      relevantActions[featureName] = actions.actions[featureName];
    }
  }

  // 8. CALCOLO HEALTH SCORE (Inversione finale)
  // Trasformiamo il rischio (0-100) in salute (10-0)
  let healthScore = 10 - (normalizedRiskScore / 10);
  healthScore = Math.round(healthScore * 10) / 10; // Arrotonda a 1 decimale (es. 9.5)

  return {
    score: healthScore, // Ora restituisce 10.0 per un utente sano
    riskClass,          // 'low' = Verde (Basso Rischio), 'high' = Rosso (Alto Rischio)
    drivers,
    redFlags,
    featureScores,
    actions: relevantActions,
    narrative: scoring.explanations?.overall_narratives?.[riskClass] || ''
  };
}

/**
 * Prepara l'output strutturato per l'LLM
 * @param {Object} scoreResult - Risultato di computeScore()
 * @param {Object} rawAnswers - Risposte originali
 * @returns {Object} - Dati formattati per l'LLM
 */
export function prepareForLLM(scoreResult, rawAnswers) {
  return {
    score: scoreResult.score,
    riskClass: scoreResult.riskClass,
    narrative: scoreResult.narrative,
    topDrivers: scoreResult.drivers.map(d => ({
      feature: d.feature,
      contribution: Math.round(d.contribution * 10) / 10,
      explanation: d.explanation
    })),
    redFlags: scoreResult.redFlags.map(rf => ({
      condition: rf.condition || rf.feature,
      action: rf.action || 'Valutazione specialistica consigliata'
    })),
    actions: scoreResult.actions,
    answersContext: rawAnswers // per dare contesto all'LLM
  };
}