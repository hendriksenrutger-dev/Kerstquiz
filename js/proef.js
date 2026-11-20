// Proefmodus (#tv): 30 testspelers die zelf willekeurig antwoorden, om de app
// vooraf te testen. Alleen voor de ingelogde beheerder.
import { sb, load, save } from './common.js?v=37';

const COUNT = 30;
const key = (gameId) => `kerstquiz_proef_${gameId}`;

/** Id's van de testspelers in dit spel (leeg = proefmodus uit). */
export const testPlayers = (gameId) => load(key(gameId)) || [];

/** Voeg 30 testspelers toe ("Proef 01" … "Proef 30"). */
export async function addTestPlayers(gameId, code) {
  const ids = [...testPlayers(gameId)];
  const start = ids.length;
  const results = await Promise.all(Array.from({ length: COUNT }, (_, i) =>
    sb.rpc('join_game', { p_code: code, p_name: `Proef ${String(start + i + 1).padStart(2, '0')}` })));
  for (const r of results) if (r.data?.[0]) ids.push(r.data[0].player_id);
  save(key(gameId), ids);
  const failed = results.find((r) => r.error);
  if (failed && ids.length === start) throw failed.error;
  return ids.length - start;
}

export function stopTestMode(gameId) {
  save(key(gameId), null);
  clearTimers();
}

let timers = [];
let scheduledFor = null;
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; scheduledFor = null; };

const rand = (n) => Math.floor(Math.random() * n);
const pick = (list) => list[rand(list.length)];
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // ongeveer -1 … 1

function typo(text) {
  if (text.length < 4) return text;
  const i = 1 + rand(text.length - 2);
  return Math.random() < 0.5 ? text.slice(0, i) + text.slice(i + 1) : text.slice(0, i) + text[i + 1] + text[i] + text.slice(i + 2);
}

/** Een willekeurig antwoord, ongeveer de helft goed. */
function randomAnswer(q, k) {
  const row = {};
  const good = Math.random() < 0.5;
  if (q.kind === 'meerkeuze') {
    row.choice = good && k?.correct_option != null ? k.correct_option : rand(4);
  } else if (q.kind === 'open') {
    const texts = k?.correct_texts?.length ? k.correct_texts : ['?'];
    const r = Math.random();
    row.text_answer = r < 0.35 ? pick(texts) : r < 0.55 ? typo(pick(texts)) : r < 0.65 ? pick(texts).toUpperCase()
      : pick(['Weet ik niet', 'Kerstman', 'Sneeuwpop', 'Geen idee', 'Rendier']);
  } else if (q.kind === 'schatting') {
    const v = Number(k?.correct_value ?? 100);
    const spread = Math.max(Math.abs(v) * 0.08, 5);
    row.number_answer = Math.random() < 0.08 ? v : Math.round(v + gauss() * spread);
  }
  if (q.rate_tree) row.rating = Math.min(10, Math.max(1, Math.round(7 + gauss() * 3)));
  return row;
}

/**
 * Laat de testspelers de huidige vraag beantwoorden, verspreid over de tijd.
 * De tv is ingelogd als beheerder en schrijft de antwoorden direct weg.
 * @param isStillOpen () => boolean – staat deze vraag nog open?
 * @param onlyIds     alleen deze spelers (bijv. de deelnemers aan de schiftingsvraag)
 */
export async function answerAsTestPlayers(game, question, isStillOpen, onlyIds = null) {
  const ids = testPlayers(game.id).filter((id) => !onlyIds || onlyIds.includes(id));
  const id = `${game.id}|${question.id}|${game.question_started_at}`;
  if (!ids.length || scheduledFor === id) return;
  clearTimers();
  scheduledFor = id;

  const { data: k } = await sb.from('question_answers').select('*').eq('question_id', question.id).maybeSingle();
  const spreadMs = Math.max(2, Math.min(question.time_limit - 2, 15)) * 1000;
  for (const playerId of ids) {
    if (Math.random() < 0.05) continue; // een enkeling antwoordt niet
    timers.push(setTimeout(async () => {
      if (!isStillOpen()) return;
      await sb.from('answers').upsert({
        game_id: game.id, player_id: playerId, question_id: question.id, ...randomAnswer(question, k),
      }, { onConflict: 'player_id,question_id' });
    }, 800 + rand(spreadMs)));
  }
}

export const stopAnswering = clearTimers;
