// Spelersscherm (#speler): telefoon, zonder login.
import {
  sb, h, mount, toast, load, save, LETTERS, syncClock, secondsLeft,
  fetchQuestions, fetchGame, errorText, liveSync, spotifyPlayer, hiddenSpotifyPlayer, brandTitle, inScarePhase,
} from './common.js?v=60';
import { parseNumber, formatNumber } from './scoring.js?v=60';
import { scheduleScare, prepareScareAudio } from './schrik.js?v=60';

const PLAYER_KEY = 'kerstquiz_speler';

const state = {
  player: null,     // { id, gameId, name, code }
  game: null,
  questions: [],
  screen: '',       // sleutel van het getoonde scherm
  mine: {},         // eigen antwoord bij de huidige vraag: { choice, text, number }
  mineFor: null,    // vraag-id waar `mine` bij hoort
  timeUp: false,
  stopSync: null,
  tick: null,
};

export async function startSpeler(params) {
  // Telefoon: geluid voor een eventuele schrik bij de eerste tik vrijgeven (één keer)
  prepareScareAudio([{ scare_after: 1 }]);
  document.body.className = 'phone';
  if (params.get('voorbeeld')) return startPreview(params.get('voorbeeld'));
  const code = (params.get('code') || '').toUpperCase().trim();
  const stored = load(PLAYER_KEY);

  syncClock();

  if (stored?.id && (!code || code === stored.code)) {
    mount(h('div', { class: 'phone-page center' }, h('p', { class: 'muted' }, 'Even verbinden…')));
    const { data, error } = await sb.rpc('get_player', { p_player_id: stored.id });
    const row = data && data[0];
    if (!error && row) {
      state.player = { id: row.player_id, gameId: row.game_id, name: row.name, code: row.code };
      return enterGame();
    }
    if (error) {
      // geen verbinding: laat het aanmeldscherm zien, maar onthoud de speler
      return renderJoin(code || stored.code, errorText(error));
    }
    save(PLAYER_KEY, null);
  }
  renderJoin(code);
}

// ---------------------------------------------------------------- aanmelden

function renderJoin(code, message) {
  const name = h('input', {
    type: 'text', maxlength: '14', autocomplete: 'nickname', autocapitalize: 'words',
    required: true, placeholder: 'Je naam', enterkeyhint: 'next',
  });
  const room = h('input', {
    type: 'text', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: false, required: true, value: code || '', class: 'code-input',
    oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); },
  });
  const err = h('p', { class: 'form-error', role: 'alert' }, message || '');
  const btn = h('button', { class: 'btn btn-gold btn-block', type: 'submit' }, 'Doe mee');

  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      const { data, error } = await sb.rpc('join_game', { p_code: room.value, p_name: name.value });
      btn.disabled = false;
      if (error) {
        err.textContent = errorText(error);
        if (error.message?.includes('naam_bezet')) { name.focus(); name.select(); }
        return;
      }
      const row = data[0];
      state.player = { id: row.player_id, gameId: row.game_id, name: row.name, code: row.code };
      save(PLAYER_KEY, state.player);
      enterGame();
    },
  },
    h('label', {}, 'Naam', name, h('span', { class: 'hint' }, 'Maximaal 14 tekens')),
    h('label', {}, 'Kamercode', room, h('span', { class: 'hint' }, 'De code van 4 tekens op het grote scherm')),
    err,
    btn,
  );

  mount(h('div', { class: 'phone-page' },
    h('div', { class: 'phone-hero' }, brandTitle('brand-phone')),
    h('div', { class: 'phone-body' }, form),
  ));
  (code ? name : room).focus();
}

// ---------------------------------------------------------------- spel volgen

async function enterGame() {
  try {
    [state.game, state.questions] = await Promise.all([fetchGame(state.player.gameId), fetchQuestions()]);
  } catch (e) {
    return renderJoin(state.player.code, errorText(e));
  }
  if (!state.game) { save(PLAYER_KEY, null); return renderJoin(''); }

  // Speler bewaren; ook als de aanmelding van een herladen pagina komt.
  save(PLAYER_KEY, state.player);
  // Code in de adresbalk zetten, zodat herladen in hetzelfde spel blijft.
  history.replaceState(null, '', `#speler?code=${state.player.code}`);

  await render();

  state.stopSync = liveSync(
    `speler-${state.player.id}`,
    [{ event: 'UPDATE', table: 'games', filter: `id=eq.${state.player.gameId}` }],
    (payload) => { if (payload.new?.id) { state.game = payload.new; render(); } },
    refresh,
  );
  state.tick = setInterval(tick, 250);
}

async function refresh() {
  const fresh = await fetchGame(state.player.gameId).catch(() => null);
  if (!fresh) return;
  state.game = fresh;
  render();
}

function currentQuestion() {
  return state.questions.find((q) => q.id === state.game.current_question_id) || null;
}

async function render() {
  const g = state.game;
  let q = null;
  const asking = (g.status === 'question' || g.status === 'schifting') && g.current_question_id;
  if (asking) {
    q = currentQuestion();
    if (!q) {
      // nieuwe of gewijzigde vraag: lijst opnieuw ophalen
      state.questions = await fetchQuestions().catch(() => state.questions);
      q = currentQuestion();
    }
  }
  const timeUp = q ? secondsLeft(g, q) <= 0 : false;
  const key = `${g.status}|${g.current_question_id}|${g.question_started_at}|${timeUp}|${g.photo_url || ''}|${g.video_url || ''}|${q ? inScarePhase(g, q) : ''}|${(g.tiebreak_names || []).join(',')}|${JSON.stringify(g.winners || null)}`;
  if (key === state.screen) return;
  state.screen = key;
  state.timeUp = timeUp;

  if (g.status === 'lobby') return renderWaiting();
  if (g.status === 'question' && !g.current_question_id) return renderStarting();
  if (g.status === 'tussenstand') return renderLookUp('📊', 'Tussenstand op het grote scherm');
  if (g.status === 'schifting' && q && !inTiebreak()) return renderSchiftingWatch();
  if (['final', 'tree'].includes(g.status)) {
    const win = myWin();
    if (win) return renderWinner(win.place);
  }
  if (asking && q) {
    const startedAt = g.question_started_at;
    scheduleScare(g, q, () => state.game.current_question_id === q.id && state.game.question_started_at === startedAt
      && ['question', 'schifting'].includes(state.game.status), q.scare_path ? g.scare_url : null);
    if (state.mineFor !== q.id) {
      state.mineFor = q.id;
      state.mine = {};
      editingChoice = false;
      // eerder gegeven antwoord terughalen (na herladen of bij "vorige vraag")
      if (!state.preview) sb.rpc('get_my_answer', { p_player_id: state.player.id, p_question_id: q.id }).then(({ data }) => {
        const row = data?.[0];
        if (state.mineFor !== q.id || !row || hasAnswer() || state.mine.rating != null) return;
        state.mine = { choice: row.choice, text: row.text_answer, number: row.number_answer, rating: row.rating };
        if (state.timeUp) { state.screen = ''; render(); } else showMine(q);
      });
    }
    return timeUp ? renderDone() : renderQuestion(q);
  }
  return renderLookUp();
}

function tick() {
  const g = state.game;
  if (!g || !['question', 'schifting'].includes(g.status) || !g.current_question_id) return;
  const q = currentQuestion();
  const left = secondsLeft(g, q);
  const t = document.getElementById('p-timer');
  if (t) t.textContent = `${Math.max(0, Math.ceil(left))} s`;
  if (left <= 0 && !state.timeUp) render();
  else if (q?.scare_only) render(); // na de schrik: de echte vraag tonen (render doet niets als er niets verandert)
}

// ---------------------------------------------------------------- schermen

function topBar(q) {
  const normal = state.questions.filter((x) => !x.tiebreak);
  const i = normal.findIndex((x) => x.id === q?.id);
  return h('header', { class: 'p-top' },
    h('span', {}, !q ? '' : q.tiebreak ? 'Schifting' : `Vraag ${i + 1}/${normal.length}`),
    h('span', { class: 'p-timer', id: 'p-timer' }, q ? `${Math.max(0, Math.ceil(secondsLeft(state.game, q)))} s` : ''),
    h('span', { class: 'p-name' }, state.player.name),
  );
}

function renderWaiting() {
  mount(h('div', { class: 'phone-page' },
    h('div', { class: 'phone-hero' }, brandTitle('brand-phone')),
    h('div', { class: 'phone-body center stack' },
      h('p', { class: 'big' }, `Hoi ${state.player.name}!`),
      h('p', { class: 'lead' }, 'Je doet mee. Wacht tot de quiz begint.'),
      h('p', { class: 'muted' }, 'Kamercode ', h('strong', { class: 'gold' }, state.player.code)),
      h('button', { class: 'link', onclick: rejoin }, 'Andere naam of ander spel? Opnieuw aanmelden'),
    ),
  ));
}

function renderQuestion(q) {
  if (inScarePhase(state.game, q)) {
    // Schrikvraag: eerst alleen de tekst, alsof er een vraag komt; na de schrik de echte vraag
    return mount(h('div', { class: 'phone-page' },
      h('div', { class: 'phone-body center stack scare-phone' },
        h('p', { class: 'scare-phone-text' }, q.scare_text || 'Kijk goed…'),
        h('p', { class: 'muted' }, 'Kijk naar het grote scherm'),
      ),
    ));
  }
  const photo = state.game.photo_url;
  let answerArea;
  if (q.kind === 'meerkeuze') answerArea = choiceArea(q);
  else if (q.kind === 'open') answerArea = textArea(q);
  else if (q.kind === 'schatting') answerArea = numberArea(q);
  else answerArea = h('p', { class: 'muted center' }, 'Kijk naar het grote scherm.');

  mount(h('div', { class: 'phone-page' },
    topBar(q),
    h('div', { class: 'phone-body stack' },
      q.category && h('span', { class: 'label' }, q.category),
      q.fastest_count && q.kind !== 'schatting' && h('p', { class: 'p-fast' }, `⚡ Snel zijn! Alleen de ${q.fastest_count} snelsten met het goede antwoord krijgen een punt. Wijzigen telt als later.`),
      h('h2', { class: 'p-question' }, q.text),
      state.game.video_url ? phoneVideo(state.game.video_url)
        : photo && !q.reveal_effect && h('img', { class: 'p-photo', src: photo, alt: '' }),
      // Foto met onthul-effect of intro raden: alleen op het grote scherm
      q.media_url && q.media_mode !== 'alleen_geluid' && (q.media_seconds
        ? h('p', { class: 'p-listen' }, '♪ Luister naar het grote scherm') : phonePlayer(q)),
      photo && q.reveal_effect && h('p', { class: 'p-listen' }, '👀 Kijk naar het grote scherm'),
      twoStep(q)
        ? [h('div', { id: 'p-step1' }, answerArea), ratingStep(q)]
        : [answerArea, q.rate_tree && ratingArea(q)],
    ),
  ));
  showMine(q);
}

/** Kerstboom met meerkeuze: eerst "van wie", daarna een eigen scherm voor het cijfer. */
const twoStep = (q) => q.rate_tree && q.kind === 'meerkeuze';
let editingChoice = false;

function ratingStep(q) {
  return h('div', { id: 'p-step2', class: 'stack', hidden: true },
    h('p', { class: 'p-chosen' },
      h('span', { id: 'p-chosen-text' }),
      h('button', { type: 'button', class: 'link', onclick: () => { editingChoice = true; showMine(q); } }, 'Wijzigen'),
    ),
    ratingArea(q, { big: true }),
  );
}

function choiceArea(q) {
  const buttons = (q.options || []).map((text, k) =>
    h('button', {
      class: `p-option opt-${LETTERS[k].toLowerCase()}`,
      'data-choice': k,
      'aria-pressed': 'false',
      onclick: () => { editingChoice = false; submit(q, { choice: k }); },
    },
      h('span', { class: 'letter', 'aria-hidden': 'true' }, LETTERS[k]),
      h('span', { class: 'option-text' }, h('span', { class: 'sr-only' }, `${LETTERS[k]}: `), text),
      h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'),
    ));
  return [
    h('div', { class: 'p-options' }, buttons),
    h('p', { class: 'hint center' }, 'Je kunt je keuze wijzigen tot de tijd om is.'),
  ];
}

/** Muziek op de telefoon: zichtbaar, afgedekt of alleen op de tv. */
function phonePlayer(q) {
  if (q.media_mode === 'alleen_tv') return h('p', { class: 'p-listen' }, '♪ Luister naar het grote scherm');
  if (q.media_mode === 'verbergen') return hiddenSpotifyPlayer(q.media_url, { compact: true });
  return spotifyPlayer(q.media_url, { compact: true });
}

/** Cijfer 1–10 voor de boom (telt niet voor de score). */
function ratingArea(q, { big = false } = {}) {
  return h('section', { class: `p-rating ${big ? 'p-rating-big' : ''}`, 'aria-label': 'Cijfer voor deze boom' },
    h('p', { class: 'p-rating-title' }, 'Welk cijfer geef je deze boom?'),
    h('div', { class: 'p-rating-grid' }, Array.from({ length: 10 }, (_, k) => h('button', {
      type: 'button', class: 'p-rate', 'data-rating': k + 1, 'aria-pressed': 'false',
      'aria-label': `Cijfer ${k + 1}`,
      onclick: () => submit(q, { rating: k + 1 }),
    }, String(k + 1)))),
    h('p', { class: 'hint center' }, 'telt niet voor je score'),
  );
}

/** Open vraag: tekstveld en "Verstuur". */
function textArea(q) {
  const input = h('input', {
    type: 'text', id: 'p-input', maxlength: '200', autocomplete: 'off', enterkeyhint: 'send',
    placeholder: 'Typ je antwoord', 'aria-label': 'Jouw antwoord',
  });
  return answerForm(input, null, 'Kleine tikfouten zijn niet erg.', () => {
    const text = input.value.trim();
    if (!text) { toast('Typ eerst een antwoord.'); return null; }
    return { text };
  }, q);
}

/** Schatting: getalveld (numeriek toetsenbord) met eenheid en "Verstuur". */
function numberArea(q) {
  const input = h('input', {
    type: 'text', id: 'p-input', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'send',
    maxlength: '20', placeholder: 'Jouw schatting', 'aria-label': 'Jouw schatting', class: 'p-number',
  });
  return answerForm(input, q.unit, q.tiebreak ? 'Schiftingsvraag: wie het dichtst zit, wint.' : 'De drie die het dichtst zitten krijgen een punt.', () => {
    const number = parseNumber(input.value);
    if (number == null) { toast('Vul een getal in.'); return null; }
    return { number };
  }, q);
}

function answerForm(input, unit, tip, read, q) {
  const btn = h('button', { class: 'btn btn-gold btn-block', type: 'submit', id: 'p-send' }, 'Verstuur');
  return h('form', {
    class: 'stack p-answer-form',
    onsubmit: (e) => {
      e.preventDefault();
      const value = read();
      if (value) { input.blur(); submit(q, value); }
    },
  },
    h('div', { class: 'p-input-row' }, input, unit && h('span', { class: 'p-unit' }, unit)),
    btn,
    h('p', { class: 'p-sent', id: 'p-sent', role: 'status' }),
    h('p', { class: 'hint center' }, tip),
  );
}

const hasAnswer = () => state.mine.choice != null || Boolean(state.mine.text) || state.mine.number != null;

/** Toon het eigen (verstuurde) antwoord in het huidige scherm. */
function showMine(q) {
  if (twoStep(q)) {
    const step1 = document.getElementById('p-step1');
    const step2 = document.getElementById('p-step2');
    const toRating = state.mine.choice != null && !editingChoice;
    if (step1) step1.hidden = toRating;
    if (step2) step2.hidden = !toRating;
    const chosen = document.getElementById('p-chosen-text');
    if (chosen && state.mine.choice != null) {
      chosen.textContent = `✓ Jouw antwoord: ${LETTERS[state.mine.choice]} · ${(q.options || [])[state.mine.choice] ?? ''}`;
    }
  }
  document.querySelectorAll('.p-rate').forEach((b) => {
    const on = Number(b.dataset.rating) === state.mine.rating;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (q.kind === 'meerkeuze') {
    document.querySelectorAll('.p-option').forEach((b) => {
      const on = Number(b.dataset.choice) === state.mine.choice;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    return;
  }
  const input = document.getElementById('p-input');
  const sent = document.getElementById('p-sent');
  const value = q.kind === 'open' ? state.mine.text : state.mine.number;
  if (input && value != null && !input.value) {
    input.value = q.kind === 'schatting' ? formatNumber(value) : value;
  }
  if (sent) {
    sent.textContent = value != null && value !== ''
      ? `✓ Verstuurd: ${mineText(q)}. Je kunt het nog aanpassen tot de tijd om is.`
      : '';
  }
  const btn = document.getElementById('p-send');
  if (btn) btn.textContent = value != null && value !== '' ? 'Wijzig antwoord' : 'Verstuur';
}


function mineText(q) {
  if (!q) return '';
  if (q.kind === 'meerkeuze') return state.mine.choice != null ? LETTERS[state.mine.choice] : '';
  if (q.kind === 'open') return state.mine.text ? `"${state.mine.text}"` : '';
  if (q.kind === 'schatting' && state.mine.number != null) return `${formatNumber(state.mine.number)}${q.unit ? ` ${q.unit}` : ''}`;
  return '';
}

/** Antwoord insturen: { choice } | { text } | { number }. */
async function submit(q, value) {
  const previous = { ...state.mine };
  state.mine = { ...state.mine, ...value };
  showMine(q);
  if (state.preview) return; // voorbeeld: niets opslaan
  const { error } = await sb.rpc('submit_answer', {
    p_player_id: state.player.id,
    p_question_id: q.id,
    p_choice: value.choice ?? null,
    p_text: value.text ?? null,
    p_number: value.number ?? null,
    p_rating: value.rating ?? null,
  });
  if (!error) return;
  state.mine = previous;
  if (error.message?.includes('vraag_gesloten')) {
    state.screen = '';
    await refresh();
    return;
  }
  if (error.message?.includes('speler_onbekend')) return rejoin();
  showMine(q);
  toast(errorText(error));
}

function renderDone() {
  const q = currentQuestion();
  const answered = hasAnswer();
  mount(h('div', { class: 'phone-page' },
    topBar(q),
    h('div', { class: 'phone-body center stack' },
      state.game.video_url && phoneVideo(state.game.video_url),
      h('div', { class: `done-icon ${answered ? 'ok' : ''}`, 'aria-hidden': 'true' }, answered ? '✓' : '⏱'),
      h('p', { class: 'big' }, answered ? 'Antwoord ontvangen' : 'De tijd is om'),
      answered && h('p', { class: 'muted' }, `Jouw antwoord: ${mineText(q)}`),
      q?.rate_tree && state.mine.rating != null && h('p', { class: 'muted' }, `Jouw cijfer voor de boom: ${state.mine.rating}`),
      h('p', { class: 'lead' }, 'Kijk naar het grote scherm'),
    ),
  ));
}

/** Na "Start de quiz": korte uitleg terwijl de tv de spelregels toont. */
function renderStarting() {
  mount(h('div', { class: 'phone-page' },
    h('header', { class: 'p-top' }, h('span', {}), h('span', {}), h('span', { class: 'p-name' }, state.player.name)),
    h('div', { class: 'phone-body stack' },
      h('p', { class: 'big center' }, 'De quiz begint zo!'),
      h('ul', { class: 'p-rules' },
        h('li', {}, 'Antwoord hier op je telefoon; je kunt het wijzigen tot de tijd om is.'),
        h('li', {}, 'Elk goed antwoord is 1 punt.'),
        h('li', {}, 'De antwoorden en de eindstand komen aan het eind.'),
      ),
      h('p', { class: 'lead center' }, 'Kijk naar het grote scherm'),
    ),
  ));
}

/**
 * Filmpje op de telefoon. Hetzelfde element blijft bewaard zolang het filmpje gelijk is,
 * zodat het doorspeelt als het scherm opnieuw wordt opgebouwd.
 */
let videoEl = null;
function phoneVideo(url) {
  const key = url.split('?')[0];
  if (videoEl?.dataset.key === key) return videoEl;
  videoEl?.pause();
  const el = h('video', { class: 'p-video', src: url, playsinline: true, controls: true, preload: 'auto', 'data-key': key });
  videoEl = el;
  // Met geluid starten; mag dat niet (iPhone zonder tik), dan zonder geluid: spelers tikken zelf op 🔊.
  el.play()?.catch(() => { el.muted = true; el.play()?.catch(() => {}); });
  return el;
}

function renderLookUp(icon = '★', text = 'Kijk naar het grote scherm') {
  if (state.game?.status === 'answers' && state.game.video_url) {
    return mount(h('div', { class: 'phone-page' },
      h('header', { class: 'p-top' }, h('span', {}), h('span', {}), h('span', { class: 'p-name' }, state.player.name)),
      h('div', { class: 'phone-body center stack' },
        phoneVideo(state.game.video_url),
        h('p', { class: 'lead' }, text),
      ),
    ));
  }
  mount(h('div', { class: 'phone-page' },
    h('header', { class: 'p-top' }, h('span', {}), h('span', {}), h('span', { class: 'p-name' }, state.player.name)),
    h('div', { class: 'phone-body center stack' },
      h('div', { class: 'done-icon', 'aria-hidden': 'true' }, icon),
      h('p', { class: 'big' }, text),
    ),
  ));
}

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const inTiebreak = () => (state.game.tiebreak_names || []).some((n) => sameName(n, state.player.name));
const myWin = () => (Array.isArray(state.game.winners) ? state.game.winners : []).find((w) => sameName(w.name, state.player.name));

/** Schiftingsvraag voor anderen: meekijken. */
function renderSchiftingWatch() {
  mount(h('div', { class: 'phone-page' },
    h('header', { class: 'p-top' }, h('span', {}, 'Schifting'), h('span', {}), h('span', { class: 'p-name' }, state.player.name)),
    h('div', { class: 'phone-body center stack' },
      h('div', { class: 'done-icon', 'aria-hidden': 'true' }, '⚖️'),
      h('p', { class: 'big' }, 'Schiftingsvraag'),
      h('p', { class: 'lead' }, `Voor: ${(state.game.tiebreak_names || []).join(', ')}`),
      h('p', { class: 'muted' }, 'Kijk mee op het grote scherm.'),
    ),
  ));
}

/** Winnaar: groen knipperend scherm. */
function renderWinner(place) {
  const label = place === 1 ? '1e' : place === 2 ? '2e' : `${place}e`;
  mount(h('div', { class: 'phone-page winner-page', role: 'status' },
    h('div', { class: 'phone-body center stack winner-body' },
      h('div', { class: 'winner-trophy', 'aria-hidden': 'true' }, '🏆'),
      h('p', { class: 'winner-title' }, `Jij staat ${label}!`),
      h('p', { class: 'winner-name' }, state.player.name),
      h('p', { class: 'lead' }, 'Gefeliciteerd! Kijk naar het grote scherm.'),
    ),
  ));
}

// ---------------------------------------------------------------- voorbeeld (vanuit beheer)

/** Telefoonweergave van één vraag, zonder spel: antwoorden worden niet opgeslagen. */
async function startPreview(id) {
  state.preview = true;
  state.questions = await fetchQuestions().catch(() => []);
  const q = state.questions.find((x) => x.id === id);
  if (!q) return renderLookUp('?', 'Vraag niet gevonden');
  let photo = null;
  if (q.photo_path) {
    // lukt alleen als je als beheerder bent ingelogd (zoals in het voorbeeld vanuit beheer)
    const { data } = await sb.storage.from('fotos').createSignedUrl(q.photo_path, 60 * 60);
    photo = data?.signedUrl || null;
  }
  state.player = { id: null, name: 'Voorbeeld', code: '' };
  state.game = {
    status: q.tiebreak ? 'schifting' : 'question',
    current_question_id: q.id,
    question_started_at: new Date(Date.now()).toISOString(),
    photo_url: photo,
    tiebreak_names: q.tiebreak ? ['Voorbeeld'] : null,
    winners: null,
  };
  await render();
  state.tick = setInterval(tick, 250);
}

function rejoin() {
  if (state.stopSync) state.stopSync();
  clearInterval(state.tick);
  const code = state.player?.code || '';
  save(PLAYER_KEY, null);
  state.player = null;
  state.screen = '';
  renderJoin(code);
}
