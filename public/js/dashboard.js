import { supabase, fetchProfile, fetchProgress, fetchAssessmentsSummary } from '/js/api.js';
import { getNextMacroarea, MacroFlow } from '/js/state.js';
import { goto } from '/js/ui.js';

const els = {
  userName: document.getElementById('userName'),
  heroText: document.getElementById('heroText'),
  startBtn: document.getElementById('startBtn'),
  content: document.getElementById('content'),
  kpiCompleted: document.getElementById('kpiCompleted'),
  kpiStatus: document.getElementById('kpiStatus'),
  radarAll: document.getElementById('radarAll'),
  areasList: document.getElementById('areasList'),
  logoutBtn: document.getElementById('logoutBtn'),
};

async function ensureUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) goto('/pages/login.html');
  return user;
}

function computeMacroScoresForRadar(assessments) {
  // ritorna un array nello stesso ordine di MacroFlow, con score normalizzati (0–100 o 0–10 a tua scelta).
  const map = {};
  for (const a of assessments) map[a.macroarea] = a.score ?? 0;

  return MacroFlow.map(m =>
    Math.max(0, Math.min(100, Math.round((map[m] ?? 0) * 10))) // es. scale 0–10 → 0–100
  );
}

function labelFromSlug(slug){
  // etichetta leggibile per radar / card
  return slug
    .replace(/_/g,' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function drawRadar(scores){
  const labels = MacroFlow.map(labelFromSlug);
  new Chart(els.radarAll.getContext('2d'), {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Rischio (0–100)',
        data: scores,
        fill: true
      }]
    },
    options: {
      responsive: true,
      scales: {
        r: { suggestedMin: 0, suggestedMax: 100, ticks: { stepSize: 20 } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function renderAreasList(assessments, completedSet){
  els.areasList.innerHTML = '';
  MacroFlow.forEach(slug => {
    const a = assessments.find(x => x.macroarea === slug);
    const completed = completedSet.has(slug);
    const score = a?.score ?? null;
    const drivers = a?.drivers ?? [];
    const btnText = completed ? 'Vedi report' : 'Compila ora';
    const btnAction = () => {
      if (completed) {
        // vai alla pagina macroarea per leggere report completo
        goto(`/pages/macroaree/${slug}.html`);
      } else {
        goto(`/pages/macroaree/${slug}.html`);
      }
    };

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h4 style="margin:0 0 .5rem 0">${labelFromSlug(slug)}</h4>
      <p class="muted" style="margin:.25rem 0">${completed ? '✅ Completata' : '🕐 Da completare'}</p>
      <p style="margin:.25rem 0"><strong>Score:</strong> ${score !== null ? score : '—'}</p>
      ${drivers?.length ? `<p class="muted" style="margin:.25rem 0">Driver: ${drivers.slice(0,3).map(d => d.name || d).join(', ')}</p>` : ''}
      <button class="cta" data-slug="${slug}">${btnText}</button>
    `;
    els.areasList.appendChild(card);
    card.querySelector('button').addEventListener('click', btnAction);
  });
}

async function init() {
  const user = await ensureUser();

  // Profilo
  const profile = await fetchProfile(user.id);
  els.userName.textContent = profile?.nome || 'Utente';
  els.heroText.textContent = 'Benvenuto nella tua area personale.';

  // Progresso + riepilogo macroaree
  const progress = await fetchProgress(user.id);
  const assessments = await fetchAssessmentsSummary(user.id); // deve ritornare [{macroarea, score, drivers, ...}]

  const completedSet = new Set(progress.completed_macroaree || []);
  els.kpiCompleted.textContent = `${completedSet.size} / ${MacroFlow.length}`;
  els.kpiStatus.textContent = progress.fully_completed ? 'Completato' : 'In corso';

  // CTA “Vai al questionario”: porta alla prossima macroarea non completata
  els.startBtn.addEventListener('click', () => {
    // trova prima macroarea non completata
    const next = MacroFlow.find(m => !completedSet.has(m)) || MacroFlow[0];
    goto(`/pages/macroaree/${next}.html`);
  });

  // Logout
  els.logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    goto('/pages/login.html');
  });

  // Radar
  const radarScores = computeMacroScoresForRadar(assessments);
  drawRadar(radarScores);

  // Lista macroaree
  renderAreasList(assessments, completedSet);

  // mostra contenuto
  els.content.style.display = 'block';
}

init();