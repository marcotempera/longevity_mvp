import { getNextMacroarea } from './state.js';
import { saveAssessment, generateReportWithLLM } from './api.js';
import { loadYamlConfigs, computeScore } from './scoring.js'; // i tuoi moduli

const user = { id:'mock-user' };  // TODO: da Supabase
const macroarea = 'genetica_epigenetica_storiafamiliare';

const form = document.getElementById('qform');
form.addEventListener('submit', async (e)=>{
  e.preventDefault();

  // 1) raccogli risposte
  const formData = new FormData(form);
  const answers = Object.fromEntries(formData.entries());

  // 2) carica YAML e calcola score
  const cfg = await loadYamlConfigs(macroarea); // features, scoring, actions, explanations
  const { score, drivers, redFlags, actionsResolved, yamlOutput } = computeScore({ answers, cfg });

  // 3) LLM: mini-report
  const report = await generateReportWithLLM({
    macroarea, yamlOutput, answers, score, drivers, actions: actionsResolved
  });

  // 4) salva
  await saveAssessment({
    userId: user.id, macroarea, answers, score, drivers, redFlags, report
  });

  // 5) vai alla prossima macroarea o dashboard
  const next = getNextMacroarea(macroarea);
  window.location.href = next
    ? `./${next === 'genetica_epigenetica_storiafamiliare' ? 'genetica' : next}.html`
    : '../dashboard.html';
});