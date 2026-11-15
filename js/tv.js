// Tv-scherm (#tv): draait op de iPad, ingelogd als beheerder.
import {
  sb, h, mount, toast, load, save, LETTERS, syncClock, secondsLeft,
  fetchQuestions, fetchGame, errorText, liveSync, syncRealtimeAuth, qrSvg, joinUrl, loginForm,
} from './common.js';

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

async function goToQuestion(index) {
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
    await setState('question', q.id, photoUrl);
  } finally {
    state.busy = false;
  }
}

async function setState(status, questionId = null, photoUrl = null) {
  const { data, error } = await sb.rpc('set_game_state', {
    p_game_id: state.game.id, p_status: status, p_question_id: questionId, p_photo_url: photoUrl,
  });
  if (error) { toast(errorText(error)); return; }
  state.game = data;
  await loadAnswered();
  render();
}

async function next() {
  const i = currentIndex();
  if (i + 1 < state.questions.length) await goToQuestion(i + 1);
  else await setState('answers');
}

async function previous() {
  const g = state.game;
  if (g.status === 'answers') return goToQuestion(state.questions.length - 1);
  const i = currentIndex();
  if (i > 0) return goToQuestion(i - 1);
  return setState('lobby');
}

// ---------------------------------------------------------------- weergaven

function render() {
  const g = state.game;
  if (!g) return;
  if (g.status === 'lobby') return renderLobby();
  if (g.status === 'question') return renderQuestion();
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
          : h('p', { class: 'lead muted' }, 'Deze vraagsoort werkt in het spel vanaf de volgende versie.'),
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

function renderEnd() {
  const content = h('div', { class: 'stack' },
    h('h1', { class: 'title' }, 'Einde van de vragenronde'),
    h('p', { class: 'lead' }, 'De antwoordenronde volgt in een volgende versie van de app.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-ghost btn-lg', onclick: previous }, '◀ Terug naar de laatste vraag'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: newGame }, 'Nieuw spel'),
    ),
  );
  mount(stage('screen-hero', heroLayout(content), cornerMenu()));
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
