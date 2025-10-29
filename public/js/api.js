// /public/js/api.js
import { MacroFlow, getNextMacroarea } from './state.js';

// Carico supabase-js dal CDN ESM (perfetto per siti statici)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = window.__SUPABASE_URL;
const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Supabase env vars mancanti. Definisci window.__SUPABASE_URL e __SUPABASE_ANON_KEY.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ---------- AUTH ----------
export async function signUpWithEmail({ email, password, profile }) {
  // 1) crea l'utente
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  const user = data.user;
  // 2) crea il profilo (RLS: insert_own_profile consente insert se user_id = auth.uid())
  if (user && profile) {
    const { error: upErr } = await supabase
      .from('profiles')
      .insert({ user_id: user.id, ...profile });
    if (upErr) throw upErr;
  }

  // 3) crea progress “vuoto” (utile per gating)
  await ensureProgressRow(user.id);

  return user;
}

export async function signInWithEmail({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  // assicuro progress row
  if (data.user) await ensureProgressRow(data.user.id);
  return data.user;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${location.origin}/pages/dashboard.html`,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
  if (error) throw error;
  return data; // verrai redirezionato da Google → supabase → redirectTo
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user || null;
}

// ---------- PROFILES ----------
export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, nome, cognome, data_nascita, created_at')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // not found
  return data || null;
}

export async function upsertProfile(userId, patch) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, ...patch })
    .eq('user_id', userId);
  if (error) throw error;
}

// ---------- PROGRESS ----------
async function ensureProgressRow(userId) {
  // crea riga se non esiste
  const { error } = await supabase
    .from('progress')
    .insert({ user_id: userId })
    .select('user_id')
    .single()
    .throwOnError(false); // ignoriamo unique violation
  // NB: con RLS insert_own_progress lo permette
  return true;
}

export async function fetchProgress(userId) {
  // 1) stato globale
  const { data: prog, error: e1 } = await supabase
    .from('progress')
    .select('completed_macroaree, last_macroarea, fully_completed')
    .eq('user_id', userId)
    .single();
  if (e1 && e1.code !== 'PGRST116') throw e1;

  // 2) breve sommario assessments dell’utente (macroarea, score)
  const { data: ass, error: e2 } = await supabase
    .from('assessments')
    .select('macroarea, score, completed_at')
    .eq('user_id', userId)
    .order('completed_at', { ascending: true });
  if (e2 && e2.code !== 'PGRST116') throw e2;

  return {
    fully_completed: prog?.fully_completed ?? false,
    completed_macroaree: prog?.completed_macroaree ?? [],
    last_macroarea: prog?.last_macroarea ?? null,
    assessments: ass ?? [],
  };
}

// marca una macroarea come completata e aggiorna “fully_completed” se necessario
async function updateProgressAfterSave(userId, macroarea) {
  // prendo progress corrente
  const current = await fetchProgress(userId);

  const set = new Set(current.completed_macroaree || []);
  set.add(macroarea);
  const completed_macroaree = Array.from(set);

  const fully_completed = completed_macroaree.length >= MacroFlow.length;

  const { error } = await supabase
    .from('progress')
    .update({
      completed_macroaree,
      last_macroarea: fully_completed ? null : getNextMacroarea(macroarea),
      fully_completed,
    })
    .eq('user_id', userId);
  if (error) throw error;

  return { completed_macroaree, fully_completed };
}

// ---------- ASSESSMENTS ----------
export async function listAssessments(userId) {
  const { data, error } = await supabase
    .from('assessments')
    .select('macroarea, score, drivers, red_flags, completed_at')
    .eq('user_id', userId)
    .order('completed_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchAssessment(userId, macroarea) {
  const { data, error } = await supabase
    .from('assessments')
    .select('*')
    .eq('user_id', userId)
    .eq('macroarea', macroarea)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Salva una macroarea:
 * - upsert in `assessments`
 * - aggiorna `progress`
 */
export async function saveAssessment({
  userId, macroarea, answers, score, drivers, redFlags, report,
}) {
  // UPSERT (PK: user_id + macroarea)
  const payload = {
    user_id: userId,
    macroarea,
    answers,             // JSON
    score,               // number
    drivers,             // JSON (array/oggetto)
    red_flags: redFlags, // JSON
    report,              // text
    completed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('assessments')
    .upsert(payload, { onConflict: 'user_id,macroarea' });
  if (error) throw error;

  // aggiorno progress
  return await updateProgressAfterSave(userId, macroarea);
}

// ---------- LLM REPORT (endpoint serverless tuo) ----------
/**
 * Chiama l’endpoint /api/generateReport (Vercel/Cloudflare/etc.)
 * Passa:
 *  - macroarea,
 *  - yamlOutput (risultato del calcolo: score/drivers/actions spiegati),
 *  - answers (raw),
 *  - score/drivers/actions (ridondanti per comodità).
 */
export async function generateReportWithLLM({ macroarea, yamlOutput, answers, score, drivers, actions }) {
  const res = await fetch('/api/generateReport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ macroarea, yamlOutput, answers, score, drivers, actions }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API error: ${res.status} ${text}`);
  }

  const { report } = await res.json();
  return report; // stringa
}