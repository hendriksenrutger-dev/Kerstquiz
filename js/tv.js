// Tv-scherm (#tv): draait op de iPad, ingelogd als beheerder.
import {
  sb, h, mount, toast, load, save, LETTERS, syncClock, secondsLeft,
  fetchQuestions, fetchGame, errorText, liveSync, syncRealtimeAuth, qrSvg, joinUrl, loginForm,
  keepScreenOn, fullscreenButton, spotifyPlayer, hiddenSpotifyPlayer, loopingSpotifyPlayer, APP_VERSION,
  brandTitle, ornament, deckPlayer, inScarePhase, serverNow, SCARE_SECONDS,
} from './common.js?v=81';
import { testPlayers, stopTestMode, answerAsTestPlayers } from './proef.js?v=81';
import { scheduleScare, prepareScareAudio } from './schrik.js?v=81';
import {
  judgeOpen, estimateWinners, choiceWinners, formatNumber, scoreboard, treeRanking, interimTop, finalRanking, fastestWinners,
} from './scoring.js?v=81';

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
let previewId = null;

export async function startTv(params) {
  document.body.className = 'tv';
  requestedGameId = params?.get('spel') || null;
  previewId = params?.get('voorbeeld') || null;
  keepScreenOn();
  // Meteen iets laten zien, en een uitweg als het laden blijft hangen.
  loadingScreen(previewId ? 'Voorbeeld laden…' : 'Laden…');
  const watchdog = setTimeout(() => slowLoading(), 8000);
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) { clearTimeout(watchdog); return renderLogin(); }
    await afterLogin();
  } finally {
    clearTimeout(watchdog);
  }
}

/** Het laden duurt te lang: uitleg en knoppen in plaats van een zwart scherm. */
function slowLoading() {
  mount(stage('screen-free', heroLayout(h('div', { class: 'stack' },
    brandTitle(),
    h('p', { class: 'lead' }, 'Het laden duurt langer dan normaal. Controleer de internetverbinding.'),
    h('div', { class: 'home-buttons' },
      h('button', { class: 'btn btn-gold btn-lg', onclick: () => location.reload() }, '↻ Opnieuw proberen'),
      previewId && h('a', { class: 'btn btn-ghost btn-lg', href: '#beheer' }, '← Terug naar beheer'),
    ),
  ))));
}

// ---------------------------------------------------------------- inloggen

function renderLogin(message) {
  mount(stage('screen-free', heroLayout(h('div', { class: 'home-center' }, brandTitle(), ornament(), loginForm(afterLogin, message)))));
}

async function afterLogin() {
  await syncRealtimeAuth();
  syncClock();
  try {
    // in het voorbeeld (vanuit beheer) ook uitgezette vragen, zodat je die toch kunt bekijken
    const all = await fetchQuestions({ all: Boolean(previewId) });
    state.questions = all.filter((q) => !q.tiebreak);
    state.tiebreaks = all.filter((q) => q.tiebreak);
    prepareScareAudio(state.questions);  // alleen als er een schrik in de quiz zit
    // Muziek bij de start en het einde (Beheer → Spelinstellingen); ontbreekt de tabel/kolom, dan geen muziek.
    const { data: settings } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
    state.music = { start: settings?.start_music || null, end: settings?.end_music || null, countdown: settings?.countdown_music || null };
    state.countdownSecs = settings?.countdown_seconds || 0;  // 0 = geen aftelscherm
    state.countdownStart = settings?.countdown_music_start || 0;
    state.countdownBpm = settings?.countdown_bpm || 0;
    preloadMusic();
  } catch (e) {
    return renderLogin(errorText(e));
  }
  // Vanuit beheer: voorbeeld van één vraag (zonder spel).
  if (previewId) return startPreview(previewId);
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
  setTimeout(refreshPlayers, 500);  // na de pauze; daarna zijn ze weer vers
  const n = state.questions.length;
  const running = savedGame && savedGame.status !== 'tree' ? savedGame : null;
  const content = h('div', { class: 'home-center home' },
    brandTitle(),
    ornament(),
    n === 0 && h('p', { class: 'lead' }, 'Er staan nog geen vragen klaar. Voeg ze toe via Beheer.'),
    h('div', { class: 'home-buttons' },
      h('button', { class: 'btn btn-gold btn-lg', onclick: newGame, disabled: n === 0 }, '▶ Start quiz'),
      running && h('button', { class: 'btn btn-ghost btn-lg', onclick: () => { if (running.status === 'lobby') playMusic(state.music?.start); openGame(running); } },
        `Verder met ${running.code}`),
      h('a', { class: 'btn btn-ghost btn-lg', href: '#beheer' }, '✎ Beheer'),
    ),
    h('div', { class: 'row home-links' },
      fullscreenButton(),
      h('button', { class: 'link', onclick: showRemoteQr }, '📱 Afstandsbediening'),
      h('button', { class: 'link', onclick: logout }, 'Uitloggen'),
      h('span', { class: 'version' }, `versie ${APP_VERSION}`),
    ),
  );
  mount(stage('screen-free', heroLayout(content)));
}

/** QR-code om de afstandsbediening (#afstand) op je telefoon te openen. */
function showRemoteQr() {
  const url = `${location.href.split('#')[0]}#afstand`;
  const close = () => box.remove();
  const box = h('div', { class: 'remote-qr', onclick: close },
    h('div', { class: 'remote-qr-card', onclick: (e) => e.stopPropagation() },
      h('h2', { class: 'serif' }, '📱 Afstandsbediening'),
      h('div', { class: 'qr' }, qrSvg(url)),
      h('p', {}, 'Scan met je telefoon en log in met je beheer-account. Start daarna hier de quiz; met ◀ en ▶ op je telefoon bedien je de tablet.'),
      h('p', { class: 'muted small' }, url),
      h('button', { class: 'btn btn-gold', onclick: close }, 'Sluiten')));
  document.body.append(box);
}

async function newGame() {
  playMusic(state.music?.start); // binnen de tik starten
  state.welcome = true;          // eerst een rustig welkomstscherm, pas na een tik de QR-code
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
  await Promise.all([loadPlayers(), loadAnswered(), loadKeys(), reloadQuestions()]);
  preloadDeck();
  render();

  let debounce;
  state.stopSync = liveSync(
    `tv-${game.id}`,
    [
      { event: '*', table: 'games', filter: `id=eq.${game.id}` },
      { event: '*', table: 'players', filter: `game_id=eq.${game.id}` },
      { event: '*', table: 'answers', filter: `game_id=eq.${game.id}` },
      { event: 'INSERT', table: 'remote_commands', filter: `game_id=eq.${game.id}` },
    ],
    (payload) => {
      if (payload.table === 'remote_commands') { handleRemote(payload.new); return; }
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

/**
 * Opdracht van de afstandsbediening (#afstand op de telefoon van de quizmaster):
 * tik op dezelfde knop als de quizmaster zou doen. Oude opdrachten (na herladen) negeren.
 */
function handleRemote(cmd) {
  if (!cmd || serverNow() - new Date(cmd.created_at).getTime() > 20000) return;
  if (cmd.action === 'next') {
    const welcome = document.querySelector('.welcome-tap');
    if (welcome) return welcome.click();
    const btn = [...document.querySelectorAll('#app .btn-gold')].filter((b) => !b.disabled).pop();
    if (btn) btn.click(); else toast('Nog even wachten: de tijd loopt nog');
  } else if (cmd.action === 'prev') {
    document.querySelector('#app .q-foot .btn-ghost, #app .btn-ghost')?.click();
  } else if (cmd.action === 'replay') {
    document.querySelector('#app .intro-again')?.click();  // intro of geluidsfragment nog een keer
  }
}

function stopLive() {
  stopMedia();
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
  // Muziek van het volgende scherm meteen starten, nog binnen de tik op de knop.
  const link = mediaLinkFor(status, q);
  if (link) playMedia(link, { seconds: introSeconds(status, q), start: mediaStartFor(status, q) }); else stopMedia();
  const vpath = videoPathFor(status, q);
  // Filmpje dat al op de klap van de overgang is gestart: laten doorlopen (niet opnieuw beginnen)
  const early = earlyVideo; earlyVideo = null;
  if (vpath && vpath === early) { /* speelt al, verschijnt nu in zijn vak */ }
  else if (vpath) playVideo(vpath); else stopVideos();
  const clip = clipFor(status, q);
  if (clip) playClip(clip.path, clip.reverse); else stopClip();
  state.answerShownFor = null;  // onthul-effect van de antwoordfoto opnieuw laten beginnen
  state.busy = true;
  try {
    // In de antwoordenronde: de foto bij het antwoord, als die er is.
    let path = q.photo_path;
    if (status === 'answers') {
      const { data: k } = await sb.from('question_answers').select('answer_photo_path').eq('question_id', q.id).maybeSingle();
      if (k?.answer_photo_path) path = k.answer_photo_path;
    }
    let photoUrl = null;
    if (path) {
      const { data } = await sb.storage.from('fotos').createSignedUrl(path, SIGNED_URL_SECONDS);
      photoUrl = data?.signedUrl || null;
    }
    // Filmpje: tijdelijke link voor de telefoons (vóór de vraag start)
    const videoUrl = vpath ? await videoUrlFor(vpath) : null;
    if ((videoUrl || null) !== (state.game.video_url || null)) {
      await sb.from('games').update({ video_url: videoUrl }).eq('id', state.game.id);
      state.game = { ...state.game, video_url: videoUrl };
    }
    // Schrikbeeld: tijdelijke link klaarzetten voor de telefoons (vóór de vraag start)
    if (status === 'question' && q.scare_after && q.scare_path) {
      const url = await scareUrlFor(q);
      if (url && url !== state.game.scare_url) await sb.from('games').update({ scare_url: url }).eq('id', state.game.id);
    }
    await setState(status, q.id, photoUrl);
  } finally {
    state.busy = false;
  }
}
const goToQuestion = (index) => goTo('question', index);

/** Tijdelijke link naar het schrikbeeld van een vraag (onthouden). */
const scareUrls = new Map();
async function scareUrlFor(q) {
  if (!q?.scare_path) return null;
  if (!scareUrls.has(q.scare_path)) {
    const { data } = await sb.storage.from('fotos').createSignedUrl(q.scare_path, SIGNED_URL_SECONDS);
    if (data?.signedUrl) scareUrls.set(q.scare_path, data.signedUrl);
  }
  return scareUrls.get(q.scare_path) || null;
}

async function setState(status, questionId = null, photoUrl = null) {
  if (status !== 'question' && status !== 'answers') { stopMedia(); stopVideos(); stopClip(); }
  else if (!questionId) { stopMedia(); stopVideos(); stopClip(); }
  const { data, error } = await sb.rpc('set_game_state', {
    p_game_id: state.game.id, p_status: status, p_question_id: questionId, p_photo_url: photoUrl,
  });
  if (error) { toast(errorText(error)); return; }
  state.game = data;
  await loadAnswered();
  render();
  // spelers/filmpjes van het vorige scherm meteen weghalen (niet wachten op de controle elke seconde)
  requestAnimationFrame(() => { placeDeck(); placeVideos(); });
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
    const n = answerIndex(g.current_question_id ? i + 1 : 0, 1);
    return n != null ? goTo('answers', n) : setState('final');
  }
  if (g.status === 'final') {
    if (state.finalInfo?.pending.length && nextTiebreak()) return startSchifting();
    if (hasTrees()) return setState('tree');
  }
  if (g.status === 'schifting') return setState('final');
}

const hasTrees = () => state.questions.some((q) => q.rate_tree);

/** Vraagnummer `from` als dat bestaat (anders null). */
function answerIndex(from, step) {
  return from >= 0 && from < state.questions.length ? from : null;
}

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
  if (g.status === 'final') {
    const n = answerIndex(last, -1);
    return n != null ? goTo('answers', n) : setState('answers');
  }
  if (g.status === 'answers') {
    if (!g.current_question_id) return goTo('question', last);
    const n = answerIndex(i - 1, -1);
    return n != null ? goTo('answers', n) : setState('answers');
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
  if (g.status === 'question' && !g.current_question_id && state.countdown) bgMusic(state.music?.countdown || null);
  else if (g.status === 'lobby' || (g.status === 'question' && !g.current_question_id)) bgMusic(state.music?.start);
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

/** Welkomstscherm: alleen de naam, de sfeerfoto en de muziek. Tik ergens → wachtruimte met QR-code. */
function renderWelcome() {
  const go = () => {
    state.welcome = false;
    // Muziek laten doorlopen; alleen starten als er (nog) niets speelt
    const p = musicPlayer(state.music?.start);
    if (p && !p.isPlaying()) p.play();
    renderLobby();
  };
  mount(stage('screen-hero welcome',
    heroLayout(),
    h('button', { class: 'welcome-tap', 'aria-label': 'Verder naar de kamercode', onclick: go },
      h('div', { class: 'welcome-brand' }, brandTitle('brand-welcome'), ornament()))));
  // Alleen de naam in beeld: geen menu, geen knoppen. Na de tik verschijnt het menu weer (wachtruimte).
}

function renderLobby() {
  if (state.welcome) return renderWelcome();
  const g = state.game;
  const url = joinUrl(g.code);
  const noQuestions = state.questions.length === 0;

  const content = h('div', { class: 'lobby' },
    h('div', { class: 'lobby-head' },
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
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn btn-gold btn-lg', disabled: noQuestions,
        onclick: () => setState('question'), // eerst het uitlegscherm
      }, 'Start de quiz'),
      noQuestions && h('span', { class: 'muted' }, 'Er staan nog geen vragen klaar.'),
    ),
  );

  // Naam groot en gecentreerd bovenaan; geen namenlijst (loopt vol bij veel spelers)
  mount(stage('screen-hero', heroLayout(content), h('div', { class: 'lobby-brand' }, brandTitle('brand-lobby')), cornerMenu()));
}

// ---------------------------------------------------------------- uitleg na de start

// ---------------------------------------------------------------- aftellen vóór de eerste vraag

/** Na de uitleg: eerst aftellen (Beheer → Spelinstellingen), dan de eerste vraag. Zonder instelling meteen. */
function beginQuiz() {
  const secs = state.countdownSecs;
  if (!secs) return next();
  fxAudio();  // geluid voor de overgang alvast vrijgeven (binnen deze tik)
  new Image().src = SANTA_IMG;  // kerstman alvast inladen voor de flits
  // Met een BPM tikt de klok op de beat (bijv. 126 bpm: elke 2 tellen = 0,95 s) in plaats van elke seconde.
  const tick = countdownTickMs(state.countdownBpm);
  const total = secs * tick;
  const cd = { until: null, total, tick, count: secs };
  state.countdown = cd;
  const begin = (offsetMs = 0) => { if (state.countdown === cd && cd.until == null) cd.until = Date.now() + total - offsetMs; };
  stopMedia(); stopVideos(); stopClip();  // niets anders mag doorspelen tijdens het aftellen
  if (state.music?.countdown) {
    bgMusic(state.music.countdown);
    // De klok start pas als de muziek echt speelt, zodat beat en getal gelijk lopen (anders na 3 s toch).
    musicPlayer(state.music.countdown)?.play({ start: state.countdownStart, playing: (off) => begin(Math.max(0, Math.min(off, 1500))) }); // binnen de tik
    setTimeout(() => begin(0), 3000);
  } else { bgMusic(null); begin(0); }
  renderCountdown();
}

/** Lengte van één "seconde" van het aftellen: zonder BPM 1 s, met BPM het aantal tellen dat het dichtst bij 1 s ligt. */
function countdownTickMs(bpm) {
  if (!bpm) return 1000;
  const beat = 60000 / bpm;
  const k = Math.max(1, Math.round(1000 / beat));
  return beat * k;
}

function stopCountdown() {
  clearInterval(state.countdownTimer);
  state.countdown = null;
}

function finishCountdown() {
  if (!state.countdown) return;
  stopCountdown();
  playTransition();
  // Eerste vraag pas tonen als de flits het scherm bedekt (de muziek van het aftellen stopt daar vanzelf)
  setTimeout(next, 650 + SANTA_HOLD);  // de vraag komt eronder klaar terwijl de kerstman nog in beeld is
}

// ---------------------------------------------------------------- overgang aftellen → eerste vraag

let fxCtx = null;
/** Geluidskanaal voor de overgang; binnen een tik aanroepen, dan mag het later geluid maken. */
function fxAudio() {
  try {
    if (!fxCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      fxCtx = new AC();
    }
    if (fxCtx.state === 'suspended') fxCtx.resume();
  } catch { /* geen geluid */ }
  return fxCtx;
}

/** Witte ruis (voor klap, rommel en nagalm). */
function noiseBuffer(ctx, secs, channels = 1) {
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(channels, len, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

/**
 * Zware, lange ontploffing (zelf opgebouwd, geen geluidsbestand nodig):
 * aanzwellende woosh → harde klap → diepe dreun → rommel die ~4 s wegrolt, met nagalm.
 */
function boomSound() {
  const ctx = fxAudio();
  if (!ctx) return;
  try {
    const t = ctx.currentTime + 0.03;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.4;
    const master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master); master.connect(ctx.destination);

    // nagalm: zelfgemaakte "grote ruimte" van 3 s
    const ir = noiseBuffer(ctx, 3, 2);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= Math.pow(1 - i / d.length, 3.2);
    }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    verb.connect(wet); wet.connect(comp);

    // vervorming voor een rauwe klap
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(3 * x); }
    shaper.curve = curve;
    shaper.connect(comp); shaper.connect(verb);

    // 1. woosh: ruis die aanzwelt tot de inslag
    const whoosh = ctx.createBufferSource(); whoosh.buffer = noiseBuffer(ctx, 1.2);
    const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.Q.value = 1.5;
    wlp.frequency.setValueAtTime(200, t); wlp.frequency.exponentialRampToValueAtTime(3000, t + 0.5); wlp.frequency.exponentialRampToValueAtTime(200, t + 1.1);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t); wg.gain.exponentialRampToValueAtTime(0.3, t + 0.45); wg.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    whoosh.connect(wlp); wlp.connect(wg); wg.connect(comp); whoosh.start(t); whoosh.stop(t + 1.2);

    // de inslag valt samen met de witte flits
    const hit = t + 0.55;

    // 2. harde klap
    const crack = ctx.createBufferSource(); crack.buffer = noiseBuffer(ctx, 0.5);
    const cbp = ctx.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 1100; cbp.Q.value = 0.6;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, hit); cg.gain.exponentialRampToValueAtTime(1.0, hit + 0.005); cg.gain.exponentialRampToValueAtTime(0.0001, hit + 0.35);
    crack.connect(cbp); cbp.connect(cg); cg.connect(shaper); crack.start(hit); crack.stop(hit + 0.5);

    // 3. diepe dreun (sub) en een "lijf" erboven
    [[72, 22, 1.0, 'sine', 3.8], [130, 32, 0.55, 'triangle', 1.6]].forEach(([f0, f1, vol, type, dur]) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, hit); o.frequency.exponentialRampToValueAtTime(f1, hit + dur * 0.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, hit); g.gain.exponentialRampToValueAtTime(vol, hit + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, hit + dur);
      o.connect(g); g.connect(type === 'sine' ? comp : shaper); o.start(hit); o.stop(hit + dur + 0.05);
    });

    // 4. rommel: lage ruis die ~4 s naklinkt en rollend wegsterft
    const rumble = ctx.createBufferSource(); rumble.buffer = noiseBuffer(ctx, 4.5);
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.Q.value = 0.9;
    rlp.frequency.setValueAtTime(600, hit); rlp.frequency.exponentialRampToValueAtTime(70, hit + 4.2);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, hit); rg.gain.exponentialRampToValueAtTime(0.9, hit + 0.06);
    rg.gain.exponentialRampToValueAtTime(0.35, hit + 1.5); rg.gain.exponentialRampToValueAtTime(0.0001, hit + 4.4);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.25;
    const roll = ctx.createGain(); roll.gain.value = 1;
    lfo.connect(lfoGain); lfoGain.connect(roll.gain);
    rumble.connect(rlp); rlp.connect(rg); rg.connect(roll); roll.connect(comp); roll.connect(verb);
    rumble.start(hit); rumble.stop(hit + 4.5); lfo.start(hit); lfo.stop(hit + 4.5);

    // daarna het geluidskanaal weer dicht (laat Spotify ongestoord), pas na de nagalm
    setTimeout(() => { try { ctx.suspend(); } catch { /* */ } }, 6200);
  } catch { /* geen geluid */ }
}

/** Filmpje van de eerste vraag dat al tijdens de overgang speelt. */
let earlyVideo = null;

const SANTA_IMG = 'assets/kerstman-flits.jpg?v=81';
/** Zo lang blijft de kerstman extra in beeld voordat de eerste vraag eronder klaarstaat. */
const SANTA_HOLD = 1300;

/** Gouden flits; in het licht verschijnt de kerstman, die daarna oplost in het donker; dan komt de eerste vraag. */
function playTransition() {
  boomSound();
  // 1. het laatste getal vliegt naar je toe en lost op in licht; het beeld eromheen wordt donker
  document.querySelector('.countdown-num')?.classList.add('morph-out');
  document.querySelector('.countdown')?.classList.add('countdown-collapse');
  // 2. gouden licht zwelt aan tot een witte flits; daaruit komt de kerstman tevoorschijn
  const fx = h('div', { class: 'morph', 'aria-hidden': 'true' },
    h('div', { class: 'morph-veil' }), h('div', { class: 'morph-burst' }),
    h('img', { class: 'morph-santa', src: SANTA_IMG, alt: '' }),
    h('div', { class: 'morph-flash' }));
  document.body.append(fx);
  // Begint de eerste vraag met een filmpje? Dan start dat (onzichtbaar) al op de klap, zodat het
  // geluid tijdens de dreun begint; in beeld komt het pas in zijn eigen vak bij de eerste vraag.
  const q0 = state.questions[0];
  const vp0 = q0 ? videoPathFor('question', q0) : null;
  if (vp0) setTimeout(() => { if (state.game?.status === 'question' && currentIndex() < 0) { earlyVideo = vp0; playVideo(vp0); } }, 580);
  // 3. de vraag komt daarna uit het donker tevoorschijn, onderdeel voor onderdeel
  document.body.classList.add('morph-enter');
  setTimeout(() => fx.remove(), 3800);
  setTimeout(() => document.body.classList.remove('morph-enter'), 3600 + SANTA_HOLD);
}

function renderCountdown() {
  const cd = state.countdown;
  // Tot de muziek echt speelt (until nog leeg) staat de klok stil op het beginaantal.
  const msLeft = () => (cd.until == null ? cd.total : Math.max(0, cd.until - Date.now()));
  const left = () => Math.ceil(msLeft() / cd.tick);
  const elapsed = (cd.total - msLeft()) / 1000;
  const num = h('div', { class: 'countdown-num', 'aria-live': 'polite' }, String(left()));
  const grow = h('div', { class: 'countdown-grow' }, num);
  // "Quiz begint in" en het sierlijntje verdwijnen na een paar seconden; daarna alleen het getal
  const fadeDelay = `${Math.min(3, cd.total / 3000) - elapsed + (cd.until == null ? 0.5 : 0)}s`;
  const title = h('p', { class: 'countdown-title', style: { animationDelay: fadeDelay } }, 'Quiz begint in');
  const orn = ornament(); orn.classList.add('countdown-orn'); orn.style.animationDelay = fadeDelay;
  const view = h('div', { class: 'countdown' },
    h('div', { class: 'countdown-center' }, title, grow, orn),
    h('footer', { class: 'q-foot countdown-foot', style: { animationDelay: fadeDelay } },
      h('button', { class: 'btn btn-ghost', onclick: () => { stopCountdown(); bgMusic(state.music?.start); renderRules(); } }, '◀ Terug'),
      h('button', { class: 'btn btn-gold btn-lg btn-arrow', onclick: finishCountdown, 'aria-label': 'Nu beginnen', title: 'Nu beginnen' }, '▶'),
    ),
  );
  mount(stage('screen-hero', heroLayout(), view));
  const update = () => {
    if (!state.countdown) return clearInterval(state.countdownTimer);
    // het getal wordt steeds groter
    const progress = 1 - msLeft() / cd.total;
    grow.style.transform = `scale(${(0.45 + progress * 0.95).toFixed(3)})`;
    const n = left();
    // Bij 0 geen "0" tonen: het laatste getal lost op in de overgang
    if (n <= 0 && cd.until != null) { finishCountdown(); return; }
    if (num.textContent !== String(n)) {
      num.textContent = String(n);
      const final = n > 0 && n <= 5;
      view.classList.toggle('countdown-final', final);
      // laatste seconden: harde hartslag (beeld en geluid), daarvoor een rustige tik
      num.classList.remove('tick', 'beat'); void num.offsetWidth; num.classList.add(final ? 'beat' : 'tick');
      if (final) heartbeat(n);
    }
    if (n <= 0 && cd.until != null) finishCountdown();
  };
  clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(update, 20);  // vaak kijken, zodat elke tel precies op tijd valt
  update();
}

/** Doffe hartslag (twee slagen) in de laatste seconden van het aftellen; hoe dichter bij 0, hoe harder. */
function heartbeat(n) {
  const ctx = fxAudio();
  if (!ctx) return;
  try {
    const vol = 0.5 + (5 - n) * 0.15;  // iets harder, zodat hij boven de muziek uitkomt
    [0, 0.17].forEach((dt, k) => {
      const t = ctx.currentTime + 0.02 + dt;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * (k ? 0.7 : 1), t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      const comp = ctx.createDynamicsCompressor();
      o.connect(g); g.connect(comp); comp.connect(ctx.destination); o.start(t); o.stop(t + 0.3);
    });
  } catch { /* geen geluid */ }
}

function renderRules() {
  if (state.countdown) return renderCountdown();
  const qs = state.questions;
  const has = (fn) => qs.some(fn);
  const tiles = [
    ['📱', 'Antwoord op je telefoon', 'Wijzigen mag tot de tijd om is'],
    ['⭐', '1 punt per goed antwoord', has((q) => q.kind === 'open') ? 'Een tikfout is niet erg' : 'Hoe meer goed, hoe beter'],
    has((q) => q.kind === 'schatting') && ['🎯', 'Schatten', 'De 3 dichtstbij krijgen een punt'],
    has((q) => q.rate_tree) && ['🎄', 'Kerstbomen', 'Geef elke boom een cijfer'],
    ['🏆', 'Uitslag aan het eind', state.tiebreaks.length ? 'Gelijk? Extra vraag!' : 'Eerst alle vragen, dan de antwoorden'],
  ].filter(Boolean);

  const view = h('div', { class: 'rules' },
    h('div', { class: 'rules-top' },
      h('h1', { class: 'rules-title' }, 'Zo werkt het'),
      ornament(),
    ),
    h('ul', { class: 'rules-tiles' }, tiles.map(([icon, title, sub]) => h('li', { class: 'rules-tile' },
      h('span', { class: 'rules-tile-icon', 'aria-hidden': 'true' }, icon),
      h('strong', {}, title),
      h('span', { class: 'muted' }, sub),
    ))),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      h('span', { class: 'muted rules-count' }, `${qs.length} vragen · ${playersCountText().toLowerCase()}`),
      h('button', { class: 'btn btn-gold btn-lg btn-arrow', onclick: beginQuiz, 'aria-label': state.countdownSecs ? 'Aftellen' : 'Eerste vraag', title: state.countdownSecs ? 'Aftellen' : 'Eerste vraag' }, '▶'),
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
  if (inScarePhase(state.game, q)) return renderScareQuestion(q, i);
  const vpath = q.video_path || null;
  const photo = vpath ? null : state.game.photo_url;
  const isLast = i === state.questions.length - 1;

  const options = (q.options || []).map((text, k) =>
    h('div', { class: `option opt-${LETTERS[k].toLowerCase()}` },
      h('span', { class: 'letter', 'aria-hidden': 'true' }, LETTERS[k]),
      h('span', { class: 'option-text' }, h('span', { class: 'sr-only' }, `${LETTERS[k]}: `), text),
    ));

  const intro = q.media_url && q.media_seconds;
  const view = h('div', { class: `question ${photo || vpath ? 'has-photo' : ''}` },
    h('header', { class: 'q-head' },
      h('div', { class: 'q-meta' },
        q.category && h('span', { class: 'label' }, q.category),
        h('span', { class: 'muted q-count' }, `Vraag ${i + 1} van ${state.questions.length}`),
        q.fastest_count && q.kind !== 'schatting' && h('span', { class: 'fast-badge' }, `⚡ Alleen de ${q.fastest_count} snelsten krijgen een punt`),
      ),
      h('div', { class: 'q-status' },
        h('span', { class: 'answered', id: 'answered' }, answeredText()),
        h('div', { class: 'timer', id: 'timer', role: 'timer' }, ''),
      ),
    ),
    h('div', { class: 'q-body' },
      photo && photoBox(q, photo),
      vpath && videoSlot(vpath),
      h('div', { class: 'q-main' },
        h('h2', { class: 'q-text' }, q.text),
        // Spotify alleen op de tv: speler in beeld, of alleen geluid (ook voor oude "afgedekt"-vragen)
        q.media_url && !['alleen_geluid', 'verbergen'].includes(q.media_mode) && !intro && mediaSlot(q.media_url, 'tonen'),
        q.kind === 'meerkeuze' && h('div', { class: 'options' }, options),
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      q.rate_tree && h('p', { class: 'rate-hint' }, '★ Geef deze boom ook een cijfer op je telefoon'),
      intro && h('button', {
        class: 'btn btn-ghost intro-again', onclick: () => playMedia(q.media_url, { seconds: q.media_seconds, start: q.media_start || 0 }),
      }, `♪ Nog een keer (${q.media_seconds} s)`),
      q.audio_path && h('button', {
        class: 'btn btn-ghost intro-again', onclick: () => playClip(q.audio_path, Boolean(q.audio_reverse)),
      }, q.audio_reverse ? '⏪ Nog een keer' : '🔊 Nog een keer'),
      h('button', { class: 'btn btn-gold btn-lg btn-arrow', id: 'next-btn', onclick: next, 'aria-label': isLast ? 'Einde vragenronde' : 'Volgende vraag', title: isLast ? 'Einde vragenronde' : 'Volgende vraag' }, '▶'),
    ),
  );

  mount(stage('screen-plain', bgLayer(i, Boolean(photo)), view));
  updateTimer();

  const startedAt = state.game.question_started_at;
  armScare(q);
  answerAsTestPlayers(state.game, q, () => state.game.status === 'question'
    && state.game.current_question_id === q.id && state.game.question_started_at === startedAt
    && secondsLeft(state.game, q) > 0);
}

/** Schrik voor deze vraag klaarzetten (of een oude annuleren). */
function armScare(q) {
  const startedAt = state.game.question_started_at;
  if (!q.scare_after) return scheduleScare(state.game, q);
  const still = () => state.game.status === 'question'
    && state.game.current_question_id === q.id && state.game.question_started_at === startedAt;
  if (q.scare_path) scareUrlFor(q).then((url) => scheduleScare(state.game, q, still, url));
  else scheduleScare(state.game, q, still);
}

/** Schrikvraag: alleen de tekst ("Kijk goed…"), alsof er een vraag komt. */
function renderScareQuestion(q, i) {
  const photo = state.game.photo_url;
  const view = h('div', { class: `question scare-q ${photo ? 'has-photo' : ''}` },
    h('header', { class: 'q-head' },
      h('div', { class: 'q-meta' },
        q.category && h('span', { class: 'label' }, q.category),
        h('span', { class: 'muted q-count' }, `Vraag ${i + 1} van ${state.questions.length}`),
      ),
    ),
    h('div', { class: 'q-body' },
      photo && h('div', { class: 'photo' }, h('img', { src: photo, alt: '' })),
      h('div', { class: 'q-main scare-main' }, h('h2', { class: 'q-text scare-text' }, q.scare_text || 'Kijk goed…')),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      h('button', { class: 'btn btn-gold btn-lg btn-arrow', id: 'next-btn', onclick: next, 'aria-label': 'Volgende vraag', title: 'Volgende vraag' }, '▶'),
    ),
  );
  mount(stage('screen-plain', bgLayer(i, Boolean(photo)), view));
  armScare(q);
  // Na de schrik de echte vraag tonen
  const startedAt = state.game.question_started_at;
  const end = new Date(startedAt).getTime() + ((q.scare_after || 0) + SCARE_SECONDS) * 1000;
  clearTimeout(state.scareTimer);
  state.scareTimer = setTimeout(() => {
    if (state.game.status === 'question' && state.game.current_question_id === q.id && state.game.question_started_at === startedAt) render();
  }, Math.max(0, end - serverNow()) + 50);
}

function renderAnswersIntro() {
  const content = h('div', { class: 'stack' },
    h('h1', { class: 'title' }, 'De antwoorden'),
    h('p', { class: 'lead' }, 'Alle vragen nog een keer, nu met het goede antwoord.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-ghost btn-lg', onclick: previous }, '◀ Terug naar de laatste vraag'),
      h('button', { class: 'btn btn-gold btn-lg btn-arrow', onclick: next, 'aria-label': 'Toon de antwoorden', title: 'Toon de antwoorden' }, '▶'),
    ),
  );
  mount(stage('screen-hero', heroLayout(content), cornerMenu()));
  // Antwoorden (en antwoordmuziek/-filmpjes) opnieuw ophalen: misschien is er in beheer
  // nog iets aangepast nadat de quiz is geopend. Spelers alvast laden, zodat ze bij de tik starten.
  loadKeys().then(preloadDeck).catch(() => {});
  setTimeout(refreshPlayers, 500);
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
    fetchAll(() => sb.from('answers').select('player_id, question_id, choice, text_answer, number_answer, rating, answered_at')
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
  setTimeout(refreshPlayers, 500);
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
      h('button', { class: 'btn btn-gold btn-lg btn-arrow', onclick: next, 'aria-label': 'Volgende vraag', title: 'Volgende vraag' }, '▶'),
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
    sb.from('answers').select('player_id, choice, text_answer, number_answer, answered_at').eq('game_id', g.id).eq('question_id', qid),
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
  const vpath = r.key?.answer_video_path || (q.audio_reverse && isVideoClip(q) ? q.audio_path : null);
  const photo = vpath ? null : state.game.photo_url;
  const isLast = answerIndex(i + 1, 1) == null;

  let body;
  let winners;
  // Alleen de antwoordfoto/-filmpje tonen, zonder antwoordtekst (in beheer aangevinkt)
  const photoOnly = Boolean(r.key?.hide_answer_text && (photo || vpath) && q.kind !== 'schatting');
  if (!r.key) {
    winners = new Set();
    body = h('p', { class: 'lead muted' }, 'Bij deze vraag is nog geen goed antwoord ingevuld in beheer.');
  } else if (q.kind === 'meerkeuze') {
    winners = fastestWinners(q, choiceWinners(r.answers, r.key.correct_option), r.answers);
    body = photoOnly ? null : revealChoice(q, r.key.correct_option);
  } else if (q.kind === 'open') {
    const groups = judgeOpen(r.answers, r.key.correct_texts, r.overrides);
    winners = fastestWinners(q, new Set(groups.filter((g) => g.correct).flatMap((g) => g.playerIds)), r.answers);
    body = revealOpen(q, r.key, groups, photoOnly);
  } else {
    winners = estimateWinners(r.answers, r.key.correct_value);
    body = revealEstimate(q, r.key, r.answers, winners);
  }

  const n = state.players.length;
  if (q.fastest_count && r.key && q.kind !== 'schatting') {
    const names = new Map(state.players.map((p) => [p.id, p.name]));
    const order = r.answers.filter((a) => winners.has(a.player_id))
      .sort((a, b) => new Date(a.answered_at) - new Date(b.answered_at)).map((a) => names.get(a.player_id)).filter(Boolean);
    body = [body, h('p', { class: 'fast-list' }, `⚡ Punt voor de ${q.fastest_count} snelsten: `,
      order.length ? order.join(' · ') : 'niemand had het goed')];
  }
  const mediaLink = r.key?.answer_media_url || null;  // alleen het nummer dat bij het antwoord is ingevuld
  const view = h('div', { class: `question reveal reveal-${q.kind} ${photo || vpath ? 'has-photo' : q.kind === 'open' ? 'reveal-center' : ''} ${photoOnly ? 'photo-only' : ''}` },
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
      photo && answerPhotoBox(q, r.key, photo),
      vpath && videoSlot(vpath),
      h('div', { class: 'q-main' },
        h('h2', { class: 'q-text q-text-small' }, q.text),
        body,
      ),
    ),
    h('footer', { class: 'q-foot' },
      h('button', { class: 'btn btn-ghost', onclick: previous }, '◀ Vorige'),
      mediaLink && !r.key?.answer_media_hidden && mediaSlot(mediaLink, 'tonen', 'media-foot'),
      clipFor('answers', q) && h('button', {
        class: 'btn btn-ghost intro-again', onclick: () => playClip(q.audio_path, false),
      }, '▶ Vooruit afspelen'),
      h('button', { class: 'btn btn-gold btn-lg btn-arrow', onclick: () => { if (isLast) playMusic(state.music?.end); next(); }, 'aria-label': isLast ? 'Einde antwoordenronde' : 'Volgende antwoord', title: isLast ? 'Einde antwoordenronde' : 'Volgende antwoord' }, '▶'),
    ),
  );
  mount(stage('screen-plain', bgLayer(i, Boolean(photo)), view));
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

function revealOpen(q, key, groups, hideCard = false) {
  // De ingezonden antwoorden staan standaard dicht; de quizmaster kan ze openklappen om iets goed/fout te rekenen.
  const open = state.showGroups === q.id;
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
    : h('p', { class: 'muted small' }, 'Niemand heeft deze vraag beantwoord.');
  return h('div', { class: 'open-answer' },
    !hideCard && h('div', { class: 'answer-card' },
      h('span', { class: 'mark mark-good', 'aria-hidden': 'true' }, '✓'),
      h('span', { class: 'answer-card-text' }, (key.correct_texts || [])[0] || ''),
    ),
    groups.length > 0 && h('button', {
      class: 'link groups-toggle',
      onclick: () => { state.showGroups = open ? null : q.id; renderReveal(); },
    }, open ? 'Ingezonden antwoorden verbergen ▴' : `Ingezonden antwoorden bekijken (${groups.length}) ▾`),
    open && list,
    open && groups.length > 0 && h('p', { class: 'muted small' }, 'Tik op een antwoord om het goed of fout te rekenen.'),
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

/**
 * Spotify-spelers die al lang bestaan en nu niet spelen, vernieuwen (op een rustig moment).
 * Een speler die lang heeft stilgestaan, reageert soms niet meer tot je de pagina ververst.
 */
function refreshPlayers() {
  for (const p of deck.values()) p.refreshIfOld?.();
  for (const p of musicPlayers.values()) p.refreshIfOld?.();
}

/** Spelers alvast laden, zodat ze bij een tik meteen kunnen starten. */
function preloadMusic() {
  musicPlayer(state.music?.start);
  musicPlayer(state.music?.end);
  musicPlayer(state.music?.countdown);
}

// ---------------------------------------------------------------- voorbeeld (vanuit beheer)

/**
 * Voorbeeld van een vraag zoals de tv hem toont, zonder spel en zonder spelers:
 * er wordt niets opgeslagen. Met een balk bovenin om te bladeren, het antwoord
 * te bekijken en de telefoonweergave ernaast te zetten.
 */
const preview = { list: [], index: 0, mode: 'vraag', phone: false, keys: new Map() };

async function startPreview(id) {
  preview.list = [...state.questions, ...state.tiebreaks];
  preview.index = Math.max(0, preview.list.findIndex((q) => q.id === id));
  const { data } = await sb.from('question_answers').select('*');
  preview.keys = new Map((data || []).map((k) => [k.question_id, k]));
  state.keys = preview.keys;
  preloadDeck();
  state.players = [];
  clearInterval(state.tick);
  state.tick = setInterval(updateTimer, 250);
  // Muziek en filmpje van de eerste vraag meteen starten (de tik op 👁 Voorbeeld telt als tik)
  const first = preview.list[preview.index];
  const link = first && !first.tiebreak ? mediaLinkFor('question', first) : null;
  if (link) playMedia(link, { seconds: introSeconds('question', first), start: mediaStartFor('question', first) });
  const vp = first && !first.tiebreak ? videoPathFor('question', first) : null;
  if (vp) playVideo(vp);
  const clip = first && !first.tiebreak ? clipFor('question', first) : null;
  if (clip) playClip(clip.path, clip.reverse);
  await showPreview();
}

async function showPreview() {
  try {
    await showPreviewInner();
  } catch (e) {
    console.error(e);
    toast(`Dit voorbeeld kon niet worden getoond: ${errorText(e)}`);
    previewChrome(preview.list[preview.index] || {});
  }
}

async function showPreviewInner() {
  const q = preview.list[preview.index];
  if (!q) return;
  history.replaceState(null, '', `#tv?voorbeeld=${q.id}`);
  const answers = preview.mode === 'antwoord' && !q.tiebreak;
  const path = (answers && preview.keys.get(q.id)?.answer_photo_path) || q.photo_path;
  let photoUrl = null;
  if (path) {
    const { data } = await sb.storage.from('fotos').createSignedUrl(path, 60 * 60);
    photoUrl = data?.signedUrl || null;
  }
  state.game = {
    id: 'voorbeeld',
    status: q.tiebreak ? 'schifting' : answers ? 'answers' : 'question',
    current_question_id: q.id,
    question_started_at: new Date(Date.now()).toISOString(),
    photo_url: photoUrl,
    tiebreak_names: q.tiebreak ? ['Speler 1', 'Speler 2'] : null,
    tiebreak_done: [],
    winners: null,
  };
  state.answered = 0;
  state.schiftingResult = false;
  if (answers) {
    state.reveal = { qid: q.id, answers: [], key: preview.keys.get(q.id) || null, overrides: new Map() };
    await renderReveal();
  } else if (q.tiebreak) {
    renderSchifting();
  } else {
    renderQuestion();
  }
  previewChrome(q);
}

/** Knoppen van het spel vervangen door de voorbeeldbalk (niets mag het spel aansturen). */
function previewChrome(q) {
  const foot = document.querySelector('.q-foot');
  if (foot) foot.replaceChildren();
  document.querySelectorAll('#answered, .score-pill').forEach((el) => el.remove());
  const showPhone = preview.phone && !q.tiebreak && preview.mode === 'vraag';
  document.body.classList.add('pv-on');
  document.body.classList.toggle('pv-with-phone', showPhone);
  document.getElementById('preview-bar')?.remove();
  const n = preview.list.length;
  const previewMedia = () => {
    const t = preview.list[preview.index];
    const mode = preview.mode === 'antwoord' ? 'answers' : 'question';
    state.answerShownFor = null;
    const link = t && !t.tiebreak ? mediaLinkFor(mode, t) : null;
    if (link) playMedia(link, { seconds: introSeconds(mode, t), start: mediaStartFor(mode, t) }); else stopMedia();
    const vp = t && !t.tiebreak ? videoPathFor(preview.mode === 'antwoord' ? 'answers' : 'question', t) : null;
    if (vp) playVideo(vp); else stopVideos();
    const clip = t && !t.tiebreak ? clipFor(mode, t) : null;
    if (clip) playClip(clip.path, clip.reverse); else stopClip();
  };
  const go = (d) => { preview.index = (preview.index + d + n) % n; previewMedia(); showPreview(); };
  const normal = state.questions.length;
  const count = q.tiebreak ? `Schifting ${preview.index - normal + 1}/${state.tiebreaks.length}` : `Vraag ${preview.index + 1}/${normal}`;
  const setMode = (m) => { preview.mode = m; previewMedia(); showPreview(); };
  const bar = h('div', { id: 'preview-bar', class: 'preview-bar' },
    h('strong', { title: 'Er wordt niets opgeslagen' }, '👁 Voorbeeld'),
    h('button', { class: 'pv-btn', onclick: () => go(-1), 'aria-label': 'Vorige vraag' }, '◀'),
    h('span', { class: 'pv-count' }, count),
    h('button', { class: 'pv-btn', onclick: () => go(1), 'aria-label': 'Volgende vraag' }, '▶'),
    !q.tiebreak && h('span', { class: 'pv-seg' },
      h('button', { class: 'pv-btn', 'aria-pressed': String(preview.mode === 'vraag'), onclick: () => setMode('vraag') }, 'Vraag'),
      h('button', { class: 'pv-btn', 'aria-pressed': String(preview.mode === 'antwoord'), onclick: () => setMode('antwoord') }, 'Antwoord'),
    ),
    h('button', { class: 'pv-btn', 'aria-pressed': String(preview.phone), onclick: () => { preview.phone = !preview.phone; showPreview(); } }, '📱 Telefoon'),
    h('button', { class: 'pv-btn', onclick: () => { preview.phone = false; startQuestion(q); } }, '↻ Timer'),
    h('a', { class: 'pv-btn pv-close', href: '#beheer' }, '✕ Sluiten'),
  );
  document.body.append(bar);

  document.getElementById('preview-phone')?.remove();
  if (showPhone) {
    document.body.append(h('div', { id: 'preview-phone', class: 'preview-phone' },
      h('iframe', { src: `${location.pathname}#speler?voorbeeld=${q.id}`, title: 'Telefoon-voorbeeld' })));
  }
}

/** Timer (en telefoon) opnieuw laten beginnen. */
function startQuestion() { showPreview(); }

// ---------------------------------------------------------------- muziek bij vraag en antwoord

/**
 * Alle Spotify-spelers van de vragen en antwoorden worden bij het openen van een
 * spel alvast (onzichtbaar) geladen. Een tik op "Volgende vraag" e.d. start dan
 * meteen het nummer van het volgende scherm. Op het scherm staat een vak
 * (.media-slot); de speler wordt daar precies overheen gelegd, zodat hij niet
 * opnieuw hoeft te laden (en de muziek doorloopt).
 */
const deck = new Map(); // link → deckPlayer
let deckBox = null;

/** Vragen en spelinstellingen opnieuw ophalen (misschien is er in beheer iets aangepast sinds het inloggen). */
async function reloadQuestions() {
  try {
    const { data: st } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
    if (st) {
      state.music = { start: st.start_music || null, end: st.end_music || null, countdown: st.countdown_music || null };
      state.countdownSecs = st.countdown_seconds || 0;
      state.countdownStart = st.countdown_music_start || 0;
      state.countdownBpm = st.countdown_bpm || 0;
      preloadMusic();
    }
  } catch { /* oude instellingen houden */ }
  try {
    const all = await fetchQuestions();
    state.questions = all.filter((q) => !q.tiebreak);
    state.tiebreaks = all.filter((q) => q.tiebreak);
    prepareScareAudio(state.questions);
  } catch { /* oude lijst houden */ }
}

async function loadKeys() {
  const { data } = await sb.from('question_answers').select('*');
  state.keys = new Map((data || []).map((k) => [k.question_id, k]));
}

function mediaLinkFor(status, q) {
  if (!q) return null;
  if (status === 'answers') return state.keys?.get(q.id)?.answer_media_url || null;
  if (status === 'question') return q.media_url || null;
  return null;
}

function deckFor(link) {
  if (!link) return null;
  let p = deck.get(link);
  if (!p) {
    p = deckPlayer(link);
    if (!p) return null;
    if (!deckBox) { deckBox = h('div', { id: 'media-deck', 'aria-hidden': 'true' }); document.body.append(deckBox); }
    deck.set(link, p);
    deckBox.append(p.el);
  }
  return p;
}

function preloadDeck() {
  preloadVideos();
  for (const q of state.questions) if (q.audio_path) loadClip(q.audio_path);
  for (const q of state.questions) {
    deckFor(q.media_url);
    deckFor(state.keys?.get(q.id)?.answer_media_url);
  }
}

function playMedia(link, opts = {}) {
  for (const [l, p] of deck) if (l !== link) p.pause();
  deckFor(link)?.play(opts);
}

/** Intro raden: hoeveel seconden van het nummer bij deze vraag (alleen tijdens de vraag). */
const introSeconds = (status, q) => (status === 'question' && q?.media_seconds) || null;

/** Beginpunt (seconden) van het nummer bij de vraag of bij het antwoord (beheer). */
const mediaStartFor = (status, q) => (status === 'answers' ? state.keys?.get(q?.id)?.answer_media_start : q?.media_start) || 0;

function stopMedia() {
  for (const p of deck.values()) p.pause();
}

/** Vak voor de speler op het scherm. Afgedekt: eigen ▶/⏸-knop, speler onzichtbaar. */
function mediaSlot(link, mode, extraClass = '') {
  const covered = mode === 'verbergen';
  const slot = h('div', { class: `media-slot ${covered ? 'media-covered' : ''} ${extraClass}`, 'data-link': link, 'data-covered': String(covered) });
  if (covered) {
    const p = deckFor(link);
    const btn = h('button', { type: 'button', class: 'music-play', 'aria-label': 'Afspelen', onclick: () => p?.toggle() }, '▶');
    const wrap = h('div', { class: 'music-wrap' },
      h('div', { class: 'music-cover' },
        h('span', { class: 'music-bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
        h('span', { class: 'music-cover-text' }, 'Luister goed…'),
        btn));
    p?.onChange((playing) => {
      btn.textContent = playing ? '⏸' : '▶';
      btn.setAttribute('aria-label', playing ? 'Pauzeren' : 'Afspelen');
      wrap.classList.toggle('is-playing', playing);
    });
    slot.append(wrap);
  }
  requestAnimationFrame(placeDeck);
  return slot;
}

/** Leg de speler van het zichtbare vak over dat vak; de rest buiten beeld. */
function placeDeck() {
  const slot = document.querySelector('.media-slot');
  const showLink = slot && slot.dataset.covered !== 'true' ? slot.dataset.link : null;
  const r = showLink ? slot.getBoundingClientRect() : null;
  for (const [l, p] of deck) {
    const on = l === showLink && r && r.width > 0;
    p.el.classList.toggle('deck-show', Boolean(on));
    if (on) Object.assign(p.el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    else Object.assign(p.el.style, { left: '', top: '', width: '', height: '' });
  }
}
window.addEventListener('resize', () => requestAnimationFrame(placeDeck));
document.addEventListener('fullscreenchange', () => setTimeout(placeDeck, 300));
setInterval(placeDeck, 1000);

// ---------------------------------------------------------------- geluidsfragment (ook achterstevoren)

/**
 * Eigen geluidsfragment bij een vraag (beheer). De tv laadt en decodeert het vooraf en kan
 * het achterstevoren afspelen (bij de vraag) en vooruit (bij het antwoord). Alleen op de tv.
 */
const clips = new Map();   // pad → { ready: Promise<{ fwd, rev }> }
let clipCtx = null;
let clipSrc = null;

function clipFor(status, q) {
  if (!q?.audio_path) return null;
  if (status === 'question') return { path: q.audio_path, reverse: Boolean(q.audio_reverse) };
  // Bij het antwoord vooruit, tenzij er dan een filmpje speelt (anders klinkt het dubbel)
  if (status === 'answers' && q.audio_reverse && !videoPathFor('answers', q)) return { path: q.audio_path, reverse: false };
  return null;
}

function clipContext() {
  if (!clipCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    clipCtx = new AC();
  }
  return clipCtx;
}

function loadClip(path) {
  let c = clips.get(path);
  if (c) return c;
  const ctx = clipContext();
  if (!ctx) return null;
  c = {
    ready: sb.storage.from('fotos').createSignedUrl(path, SIGNED_URL_SECONDS)
      .then(({ data }) => fetch(data.signedUrl))
      .then((r) => r.arrayBuffer())
      .then((ab) => new Promise((ok, fail) => ctx.decodeAudioData(ab, ok, fail)))
      .then((fwd) => {
        // omgekeerde kopie maken
        const rev = ctx.createBuffer(fwd.numberOfChannels, fwd.length, fwd.sampleRate);
        for (let ch = 0; ch < fwd.numberOfChannels; ch++) {
          const src = fwd.getChannelData(ch);
          const dst = rev.getChannelData(ch);
          for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
        }
        return { fwd, rev };
      }),
  };
  c.ready.catch(() => clips.delete(path));  // mislukt: later opnieuw proberen
  clips.set(path, c);
  return c;
}

/** Afspelen; moet binnen een tik worden aangeroepen (dan mag de browser geluid maken). */
function playClip(path, reverse) {
  const ctx = clipContext();
  if (!ctx) return;
  stopClip();
  if (ctx.state === 'suspended') ctx.resume();   // binnen de tik: geluid vrijgeven
  const c = loadClip(path);
  const token = {};
  clipSrc = token;
  c?.ready.then(({ fwd, rev }) => {
    if (clipSrc !== token) return;                // intussen alweer gestopt of iets anders gestart
    const src = ctx.createBufferSource();
    src.buffer = reverse ? rev : fwd;
    src.connect(ctx.destination);
    src.onended = () => {
      if (clipSrc !== token) return;
      clipSrc = null;
      try { ctx.suspend(); } catch { /* */ }       // geluidskanaal weer dicht (laat Spotify ongestoord)
    };
    if (ctx.state === 'suspended') ctx.resume();
    src.start();
    token.src = src;
  }).catch(() => toast('Het geluidsfragment kon niet worden geladen.'));
}

function stopClip() {
  const t = clipSrc;
  clipSrc = null;
  try { t?.src?.stop(); } catch { /* */ }
  if (t && clipCtx) { try { clipCtx.suspend(); } catch { /* */ } }
}

// ---------------------------------------------------------------- foto langzaam onthullen

/**
 * Vraagfoto, eventueel met een onthul-effect: langzaam scherper, langzaam uitzoomen of
 * puzzelstukjes die wegvallen. Het effect loopt mee met de tijd van de vraag (ook na herladen).
 */
function photoBox(q, photo) {
  if (!q.reveal_effect || state.game.status !== 'question') return h('div', { class: 'photo' }, h('img', { src: photo, alt: '' }));
  const total = Math.max(4, (q.time_limit || 20) * 0.85);       // na 85% van de tijd helemaal zichtbaar
  const elapsed = Math.max(0, (serverNow() - new Date(state.game.question_started_at).getTime()) / 1000);
  return fxPhoto(q.reveal_effect, photo, total, elapsed, q.id);
}

/** Antwoordfoto langzaam onthullen (in beheer ingesteld): in een vaste tijd vanaf het moment dat het antwoord verschijnt. */
const ANSWER_REVEAL_SECONDS = 8;
function answerPhotoBox(q, key, photo) {
  const fx = key?.answer_reveal_effect;
  if (!fx || !key.answer_photo_path) return h('div', { class: 'photo' }, h('img', { src: photo, alt: '' }));
  const mark = `${q.id}|${state.game.id}`;
  if (state.answerShownFor !== mark) { state.answerShownFor = mark; state.answerShownAt = Date.now(); }
  const elapsed = (Date.now() - state.answerShownAt) / 1000;
  return fxPhoto(fx, photo, ANSWER_REVEAL_SECONDS, elapsed, `${q.id}-antwoord`);
}

/** Foto met onthul-effect: wazig → scherp, uitzoomen of puzzelstukjes die wegvallen. */
function fxPhoto(fx, photo, total, elapsed, seedText) {
  const img = h('img', { src: photo, alt: '' });
  // Lijst in de verhouding van de foto (zo blijft de hele foto in beeld); het vak eromheen is onzichtbaar.
  const frame = h('div', { class: 'fx-frame' }, img);
  const box = h('div', { class: `photo photo-fx fx-${fx}` }, frame);
  img.addEventListener('load', () => fitFxFrame(frame));
  requestAnimationFrame(() => fitFxFrame(frame));
  img.style.animationDuration = `${total}s`;
  img.style.animationDelay = `${-elapsed}s`;
  if (fx === 'puzzel') {
    const cols = 6; const rows = 4; const n = cols * rows;
    // vaste, maar door elkaar gegooide volgorde per vraag
    let seed = [...String(seedText)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const order = Array.from({ length: n }, (_, k) => k);
    for (let k = n - 1; k > 0; k--) { seed = (seed * 1103515245 + 12345) >>> 0; const j = seed % (k + 1); [order[k], order[j]] = [order[j], order[k]]; }
    const tiles = Array.from({ length: n }, (_, k) => {
      const at = ((order.indexOf(k) + 1) / n) * total;              // moment waarop dit stukje wegvalt
      return h('span', { class: 'fx-tile', style: { animationDelay: `${at - elapsed}s` } });
    });
    frame.append(h('div', { class: 'fx-tiles', 'aria-hidden': 'true', style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } }, tiles));
  }
  return box;
}

/** De lijst zo groot mogelijk maken in het vak, in de verhouding van de foto. */
function fitFxFrame(frame) {
  const img = frame.querySelector('img');
  const box = frame.parentElement;
  if (!img?.naturalWidth || !box) return;
  const W = box.clientWidth; const H = box.clientHeight;
  if (!W || !H) return;
  const r = img.naturalWidth / img.naturalHeight;
  const w = W / H > r ? H * r : W;
  frame.style.width = `${Math.floor(w)}px`;
  frame.style.height = `${Math.floor(w / r)}px`;
}
window.addEventListener('resize', () => requestAnimationFrame(() => document.querySelectorAll('.fx-frame').forEach(fitFxFrame)));

// ---------------------------------------------------------------- filmpjes

/** Filmpjes vooraf geladen (pad → <video>), zodat ze binnen de tik op "Volgende" kunnen starten. */
const videos = new Map();
let videoBox = null;

/** Is het geluidsfragment eigenlijk een filmpje (bijv. uit de galerij)? */
const isVideoClip = (q) => /\.(mp4|webm)$/i.test(q?.audio_path || '');

function videoPathFor(status, q) {
  if (!q || q.scare_only) return null;
  // Bij het antwoord: het antwoordfilmpje, of anders het hele filmpje dat bij de vraag achterstevoren klonk.
  if (status === 'answers') return state.keys?.get(q.id)?.answer_video_path || (q.audio_reverse && isVideoClip(q) ? q.audio_path : null);
  if (status === 'question') return q.video_path || null;
  return null;
}

function videoFor(path) {
  if (!path) return null;
  let v = videos.get(path);
  if (!v) {
    if (!videoBox) { videoBox = h('div', { id: 'video-deck' }); document.body.append(videoBox); }
    const el = h('video', { class: 'deck-video', playsinline: true, controls: true, preload: 'auto', 'data-path': path });
    v = { el, url: null, ready: null };
    v.ready = sb.storage.from('fotos').createSignedUrl(path, SIGNED_URL_SECONDS).then(({ data }) => {
      v.url = data?.signedUrl || null;
      if (v.url) el.src = v.url;
      return v.url;
    }).catch(() => null);
    videos.set(path, v);
    videoBox.append(el);
  }
  return v;
}

async function videoUrlFor(path) {
  const v = videoFor(path);
  return v ? (v.url || await v.ready) : null;
}

function preloadVideos() {
  for (const q of state.questions) {
    videoFor(q.video_path);
    videoFor(videoPathFor('answers', q));
  }
}

/** Starten met geluid (binnen een tik); lukt dat niet, dan zonder geluid (via de knop aanzetten). */
function playVideo(path) {
  for (const [p, v] of videos) if (p !== path) v.el.pause();
  const v = videoFor(path);
  if (!v) return;
  const el = v.el;
  el.muted = false;
  try { el.currentTime = 0; } catch { /* nog niet geladen */ }
  fadeOutAt(el, videoEndFor(path));
  const go = () => el.play()?.catch(() => { el.muted = true; el.play()?.catch(() => {}); });
  if (el.src) go(); else v.ready.then(go);
}

/** Ingesteld uitfaadmoment (seconden) van een filmpje bij de vraag of bij het antwoord. */
function videoEndFor(path) {
  const qs = [...(state.questions || []), ...(preview?.list || [])];
  const q = qs.find((x) => x.video_path === path);
  if (q?.video_end) return Number(q.video_end);
  for (const k of (state.keys?.values?.() || [])) if (k.answer_video_path === path && k.answer_video_end) return Number(k.answer_video_end);
  return null;
}

const VIDEO_FADE = 3;  // seconden uitfaden (geluid en beeld)
/** Filmpje vanaf `end - 3 s` zachter en donkerder laten worden en op `end` stoppen. */
function fadeOutAt(el, end) {
  clearInterval(el._fade);
  try { el.volume = 1; } catch { /* */ }
  el.style.filter = '';
  if (!end) return;
  el._fade = setInterval(() => {
    const left = end - el.currentTime;
    if (left > VIDEO_FADE) return;
    if (left <= 0) {
      el.pause();
      el.style.filter = 'brightness(0)';
      clearInterval(el._fade);
      return;
    }
    const k = left / VIDEO_FADE;
    try { el.volume = Math.max(0, Math.min(1, k * k)); } catch { /* volume niet regelbaar (iPad): alleen stoppen */ }
    el.style.filter = `brightness(${k.toFixed(3)})`;
  }, 50);
}

function stopVideos() {
  for (const v of videos.values()) v.el.pause();
}

/** Vak voor het filmpje (op de plek van de foto); het filmpje zelf wordt erboven gelegd. */
function videoSlot(path) {
  videoFor(path);
  requestAnimationFrame(placeVideos);
  return h('div', { class: 'photo video-slot', 'data-path': path });
}

function placeVideos() {
  const slot = document.querySelector('.video-slot');
  const r = slot ? slot.getBoundingClientRect() : null;
  for (const [p, v] of videos) {
    const on = slot && slot.dataset.path === p && r.width > 0;
    v.el.classList.toggle('video-show', Boolean(on));
    if (on) Object.assign(v.el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    else Object.assign(v.el.style, { left: '', top: '', width: '', height: '' });
  }
}
window.addEventListener('resize', () => requestAnimationFrame(placeVideos));
document.addEventListener('fullscreenchange', () => setTimeout(placeVideos, 300));
setInterval(placeVideos, 1000);

// ---------------------------------------------------------------- achtergronden

/** Sfeerbeelden achter de vragen (assets/achtergronden), om en om. */
const BACKGROUNDS = ['kerstbal', 'slee', 'lantaarns', 'ski', 'woonkamer', 'bergen'];

/** Achtergrond voor vraag `i`; bij een vraag met foto extra gedempt. */
function bgLayer(i, withPhoto) {
  const name = BACKGROUNDS[((i % BACKGROUNDS.length) + BACKGROUNDS.length) % BACKGROUNDS.length];
  return h('div', {
    class: `q-bg ${withPhoto ? 'q-bg-soft' : ''}`,
    'aria-hidden': 'true',
    style: { backgroundImage: `url('assets/achtergronden/${name}.jpg')` },
  });
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
