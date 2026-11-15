// Tv-scherm (#tv): draait op de iPad, ingelogd als beheerder.
import {
  sb, h, mount, toast, load, save, LETTERS, syncClock, secondsLeft,
  fetchQuestions, fetchGame, errorText, liveSync, syncRealtimeAuth, qrSvg, joinUrl, loginForm,
  keepScreenOn, fullscreenButton, spotifyPlayer, hiddenSpotifyPlayer, loopingSpotifyPlayer,
} from './common.js';
import { testPlayers, stopTestMode, answerAsTestPlayers } from './proef.js';
import {
  judgeOpen, estimateWinners, choiceWinners, formatNumber, scoreboard, treeRanking, interimTop, finalRanking,
} from './scoring.js';

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
  tiebreaks: [],  // schiftingsvragen (niet in de gewone quiz)
  finalInfo: null, // laatste eindstand: { rows, pending, winners }
  schiftingResult: false, // uitslag van de schiftingsvraag tonen
};

let requestedGameId = null;

export async function startTv(params) {
  document.body.className = 'tv';
  requestedGameId = params?.get('spel') || null;
  keepScreenOn();
  const { data } = await sb.auth.getSession();
  if (!data.session) return renderLogin();
  await afterLogin();
}

// ---------------------------------------------------------------- inloggen

function renderLogin(message) {
  mount(stage('screen-free', heroLayout(h('h1', { class: 'title' }, 'Kerstquiz'), loginForm(afterLogin, message))));
}

async function afterLogin() {
  await syncRealtimeAuth();
  syncClock();
  try {
    const all = await fetchQuestions();
    state.questions = all.filter((q) => !q.tiebreak);
    state.tiebreaks = all.filter((q) => q.tiebreak);
    // Muziek bij de start en het einde (Beheer → Spelinstellingen); ontbreekt de tabel/kolom, dan geen muziek.
    const { data: settings } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
    state.music = { start: settings?.start_music || null, end: settings?.end_music || null };
    preloadMusic();
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

/** Beginscherm van de quizmaster: werkt op iPad én telefoon. */
function renderHome(savedGame) {
  stopLive();
  bgMusic(null);
  const n = state.questions.length;
  const trees = state.questions.filter((q) => q.rate_tree).length;
  const running = savedGame && savedGame.status !== 'tree' ? savedGame : null;
  const content = h('div', { class: 'stack home' },
    h('h1', { class: 'title' }, 'Kerstquiz'),
    h('p', { class: 'lead' },
      n === 0
        ? 'Er staan nog geen vragen klaar. Voeg ze toe via "Beheer".'
        : `${n} ${n === 1 ? 'vraag' : 'vragen'} klaar${trees ? `, waarvan ${trees} ${trees === 1 ? 'boom' : 'bomen'} met cijfer` : ''}.`),
    h('div', { class: 'home-buttons' },
      h('button', { class: 'btn btn-gold btn-lg', onclick: newGame, disabled: n === 0 }, '▶ Start nieuwe quiz'),
      running && h('button', { class: 'btn btn-ghost btn-lg', onclick: () => { if (running.status === 'lobby') playMusic(state.music?.start); openGame(running); } },
        `Verder met spel ${running.code}`),
    ),
    h('div', { class: 'row' },
      fullscreenButton(),
      h('a', { class: 'link', href: '#beheer' }, 'Beheer'),
      h('button', { class: 'link', onclick: logout }, 'Uitloggen'),
    ),
  );
  mount(stage('screen-free', heroLayout(content)));
}

async function newGame() {
  playMusic(state.music?.start); // binnen de tik starten
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
  if (!['question', 'schifting'].includes(g.status) || !g.current_question_id) { state.answered = 0; return; }
  // Alleen echte antwoorden tellen; alleen een cijfer voor de boom telt niet als "geantwoord".
  const { data } = await sb.from('answers').select('choice, text_answer, number_answer')
    .eq('game_id', g.id).eq('question_id', g.current_question_id);
  if (data) state.answered = data.filter((a) => a.choice != null || a.text_answer || a.number_answer != null).length;
}

const screenKey = (g) => `${g?.status}|${g?.current_question_id}|${g?.question_started_at}`;
const currentIndex = () => state.questions.findIndex((q) => q.id === state.game.current_question_id);
const currentTiebreak = () => state.tiebreaks.find((q) => q.id === state.game.current_question_id) || null;
const nextTiebreak = () => state.tiebreaks.find((q) => !(state.game.tiebreak_done || []).includes(q.id)) || null;
const INTERIM_EVERY = 10;

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
// Volgorde: wachtruimte → uitleg → vragen (om de 10 een tussenstand) → "De antwoorden"
// → antwoorden → eindstand (→ schiftingsvraag → eindstand) → mooiste kerstboom.
async function next() {
  const g = state.game;
  const i = currentIndex();
  const last = state.questions.length - 1;
  if (g.status === 'question') {
    if (i >= 0 && i < last && (i + 1) % INTERIM_EVERY === 0) return setState('tussenstand', state.questions[i].id);
    return i < last ? goTo('question', i + 1) : setState('answers');
  }
  if (g.status === 'tussenstand') return goTo('question', i + 1);
  if (g.status === 'answers') {
    if (!g.current_question_id) return goTo('answers', 0);
    return i < last ? goTo('answers', i + 1) : setState('final');
  }
  if (g.status === 'final') {
    if (state.finalInfo?.pending.length && nextTiebreak()) return startSchifting();
    if (hasTrees()) return setState('tree');
  }
  if (g.status === 'schifting') return setState('final');
}

const hasTrees = () => state.questions.some((q) => q.rate_tree);

async function previous() {
  const g = state.game;
  const i = currentIndex();
  const last = state.questions.length - 1;
  if (g.status === 'tree') return setState('final');
  if (g.status === 'schifting') {
    // Niemand heeft geantwoord? Dan telt deze schiftingsvraag niet als gesteld.
    if (state.answered === 0) {
      await sb.from('games').update({ tiebreak_done: (g.tiebreak_done || []).filter((id) => id !== g.current_question_id) }).eq('id', g.id);
    }
    return setState('final');
  }
  if (g.status === 'final') return goTo('answers', last);
  if (g.status === 'answers') {
    if (!g.current_question_id) return goTo('question', last);
    return i > 0 ? goTo('answers', i - 1) : setState('answers');
  }
  if (g.status === 'tussenstand') return goTo('question', i);
  if (i > 0 && i % INTERIM_EVERY === 0) return setState('tussenstand', state.questions[i - 1].id);
  if (i > 0) return goTo('question', i - 1);
  if (i === 0) return setState('question'); // terug naar de uitleg
  return setState('lobby');
}

/** Schiftingsvraag starten voor de spelers die gelijk staan in de top 3. */
async function startSchifting() {
  const g = state.game;
  const q = nextTiebreak();
  if (!q || state.busy) return;
  state.busy = true;
  try {
    const { error } = await sb.from('games').update({
      tiebreak_names: state.finalInfo.pending,
      tiebreak_done: [...(g.tiebreak_done || []), q.id],
      winners: null,
    }).eq('id', g.id);
    if (error) { toast(errorText(error)); return; }
    state.game = { ...g, tiebreak_names: state.finalInfo.pending, tiebreak_done: [...(g.tiebreak_done || []), q.id], winners: null };
    state.schiftingResult = false;
    await setState('schifting', q.id);
  } finally {
    state.busy = false;
  }
}

// ---------------------------------------------------------------- weergaven

function render() {
  const g = state.game;
  if (!g) return;
  // Achtergrondmuziek: start in de wachtruimte en bij "Zo werkt het", einde vanaf de definitieve eindstand.
  if (g.status === 'lobby' || (g.status === 'question' && !g.current_question_id)) bgMusic(state.music?.start);
  else if (g.status === 'tree') bgMusic(state.music?.end);
  else if (g.status !== 'final') bgMusic(null); // bij de eindstand beslist renderScoreboard
  if (g.status === 'lobby') return renderLobby();
  if (g.status !== 'answers') state.reveal = null; // bij terugkomen opnieuw laden
  if (g.status === 'question') return g.current_question_id ? renderQuestion() : renderRules();
  if (g.status === 'tussenstand') return renderInterim();
  if (g.status === 'schifting') return renderSchifting();
  if (g.status === 'answers') return g.current_question_id ? renderReveal() : renderAnswersIntro();
  if (g.status === 'tree') return renderTree();
  return renderScoreboard();
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
      ),
    ),
    h('div', { class: 'players-block' },
      h('div', { class: 'players-count', id: 'players-count' }, playersCountText()),
      h('div', { class: 'chips', id: 'player-chips' }),
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn btn-gold btn-lg', disabled: noQuestions,
        onclick: () => setState('question'), // eerst het uitlegscherm
      }, 'Start de quiz'),
      noQuestions && h('span', { class: 'muted' }, 'Er staan nog geen vragen klaar.'),
    ),
  );

  mount(stage('screen-hero', heroLayout(content), cornerMenu()));
  fitChips();
}

// ---------------------------------------------------------------- uitleg na de start

/** Pictogram per soort vraag. */
function kindIcon(q) {
  if (q.media_url) return '♪';
  if (q.rate_tree) return '🎄';
  if (q.kind === 'open') return '✎';
  if (q.kind === 'schatting') return '≈';
  return 'ABCD';
}

/** Rubrieken in de volgorde waarin ze voor het eerst langskomen, met aantallen. */
function rubricOverview() {
  const groups = new Map();
  for (const q of state.questions) {
    const name = q.category || { meerkeuze: 'Meerkeuze', open: 'Open vraag', schatting: 'Schatting' }[q.kind];
    const g = groups.get(name) || { name, count: 0, icon: kindIcon(q) };
    g.count++;
    groups.set(name, g);
  }
  return [...groups.values()];
}

function renderRules() {
  const qs = state.questions;
  const has = (fn) => qs.some(fn);
  const rules = [
    ['📱', 'Antwoord op je telefoon; wijzigen kan tot de tijd om is.'],
    ['⭐', 'Elk goed antwoord is 1 punt.'],
    has((q) => q.kind === 'open') && ['✎', 'Open vragen: kleine tikfouten zijn niet erg.'],
    has((q) => q.kind === 'schatting') && ['≈', 'Schatting: de drie die het dichtst zitten krijgen een punt.'],
    has((q) => q.media_url) && ['♪', 'Muziek: luister goed! Soms is de speler afgedekt, zodat je het antwoord niet ziet.'],
    has((q) => q.rate_tree) && ['🎄', 'Kerstbomen: geef ook een cijfer (1–10). Telt niet mee, maar kiest de mooiste boom.'],
    qs.length > INTERIM_EVERY
      ? ['📊', `Om de ${INTERIM_EVERY} vragen een tussenstand, zonder namen. De antwoorden en de eindstand komen aan het eind.`]
      : ['🤫', 'Geen tussenstand: de antwoorden en de eindstand komen aan het eind.'],
    state.tiebreaks.length > 0 && ['⚖️', 'Gelijke stand in de top 3? Dan beslist een schiftingsvraag.'],
  ].filter(Boolean);

  const view = h('div', { class: 'rules' },
    h('header', { class: 'sb-head' },
      h('h1', { class: 'title' }, 'Zo werkt het'),
      h('span', { class: 'muted' }, `${qs.length} ${qs.length === 1 ? 'vraag' : 'vragen'} · ${state.players.length} spelers`),
    ),
    h('div', { class: 'rules-body' },
      h('section', { class: 'rules-col' },
        h('h2', { class: 'rules-h' }, 'Spelregels'),
        h('ul', { class: 'rules-list' }, rules.map(([icon, text]) => h('li', {}, h('span', { class: 'rules-icon', 'aria-hidden': 'true' }, icon), h('span', {}, text)))),
      ),
      h('section', { class: 'rules-col' },
        h('h2', { class: 'rules-h' }, 'Dit komt er'),
        h('ul', { class: 'rubrics' }, rubricOverview().map((g) => h('li', { class: 'rubric' },
          h('span', { class: 'rubric-icon', 'aria-hidden': 'true' }, g.icon),
          h('span', { class: 'rubric-name' }, g.name),
          h('span', { class: 'rubric-count' }, `${g.count}×`),
        ))),
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: next }, 'Eerste vraag ▶'),
    ),
  );
  mount(stage('screen-plain', view));
}

function playersCountText() {
  const n = state.players.length;
  return n === 0 ? 'Nog geen spelers' : `${n} ${n === 1 ? 'speler' : 'spelers'}`;
}

function playerChips() {
  return state.players.map((p) => h('span', { class: 'chip' }, p.name));
}

/** Toon zoveel namen als er passen (nieuwste eerst zichtbaar), de rest als "+N". */
function fitChips() {
  const box = document.getElementById('player-chips');
  if (!box) return;
  box.replaceChildren(...playerChips());
  if (box.scrollHeight <= box.clientHeight + 1) return;
  const more = h('span', { class: 'chip chip-more' });
  box.prepend(more);
  let hidden = 0;
  while (box.scrollHeight > box.clientHeight + 1 && box.children.length > 1) {
    box.children[1].remove();
    hidden++;
    more.textContent = `+${hidden}`;
  }
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
        q.media_url && (q.media_mode === 'verbergen'
          ? hiddenSpotifyPlayer(q.media_url, { allowReveal: true })
          : spotifyPlayer(q.media_url)),
        q.kind === 'meerkeuze'
          ? h('div', { class: 'options' }, options)
          : h('p', { class: 'q-hint' }, q.kind === 'open'
            ? '✎ Typ je antwoord op je telefoon'
            : `✎ Vul je schatting in op je telefoon${q.unit ? ` (in ${q.unit})` : ''}`),
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      q.rate_tree && h('p', { class: 'rate-hint' }, '★ Geef deze boom ook een cijfer op je telefoon'),
      h('button', { class: 'btn btn-gold btn-lg', id: 'next-btn', onclick: next },
        isLast ? 'Einde vragenronde ▶' : 'Volgende vraag ▶'),
    ),
  );

  mount(stage('screen-plain', view));
  updateTimer();

  const startedAt = state.game.question_started_at;
  answerAsTestPlayers(state.game, q, () => state.game.status === 'question'
    && state.game.current_question_id === q.id && state.game.question_started_at === startedAt
    && secondsLeft(state.game, q) > 0);
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

// ---------------------------------------------------------------- eindstand en mooiste boom

/** Alle rijen ophalen (Supabase geeft er standaard maximaal 1000 per keer). */
async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function loadResults() {
  const g = state.game;
  const [answers, keys, overrides] = await Promise.all([
    fetchAll(() => sb.from('answers').select('player_id, question_id, choice, text_answer, number_answer, rating')
      .eq('game_id', g.id).order('id')),
    fetchAll(() => sb.from('question_answers').select('*').order('question_id')),
    fetchAll(() => sb.from('overrides').select('question_id, normalized, correct').eq('game_id', g.id).order('normalized')),
  ]);
  await loadPlayers();
  return { answers, keys: new Map(keys.map((k) => [k.question_id, k])), overrides };
}

function loadingScreen(text) {
  mount(stage('screen-plain', h('div', { class: 'center stack', style: { height: '100%', display: 'flex' } }, h('p', { class: 'lead muted' }, text))));
}

async function renderScoreboard() {
  const status = state.game.status;
  loadingScreen('Eindstand berekenen…');
  let info = { rows: [], pending: [], winners: [] };
  try {
    const r = await loadResults();
    const board = scoreboard(state.players, state.questions, r.keys, r.answers, r.overrides);
    const tbValues = new Map(state.tiebreaks
      .filter((q) => r.keys.get(q.id)?.correct_value != null)
      .map((q) => [q.id, r.keys.get(q.id).correct_value]));
    info = finalRanking(board, state.game.tiebreak_done || [], tbValues, r.answers, state.tiebreaks.length > 0);
  } catch (e) {
    toast(errorText(e));
  }
  if (state.game.status !== status) return;
  state.finalInfo = info;

  const tb = nextTiebreak();
  const needsSchifting = info.pending.length > 0 && tb;
  bgMusic(needsSchifting ? null : state.music?.end);
  // Definitief? Dan de winnaars doorgeven aan de telefoons (die gaan groen knipperen).
  const winners = needsSchifting ? null : info.winners;
  if (JSON.stringify(winners) !== JSON.stringify(state.game.winners ?? null)) {
    sb.from('games').update({ winners }).eq('id', state.game.id).then(({ error }) => { if (!error) state.game.winners = winners; });
  }

  const pts = (n) => `${n} ${n === 1 ? 'punt' : 'punten'}`;
  const winnerNames = new Set(info.winners.map((w) => w.name));
  const rest = info.rows.filter((r) => !(needsSchifting ? false : winnerNames.has(r.name)) && r.place <= 10).slice(0, needsSchifting ? 12 : 8);
  const restList = rest.length > 0 && h('ol', {
    class: `ranks ${rest.length > 4 ? 'ranks-two' : ''} ${needsSchifting ? '' : 'ranks-small'}`,
    style: rest.length > 4 ? { gridTemplateRows: `repeat(${Math.ceil(rest.length / 2)}, minmax(0, auto))` } : null,
  }, rest.map((row) => h('li', { class: `rank ${needsSchifting && info.pending.includes(row.name) ? 'rank-tied' : ''}` },
    h('span', { class: 'rank-place' }, `${row.place}`),
    h('span', { class: 'rank-name' }, row.name),
    h('span', { class: 'rank-points' }, pts(row.points)),
  )));

  let main;
  if (!info.rows.length) {
    main = h('p', { class: 'lead muted' }, 'Er hebben geen spelers meegedaan.');
  } else if (needsSchifting) {
    main = h('div', { class: 'stack' },
      h('p', { class: 'tie-banner' }, '⚖️ Gelijke stand in de top 3! Schiftingsvraag voor: ', h('strong', {}, info.pending.join(', '))),
      restList,
    );
  } else {
    main = h('div', { class: 'final-body' }, podium(info, pts), restList);
  }

  const footerNext = needsSchifting
    ? h('button', { class: 'btn btn-gold btn-lg', onclick: next }, 'Schiftingsvraag ▶')
    : hasTrees()
      ? h('button', { class: 'btn btn-gold btn-lg', onclick: next }, 'Mooiste kerstboom ▶')
      : h('button', { class: 'btn btn-ghost', onclick: () => { stopLive(); renderHome(state.game); } }, 'Menu');

  const view = h('div', { class: 'scoreboard' },
    h('header', { class: 'sb-head' },
      h('h1', { class: 'title' }, needsSchifting ? 'Eindstand – nog niet beslist' : 'Eindstand'),
      h('span', { class: 'muted' }, info.pending.length && !tb
        ? 'Nog steeds gelijk; er zijn geen schiftingsvragen meer.'
        : `${state.questions.length} vragen · ${state.players.length} spelers`),
    ),
    main,
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      footerNext,
    ),
  );
  mount(stage('screen-plain', view));
}

/** Podium met de top 3 groot in beeld (2 – 1 – 3). Bij gelijke stand meerdere namen per plek. */
function podium(info, pts) {
  const rowsByPlace = new Map();
  for (const w of info.winners) {
    const row = info.rows.find((r) => r.name === w.name);
    if (!rowsByPlace.has(w.place)) rowsByPlace.set(w.place, []);
    rowsByPlace.get(w.place).push(row);
  }
  const places = [...rowsByPlace.keys()].sort((a, b) => a - b);
  const order = places.length === 3 ? [places[1], places[0], places[2]] : places;
  return h('div', { class: 'podium' }, order.map((place) => {
    const rows = rowsByPlace.get(place);
    return h('div', { class: `podium-step podium-${Math.min(place, 3)}` },
      h('div', { class: 'podium-place' }, place === 1 ? '🏆' : `${place}`),
      h('div', { class: 'podium-names' }, rows.map((r) => h('span', {}, r.name))),
      h('div', { class: 'podium-points' }, pts(rows[0].points)),
    );
  }));
}

// ---------------------------------------------------------------- tussenstand

async function renderInterim() {
  const i = currentIndex();
  loadingScreen('Tussenstand berekenen…');
  let top = [];
  try {
    const r = await loadResults();
    top = interimTop(state.players, state.questions.slice(0, i + 1), r.keys, r.answers, 5);
  } catch (e) {
    toast(errorText(e));
  }
  if (state.game.status !== 'tussenstand') return;
  const max = Math.max(1, ...top.map((t) => t.points));
  const view = h('div', { class: 'scoreboard interim' },
    h('header', { class: 'sb-head' },
      h('h1', { class: 'title' }, 'Tussenstand'),
      h('span', { class: 'muted' }, `na ${i + 1} van ${state.questions.length} vragen · zonder namen`),
    ),
    h('ol', { class: 'interim-list' }, top.map((t) => h('li', { class: `interim-row ${t.place === 1 ? 'interim-first' : ''}` },
      h('span', { class: 'rank-place' }, `${t.place}`),
      h('span', { class: 'interim-bar' }, h('span', { style: { width: `${Math.max(4, (t.points / max) * 100)}%` } })),
      h('span', { class: 'rank-points' }, `${t.points} ${t.points === 1 ? 'punt' : 'punten'}`),
    ))),
    h('p', { class: 'muted small' }, 'Open vragen tellen hier met het automatische oordeel; de eindstand kan nog iets anders uitvallen.'),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: next }, 'Volgende vraag ▶'),
    ),
  );
  mount(stage('screen-plain', view));
}

// ---------------------------------------------------------------- schiftingsvraag

function renderSchifting() {
  const g = state.game;
  const q = currentTiebreak();
  if (!q) return renderScoreboard();
  if (state.schiftingResult) return renderSchiftingResult(q);
  const names = g.tiebreak_names || [];

  const view = h('div', { class: 'question' },
    h('header', { class: 'q-head' },
      h('div', { class: 'q-meta' },
        h('span', { class: 'label' }, '⚖️ Schiftingsvraag'),
        h('span', { class: 'muted q-count' }, 'Gelijke stand in de top 3'),
      ),
      h('div', { class: 'q-status' },
        h('span', { class: 'answered', id: 'answered' }, answeredText()),
        h('div', { class: 'timer', id: 'timer', role: 'timer' }, ''),
      ),
    ),
    h('div', { class: 'q-body' },
      h('div', { class: 'q-main' },
        h('div', { class: 'chips tie-chips' }, names.map((n) => h('span', { class: 'chip chip-gold' }, n))),
        h('h2', { class: 'q-text' }, q.text),
        h('p', { class: 'q-hint' }, `✎ Alleen deze spelers vullen hun schatting in${q.unit ? ` (in ${q.unit})` : ''}. Wie het dichtst zit, wint.`),
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      h('button', { class: 'btn btn-gold btn-lg', id: 'next-btn', onclick: () => { state.schiftingResult = true; renderSchifting(); } }, 'Toon uitslag ▶'),
    ),
  );
  mount(stage('screen-plain', view));
  updateTimer();

  const ids = state.players.filter((p) => names.some((n) => n.toLowerCase() === p.name.toLowerCase())).map((p) => p.id);
  const startedAt = g.question_started_at;
  answerAsTestPlayers(g, q, () => state.game.status === 'schifting' && state.game.current_question_id === q.id
    && state.game.question_started_at === startedAt && secondsLeft(state.game, q) > 0, ids);
}

async function renderSchiftingResult(q) {
  const g = state.game;
  const [{ data: ans }, { data: key }] = await Promise.all([
    sb.from('answers').select('player_id, number_answer').eq('game_id', g.id).eq('question_id', q.id),
    sb.from('question_answers').select('correct_value').eq('question_id', q.id).maybeSingle(),
  ]);
  if (state.game.status !== 'schifting') return;
  const target = Number(key?.correct_value);
  const byId = new Map((ans || []).map((a) => [a.player_id, a.number_answer]));
  const list = (g.tiebreak_names || []).map((name) => {
    const p = state.players.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const v = p ? byId.get(p.id) : null;
    return { name, v, d: v == null ? Infinity : Math.abs(Number(v) - target) };
  }).sort((a, b) => a.d - b.d);
  const unit = q.unit ? ` ${q.unit}` : '';

  const view = h('div', { class: 'question reveal' },
    h('header', { class: 'q-head' },
      h('div', { class: 'q-meta' }, h('span', { class: 'label' }, '⚖️ Schiftingsvraag'), h('span', { class: 'muted q-count' }, 'Uitslag')),
    ),
    h('div', { class: 'q-body' },
      h('div', { class: 'q-main' },
        h('h2', { class: 'q-text q-text-small' }, q.text),
        h('p', { class: 'correct-value' }, h('span', { class: 'mark mark-good' }, '✓'), ` ${formatNumber(target)}${unit}`),
        h('ol', { class: 'tie-results' }, list.map((x, k) => h('li', { class: k === 0 && x.d < Infinity ? 'tie-best' : '' },
          h('span', { class: 'rank-name' }, x.name),
          h('span', {}, x.v == null ? 'geen antwoord' : `${formatNumber(x.v)}${unit}`),
          h('span', { class: 'muted' }, x.d === Infinity ? '' : x.d === 0 ? 'precies goed!' : `${formatNumber(x.d)} ernaast`),
        ))),
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: () => { state.schiftingResult = false; renderSchifting(); } }, '◀ Terug'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: () => { playMusic(state.music?.end); next(); } }, 'Naar de eindstand ▶'),
    ),
  );
  mount(stage('screen-plain', view));
}

async function renderTree() {
  loadingScreen('Stemmen tellen…');
  let ranking = { ranked: [], tooFew: [] };
  const photos = new Map();
  try {
    const r = await loadResults();
    ranking = treeRanking(state.questions, r.keys, r.answers, state.game.min_votes);
    const paths = ranking.ranked.slice(0, 3).map((t) => t.question.photo_path).filter(Boolean);
    if (paths.length) {
      const { data } = await sb.storage.from('fotos').createSignedUrls(paths, SIGNED_URL_SECONDS);
      for (const row of data || []) if (row.signedUrl) photos.set(row.path, row.signedUrl);
    }
  } catch (e) {
    toast(errorText(e));
  }
  if (state.game.status !== 'tree') return;

  const [first, ...rest] = ranking.ranked;
  const stats = (t) => `gemiddeld ${formatNumber(Math.round(t.average * 10) / 10)} · ${t.votes} ${t.votes === 1 ? 'stem' : 'stemmen'}`;
  const photoOf = (t) => (t.question.photo_path ? photos.get(t.question.photo_path) : null);

  const footer = h('footer', { class: 'q-foot' },
    h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
    h('button', { class: 'btn btn-ghost', onclick: () => { stopLive(); renderHome(state.game); } }, 'Menu'),
  );

  if (!first) {
    mount(stage('screen-plain', h('div', { class: 'tree-final tree-empty' },
      h('div', { class: 'center stack', style: { display: 'flex', flex: '1' } },
        h('h1', { class: 'title' }, 'Mooiste kerstboom'),
        h('p', { class: 'lead' }, `Geen enkele boom heeft genoeg stemmen (minimaal ${state.game.min_votes}).`),
      ),
      footer,
    )));
    return;
  }

  const view = h('div', { class: 'tree-final' },
    h('div', { class: 'tree-main' },
      photoOf(first) && h('div', { class: 'tree-photo' }, h('img', { src: photoOf(first), alt: `Kerstboom van ${first.owner}` })),
      h('div', { class: 'tree-text' },
        h('p', { class: 'small-caps gold' }, '★ Mooiste kerstboom'),
        h('h1', { class: 'tree-owner' }, first.owner || 'Onbekend'),
        h('p', { class: 'tree-stats' }, stats(first)),
        rest.length > 0 && h('ol', { class: 'tree-runners', start: '2' }, rest.slice(0, 2).map((t, k) => h('li', { class: 'tree-runner' },
          h('span', { class: 'runner-place' }, `${k + 2}`),
          photoOf(t) ? h('img', { src: photoOf(t), alt: '' }) : h('span', { class: 'runner-noimg' }),
          h('span', { class: 'runner-text' }, h('strong', {}, t.owner || 'Onbekend'), h('span', { class: 'muted' }, stats(t))),
        ))),
      ),
    ),
    footer,
  );
  mount(stage('screen-plain', view));
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
  if (!q) return renderAnswersIntro();
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
        q.media_url && spotifyPlayer(q.media_url),
        body,
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: () => { if (isLast) playMusic(state.music?.end); next(); } }, isLast ? 'Einde antwoordenronde ▶' : 'Volgende antwoord ▶'),
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
  const total = state.game?.status === 'schifting' ? (state.game.tiebreak_names || []).length : state.players.length;
  return `${state.answered} van ${total} geantwoord`;
}

function updateCounts() {
  const g = state.game;
  if (g.status === 'lobby') {
    const c = document.getElementById('players-count');
    const chips = document.getElementById('player-chips');
    if (c) c.textContent = playersCountText();
    if (chips) fitChips();
  }
  const a = document.getElementById('answered');
  if (a) a.textContent = answeredText();
  updateTimer();
}

function updateTimer() {
  const g = state.game;
  if (!g || !['question', 'schifting'].includes(g.status)) return;
  const q = g.status === 'schifting' ? currentTiebreak() : state.questions[currentIndex()];
  const left = Math.max(0, Math.ceil(secondsLeft(g, q)));
  const timer = document.getElementById('timer');
  if (timer) {
    timer.textContent = left > 0 ? String(left) : 'Tijd is om';
    timer.classList.toggle('timer-done', left <= 0);
    timer.classList.toggle('timer-low', left > 0 && left <= 5);
  }
  const total = g.status === 'schifting' ? (g.tiebreak_names || []).length : state.players.length;
  const everyone = total > 0 && state.answered >= total;
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

// ---------------------------------------------------------------- achtergrondmuziek

/**
 * Muziek bij de start en het einde: kleine Spotify-spelers buiten het podium,
 * zodat de muziek doorspeelt terwijl de schermen wisselen. Er staat er steeds
 * hoogstens één in beeld; de andere is gepauzeerd.
 */
const musicPlayers = new Map(); // link → loopingSpotifyPlayer

function musicPlayer(link) {
  if (!link) return null;
  let p = musicPlayers.get(link);
  if (!p) {
    p = loopingSpotifyPlayer(link);
    if (!p) return null;
    musicPlayers.set(link, p);
    document.body.append(p.el);
  }
  return p;
}

/** Laat de speler voor `link` zien (null = geen muziek); andere spelers pauzeren. */
function bgMusic(link) {
  musicPlayer(link);
  for (const [l, p] of musicPlayers) {
    const on = l === link;
    p.el.classList.toggle('bg-music-on', on);
    if (!on) p.pause();
  }
}

/** Start muziek direct vanuit een tik (anders houdt de browser het tegen). */
function playMusic(link) {
  const p = musicPlayer(link);
  if (p) p.play();
}

/** Spelers alvast laden, zodat ze bij een tik meteen kunnen starten. */
function preloadMusic() {
  musicPlayer(state.music?.start);
  musicPlayer(state.music?.end);
}

function cornerMenu() {
  const proef = state.game && testPlayers(state.game.id).length > 0;
  return h('div', { class: 'corner' },
    proef && h('button', {
      class: 'proef-badge', title: 'Proefmodus uitzetten',
      onclick: () => {
        if (!confirm('Proefmodus uitzetten? De testspelers blijven in dit spel, maar antwoorden niet meer.')) return;
        stopTestMode(state.game.id);
        render();
      },
    }, 'Proefmodus'),
    fullscreenButton(),
    h('button', { class: 'link', onclick: () => { stopLive(); renderHome(state.game); } }, 'Menu'),
  );
}
