// Tv-scherm (#tv): draait op de iPad, ingelogd als beheerder.
import {
  sb, h, mount, toast, load, save, LETTERS, syncClock, secondsLeft,
  fetchQuestions, fetchGame, errorText, liveSync, syncRealtimeAuth, qrSvg, joinUrl, loginForm,
} from './common.js';
import { judgeOpen, estimateWinners, choiceWinners, formatNumber } from './scoring.js';

const TV_GAME_KEY = 'kerstquiz_tv_game';
const SIGNED_URL_SECONDS = 3 * 60 * 60; // ongeveer 3 uur

const state = {
  game: null,
  questions: [],
  players: [],
  answered: 0,
  stopSync: null,
  tick: null,
  busy: false,
  reveal: null,   // antwoordenronde: { qid, answers, key, overrides: Map }
};

let requestedGameId = null;

export async function startTv(params) {
  document.body.className = 'tv';
  requestedGameId = params?.get('spel') || null;
  const { data } = await sb.auth.getSession();
  if (!data.session) return renderLogin();
  await afterLogin();
}

// ---------------------------------------------------------------- inloggen

function renderLogin(message) {
  mount(stage('screen-hero', heroLayout(h('h1', { class: 'title' }, 'Kerstquiz'), loginForm(afterLogin, message))));
}

async function afterLogin() {
  await syncRealtimeAuth();
  syncClock();
  try {
    state.questions = await fetchQuestions();
  } catch (e) {
    return renderLogin(errorText(e));
  }
  // Vanuit beheer ("Start quiz op dit scherm") komt een spel-id mee.
  if (requestedGameId) {
    const requested = await fetchGame(requestedGameId).catch(() => null);
    requestedGameId = null;
    history.replaceState(null, '', '#tv');
    if (requested) return openGame(requested);
  }
  const savedId = load(TV_GAME_KEY);
  const saved = savedId ? await fetchGame(savedId).catch(() => null) : null;
  renderHome(saved);
}

// ---------------------------------------------------------------- startscherm

function renderHome(savedGame) {
  stopLive();
  const n = state.questions.length;
  const content = h('div', { class: 'stack' },
    h('h1', { class: 'title' }, 'Kerstquiz'),
    h('p', { class: 'lead' },
      n === 0
        ? 'Er staan nog geen vragen klaar. Voer eerst supabase/test_vragen.sql uit in Supabase.'
        : `${n} ${n === 1 ? 'vraag' : 'vragen'} klaar.`),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-gold btn-lg', onclick: newGame }, 'Nieuw spel'),
      savedGame && h('button', { class: 'btn btn-ghost btn-lg', onclick: () => openGame(savedGame) },
        `Verder met spel ${savedGame.code}`),
    ),
    h('button', { class: 'link', onclick: logout }, 'Uitloggen'),
  );
  mount(stage('screen-hero', heroLayout(content)));
}

async function newGame() {
  const { data, error } = await sb.rpc('create_game');
  if (error) return toast(errorText(error));
  openGame(data);
}

async function logout() {
  stopLive();
  save(TV_GAME_KEY, null);
  await sb.auth.signOut();
  renderLogin();
}

// ---------------------------------------------------------------- spel volgen

async function openGame(game) {
  stopLive();
  state.game = game;
  save(TV_GAME_KEY, game.id);
  await Promise.all([loadPlayers(), loadAnswered()]);
  render();

  let debounce;
  state.stopSync = liveSync(
    `tv-${game.id}`,
    [
      { event: '*', table: 'games', filter: `id=eq.${game.id}` },
      { event: '*', table: 'players', filter: `game_id=eq.${game.id}` },
      { event: '*', table: 'answers', filter: `game_id=eq.${game.id}` },
    ],
    (payload) => {
      if (payload.table === 'games' && payload.new?.id) {
        const changedScreen = screenKey(payload.new) !== screenKey(state.game);
        state.game = payload.new;
        if (changedScreen) { loadAnswered().then(render); return; }
      }
      clearTimeout(debounce);
      debounce = setTimeout(refreshCounts, 250);
    },
    refreshAll,
  );

  state.tick = setInterval(updateTimer, 250);
}

function stopLive() {
  if (state.stopSync) state.stopSync();
  state.stopSync = null;
  clearInterval(state.tick);
}

async function refreshAll() {
  if (!state.game) return;
  const fresh = await fetchGame(state.game.id).catch(() => null);
  if (!fresh) return;
  const changedScreen = screenKey(fresh) !== screenKey(state.game);
  state.game = fresh;
  await Promise.all([loadPlayers(), loadAnswered()]);
  if (changedScreen) render(); else updateCounts();
}

async function refreshCounts() {
  await Promise.all([loadPlayers(), loadAnswered()]);
  updateCounts();
}

async function loadPlayers() {
  const { data } = await sb.from('players').select('id, name, created_at')
    .eq('game_id', state.game.id).order('created_at');
  if (data) state.players = data;
}

async function loadAnswered() {
  const g = state.game;
  if (g.status !== 'question' || !g.current_question_id) { state.answered = 0; return; }
  const { count } = await sb.from('answers').select('id', { count: 'exact', head: true })
    .eq('game_id', g.id).eq('question_id', g.current_question_id);
  state.answered = count || 0;
}

const screenKey = (g) => `${g?.status}|${g?.current_question_id}|${g?.question_started_at}`;
const currentIndex = () => state.questions.findIndex((q) => q.id === state.game.current_question_id);

// ---------------------------------------------------------------- spelstappen

/** Naar vraag `index` in de vragenronde ('question') of de antwoordenronde ('answers'). */
async function goTo(status, index) {
  if (state.busy) return;
  const q = state.questions[index];
  if (!q) return;
  state.busy = true;
  try {
    let photoUrl = null;
    if (q.photo_path) {
      const { data } = await sb.storage.from('fotos').createSignedUrl(q.photo_path, SIGNED_URL_SECONDS);
      photoUrl = data?.signedUrl || null;
    }
    await setState(status, q.id, photoUrl);
  } finally {
    state.busy = false;
  }
}
const goToQuestion = (index) => goTo('question', index);

async function setState(status, questionId = null, photoUrl = null) {
  const { data, error } = await sb.rpc('set_game_state', {
    p_game_id: state.game.id, p_status: status, p_question_id: questionId, p_photo_url: photoUrl,
  });
  if (error) { toast(errorText(error)); return; }
  state.game = data;
  await loadAnswered();
  render();
}

// Volgorde: wachtruimte → vragen → "De antwoorden" → antwoorden → einde.
async function next() {
  const g = state.game;
  const i = currentIndex();
  const last = state.questions.length - 1;
  if (g.status === 'question') return i < last ? goTo('question', i + 1) : setState('answers');
  if (g.status === 'answers') {
    if (!g.current_question_id) return goTo('answers', 0);
    return i < last ? goTo('answers', i + 1) : setState('final');
  }
}

async function previous() {
  const g = state.game;
  const i = currentIndex();
  const last = state.questions.length - 1;
  if (g.status === 'final') return goTo('answers', last);
  if (g.status === 'answers') {
    if (!g.current_question_id) return goTo('question', last);
    return i > 0 ? goTo('answers', i - 1) : setState('answers');
  }
  if (i > 0) return goTo('question', i - 1);
  return setState('lobby');
}

// ---------------------------------------------------------------- weergaven

function render() {
  const g = state.game;
  if (!g) return;
  if (g.status === 'lobby') return renderLobby();
  if (g.status !== 'answers') state.reveal = null; // bij terugkomen opnieuw laden
  if (g.status === 'question') return renderQuestion();
  if (g.status === 'answers') return g.current_question_id ? renderReveal() : renderAnswersIntro();
  return renderEnd();
}

function renderLobby() {
  const g = state.game;
  const url = joinUrl(g.code);
  const noQuestions = state.questions.length === 0;

  const content = h('div', { class: 'lobby' },
    h('div', { class: 'lobby-head' },
      h('h1', { class: 'title' }, 'Kerstquiz'),
      h('p', { class: 'lead' }, 'Pak je telefoon en doe mee!'),
    ),
    h('div', { class: 'join' },
      h('div', { class: 'qr' }, qrSvg(url)),
      h('div', { class: 'join-text' },
        h('div', { class: 'muted small-caps' }, 'Kamercode'),
        h('div', { class: 'room-code', 'aria-label': `Kamercode ${g.code.split('').join(' ')}` }, g.code),
        h('div', { class: 'muted join-url' }, url.replace(/^https?:\/\//, '')),
      ),
    ),
    h('div', { class: 'players-block' },
      h('div', { class: 'players-count', id: 'players-count' }, playersCountText()),
      h('div', { class: 'chips', id: 'player-chips' }, playerChips()),
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn btn-gold btn-lg', disabled: noQuestions,
        onclick: () => goToQuestion(0),
      }, 'Start de quiz'),
      noQuestions && h('span', { class: 'muted' }, 'Er staan nog geen vragen klaar.'),
    ),
  );

  mount(stage('screen-hero', heroLayout(content), cornerMenu()));
}

function playersCountText() {
  const n = state.players.length;
  return n === 0 ? 'Nog geen spelers' : `${n} ${n === 1 ? 'speler' : 'spelers'}`;
}

function playerChips() {
  const max = 40;
  const list = state.players.slice(-max).map((p) => h('span', { class: 'chip' }, p.name));
  if (state.players.length > max) list.unshift(h('span', { class: 'chip chip-more' }, `+${state.players.length - max}`));
  return list;
}

function renderQuestion() {
  const i = currentIndex();
  const q = state.questions[i];
  if (!q) {
    // vraag bestaat niet meer (verwijderd?) – terug naar het begin
    return mount(stage('screen-plain', h('div', { class: 'center stack' },
      h('p', { class: 'lead' }, 'Deze vraag bestaat niet meer.'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: () => setState('lobby') }, 'Terug naar de wachtruimte'),
    )));
  }
  const photo = state.game.photo_url;
  const isLast = i === state.questions.length - 1;

  const options = (q.options || []).map((text, k) =>
    h('div', { class: `option opt-${LETTERS[k].toLowerCase()}` },
      h('span', { class: 'letter', 'aria-hidden': 'true' }, LETTERS[k]),
      h('span', { class: 'option-text' }, h('span', { class: 'sr-only' }, `${LETTERS[k]}: `), text),
    ));

  const view = h('div', { class: `question ${photo ? 'has-photo' : ''}` },
    h('header', { class: 'q-head' },
      h('div', { class: 'q-meta' },
        q.category && h('span', { class: 'label' }, q.category),
        h('span', { class: 'muted q-count' }, `Vraag ${i + 1} van ${state.questions.length}`),
      ),
      h('div', { class: 'q-status' },
        h('span', { class: 'answered', id: 'answered' }, answeredText()),
        h('div', { class: 'timer', id: 'timer', role: 'timer' }, ''),
      ),
    ),
    h('div', { class: 'q-body' },
      photo && h('div', { class: 'photo' }, h('img', { src: photo, alt: '' })),
      h('div', { class: 'q-main' },
        h('h2', { class: 'q-text' }, q.text),
        q.kind === 'meerkeuze'
          ? h('div', { class: 'options' }, options)
          : h('p', { class: 'q-hint' }, q.kind === 'open'
            ? '✎ Typ je antwoord op je telefoon'
            : `✎ Vul je schatting in op je telefoon${q.unit ? ` (in ${q.unit})` : ''}`),
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      h('button', { class: 'btn btn-gold btn-lg', id: 'next-btn', onclick: next },
        isLast ? 'Einde vragenronde ▶' : 'Volgende vraag ▶'),
    ),
  );

  mount(stage('screen-plain', view));
  updateTimer();
}

function renderAnswersIntro() {
  const content = h('div', { class: 'stack' },
    h('h1', { class: 'title' }, 'De antwoorden'),
    h('p', { class: 'lead' }, 'Alle vragen nog een keer, nu met het goede antwoord.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-ghost btn-lg', onclick: previous }, '◀ Terug naar de laatste vraag'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: next }, 'Toon de antwoorden ▶'),
    ),
  );
  mount(stage('screen-hero', heroLayout(content), cornerMenu()));
}

function renderEnd() {
  const content = h('div', { class: 'stack' },
    h('h1', { class: 'title' }, 'Einde van de antwoordenronde'),
    h('p', { class: 'lead' }, 'De eindstand volgt in een volgende versie van de app.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-ghost btn-lg', onclick: previous }, '◀ Terug naar het laatste antwoord'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: newGame }, 'Nieuw spel'),
    ),
  );
  mount(stage('screen-hero', heroLayout(content), cornerMenu()));
}

// ---------------------------------------------------------------- antwoordenronde

async function loadReveal(qid) {
  const g = state.game;
  const [ans, key, ov] = await Promise.all([
    sb.from('answers').select('player_id, choice, text_answer, number_answer').eq('game_id', g.id).eq('question_id', qid),
    sb.from('question_answers').select('*').eq('question_id', qid).maybeSingle(),
    sb.from('overrides').select('normalized, correct').eq('game_id', g.id).eq('question_id', qid),
  ]);
  const err = ans.error || key.error || ov.error;
  if (err) toast(errorText(err));
  state.reveal = {
    qid,
    answers: ans.data || [],
    key: key.data || null,
    overrides: new Map((ov.data || []).map((o) => [o.normalized, o.correct])),
  };
}

async function renderReveal() {
  const qid = state.game.current_question_id;
  if (state.reveal?.qid !== qid) {
    mount(stage('screen-plain', h('div', { class: 'center stack', style: { height: '100%' } }, h('p', { class: 'lead muted' }, 'Antwoorden laden…'))));
    await loadReveal(qid);
    if (state.game.current_question_id !== qid || state.game.status !== 'answers') return;
  }
  const i = currentIndex();
  const q = state.questions[i];
  if (!q) return renderEnd();
  const r = state.reveal;
  const photo = state.game.photo_url;
  const isLast = i === state.questions.length - 1;

  let body;
  let winners;
  if (!r.key) {
    winners = new Set();
    body = h('p', { class: 'lead muted' }, 'Bij deze vraag is nog geen goed antwoord ingevuld in beheer.');
  } else if (q.kind === 'meerkeuze') {
    winners = choiceWinners(r.answers, r.key.correct_option);
    body = revealChoice(q, r.key.correct_option);
  } else if (q.kind === 'open') {
    const groups = judgeOpen(r.answers, r.key.correct_texts, r.overrides);
    winners = new Set(groups.filter((g) => g.correct).flatMap((g) => g.playerIds));
    body = revealOpen(q, r.key, groups);
  } else {
    winners = estimateWinners(r.answers, r.key.correct_value);
    body = revealEstimate(q, r.key, r.answers, winners);
  }

  const n = state.players.length;
  const view = h('div', { class: `question reveal reveal-${q.kind} ${photo && q.kind === 'meerkeuze' ? 'has-photo' : ''}` },
    h('header', { class: 'q-head' },
      h('div', { class: 'q-meta' },
        q.category && h('span', { class: 'label' }, q.category),
        h('span', { class: 'muted q-count' }, `Antwoord ${i + 1} van ${state.questions.length}`),
      ),
      h('div', { class: 'q-status' },
        h('span', { class: 'score-pill' }, `✓ ${winners.size} van ${n} ${n === 1 ? 'speler' : 'spelers'} goed`),
      ),
    ),
    h('div', { class: 'q-body' },
      photo && q.kind === 'meerkeuze' && h('div', { class: 'photo' }, h('img', { src: photo, alt: '' })),
      h('div', { class: 'q-main' },
        h('h2', { class: 'q-text q-text-small' }, q.text),
        body,
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: next }, isLast ? 'Einde antwoordenronde ▶' : 'Volgende antwoord ▶'),
    ),
  );
  mount(stage('screen-plain', view));
}

function revealChoice(q, correct) {
  return h('div', { class: 'options' }, (q.options || []).map((text, k) => {
    const ok = k === correct;
    return h('div', { class: `option opt-${LETTERS[k].toLowerCase()} ${ok ? 'is-correct' : 'is-wrong'}` },
      h('span', { class: 'letter', 'aria-hidden': 'true' }, LETTERS[k]),
      h('span', { class: 'option-text' }, h('span', { class: 'sr-only' }, `${LETTERS[k]}: `), text),
      ok && h('span', { class: 'mark mark-good', 'aria-label': 'goed' }, '✓'),
    );
  }));
}

function revealOpen(q, key, groups) {
  const list = groups.length
    ? h('div', { class: 'groups' }, groups.map((g) => h('button', {
      class: `group ${g.correct ? 'group-good' : 'group-bad'} ${g.overridden ? 'group-overridden' : ''}`,
      'aria-pressed': String(g.correct),
      title: 'Tik om goed/fout om te zetten',
      onclick: () => toggleGroup(q, g),
    },
      h('span', { class: `mark ${g.correct ? 'mark-good' : 'mark-bad'}`, 'aria-hidden': 'true' }, g.correct ? '✓' : '✗'),
      h('span', { class: 'group-text' }, g.display),
      h('span', { class: 'group-count' }, `×${g.count}`),
      h('span', { class: 'group-reason' }, g.reasonText),
    )))
    : h('p', { class: 'lead muted' }, 'Niemand heeft deze vraag beantwoord.');
  return h('div', { class: 'reveal-open' },
    h('p', { class: 'correct-line' }, h('span', { class: 'mark mark-good' }, '✓'), ' ', (key.correct_texts || []).join(' / ')),
    list,
    groups.length > 0 && h('p', { class: 'muted small' }, 'Tik op een antwoord om het goed of fout te rekenen.'),
  );
}

async function toggleGroup(q, g) {
  const r = state.reveal;
  const value = !g.correct;
  const auto = g.auto;
  // gelijk aan het automatische oordeel → omzetting weghalen
  const { error } = value === auto
    ? await sb.from('overrides').delete()
      .eq('game_id', state.game.id).eq('question_id', q.id).eq('normalized', g.normalized)
    : await sb.from('overrides').upsert(
      { game_id: state.game.id, question_id: q.id, normalized: g.normalized, correct: value },
      { onConflict: 'game_id,question_id,normalized' },
    );
  if (error) return toast(errorText(error));
  if (value === auto) r.overrides.delete(g.normalized); else r.overrides.set(g.normalized, value);
  renderReveal();
}

const fmt = formatNumber;

function revealEstimate(q, key, answers, winners) {
  const unit = q.unit ? ` ${q.unit}` : '';
  const target = Number(key.correct_value);
  const names = new Map(state.players.map((p) => [p.id, p.name]));
  const est = answers.filter((a) => a.number_answer != null).map((a) => ({ id: a.player_id, v: Number(a.number_answer) }));
  const winnerList = est.filter((e) => winners.has(e.id)).sort((a, b) => Math.abs(a.v - target) - Math.abs(b.v - target));

  return h('div', { class: 'reveal-estimate' },
    h('p', { class: 'correct-value' }, h('span', { class: 'mark mark-good' }, '✓'), ` ${fmt(target)}${unit}`),
    numberLine(est, target, winners),
    h('div', { class: 'winners' },
      h('span', { class: 'muted' }, winnerList.length ? 'Punt voor:' : 'Niemand heeft een schatting ingestuurd.'),
      winnerList.map((w) => h('span', { class: 'chip chip-good' }, `✓ ${names.get(w.id) || '?'} · ${fmt(w.v)}`)),
    ),
  );
}

/** Getallenlijn als SVG: alle schattingen als stippen, de puntwinnaars in groen, het juiste antwoord in goud. */
function numberLine(est, target, winners) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, H = 230, PAD = 40, AXIS = 170, R = 9;
  const values = [target, ...est.map((e) => e.v)];
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.04; max += span * 0.04;
  const x = (v) => PAD + ((v - min) / (max - min)) * (W - 2 * PAD);

  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'number-line', role: 'img', 'aria-label': `Getallenlijn met ${est.length} schattingen` });
  svg.append(el('line', { x1: PAD, x2: W - PAD, y1: AXIS, y2: AXIS, class: 'nl-axis' }));

  // stippen stapelen als ze (bijna) op dezelfde plek vallen
  const stacks = new Map();
  const sorted = [...est].sort((a, b) => Number(winners.has(a.id)) - Number(winners.has(b.id)));
  for (const e of sorted) {
    const bucket = Math.round(x(e.v) / (R * 2));
    const level = stacks.get(bucket) || 0;
    stacks.set(bucket, level + 1);
    const cy = AXIS - R - 4 - level * (R * 2 + 2);
    if (cy < R) continue;
    svg.append(el('circle', { cx: x(e.v), cy, r: R, class: winners.has(e.id) ? 'nl-dot nl-win' : 'nl-dot' }));
  }

  const tx = x(target);
  svg.append(el('line', { x1: tx, x2: tx, y1: 8, y2: AXIS + 12, class: 'nl-target' }));
  const label = (v, cls, anchor) => el('text', { x: x(v), y: AXIS + 42, class: cls, 'text-anchor': anchor }, fmt(v));
  const lo = Math.min(...est.map((e) => e.v), target);
  const hi = Math.max(...est.map((e) => e.v), target);
  if (lo !== target) svg.append(label(lo, 'nl-label', 'start'));
  if (hi !== target) svg.append(label(hi, 'nl-label', 'end'));
  svg.append(label(target, 'nl-label nl-label-target', 'middle'));
  return svg;
}

// ---------------------------------------------------------------- live bijwerken

function answeredText() {
  return `${state.answered} van ${state.players.length} geantwoord`;
}

function updateCounts() {
  const g = state.game;
  if (g.status === 'lobby') {
    const c = document.getElementById('players-count');
    const chips = document.getElementById('player-chips');
    if (c) c.textContent = playersCountText();
    if (chips) chips.replaceChildren(...playerChips());
  }
  const a = document.getElementById('answered');
  if (a) a.textContent = answeredText();
  updateTimer();
}

function updateTimer() {
  const g = state.game;
  if (!g || g.status !== 'question') return;
  const q = state.questions[currentIndex()];
  const left = Math.max(0, Math.ceil(secondsLeft(g, q)));
  const timer = document.getElementById('timer');
  if (timer) {
    timer.textContent = left > 0 ? String(left) : 'Tijd is om';
    timer.classList.toggle('timer-done', left <= 0);
    timer.classList.toggle('timer-low', left > 0 && left <= 5);
  }
  const everyone = state.players.length > 0 && state.answered >= state.players.length;
  const btn = document.getElementById('next-btn');
  if (btn) btn.disabled = state.busy || !(left <= 0 || everyone);
}

// ---------------------------------------------------------------- opmaak

/** 16:9-podium; op een iPad komen er zwarte randen omheen. */
function stage(kind, ...children) {
  return h('div', { class: 'tv-frame' }, h('main', { class: `stage ${kind}` }, children));
}

function heroLayout(...children) {
  return [h('div', { class: 'hero-bg', 'aria-hidden': 'true' }), h('div', { class: 'hero-content' }, children)];
}

function cornerMenu() {
  return h('div', { class: 'corner' },
    h('button', { class: 'link', onclick: () => { stopLive(); renderHome(state.game); } }, 'Menu'),
  );
}
