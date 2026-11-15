// Spelersscherm (#speler): telefoon, zonder login.
import {
  sb, h, mount, toast, load, save, LETTERS, syncClock, secondsLeft,
  fetchQuestions, fetchGame, errorText, liveSync, spotifyPlayer,
} from './common.js';
import { parseNumber, formatNumber } from './scoring.js';

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
  document.body.className = 'phone';
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
    h('div', { class: 'phone-hero' }, h('h1', { class: 'title' }, 'Kerstquiz')),
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
  if (g.status === 'question') {
    q = currentQuestion();
    if (!q) {
      // nieuwe of gewijzigde vraag: lijst opnieuw ophalen
      state.questions = await fetchQuestions().catch(() => state.questions);
      q = currentQuestion();
    }
  }
  const timeUp = q ? secondsLeft(g, q) <= 0 : false;
  const key = `${g.status}|${g.current_question_id}|${g.question_started_at}|${timeUp}|${g.photo_url || ''}`;
  if (key === state.screen) return;
  state.screen = key;
  state.timeUp = timeUp;

  if (g.status === 'lobby') return renderWaiting();
  if (g.status === 'question' && q) {
    if (state.mineFor !== q.id) {
      state.mineFor = q.id;
      state.mine = {};
      // eerder gegeven antwoord terughalen (na herladen of bij "vorige vraag")
      sb.rpc('get_my_answer', { p_player_id: state.player.id, p_question_id: q.id }).then(({ data }) => {
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
  if (!g || g.status !== 'question') return;
  const q = currentQuestion();
  const left = secondsLeft(g, q);
  const t = document.getElementById('p-timer');
  if (t) t.textContent = `${Math.max(0, Math.ceil(left))} s`;
  if (left <= 0 && !state.timeUp) render();
}

// ---------------------------------------------------------------- schermen

function topBar(q) {
  const i = state.questions.findIndex((x) => x.id === q?.id);
  return h('header', { class: 'p-top' },
    h('span', {}, q ? `Vraag ${i + 1}/${state.questions.length}` : ''),
    h('span', { class: 'p-timer', id: 'p-timer' }, q ? `${Math.max(0, Math.ceil(secondsLeft(state.game, q)))} s` : ''),
    h('span', { class: 'p-name' }, state.player.name),
  );
}

function renderWaiting() {
  mount(h('div', { class: 'phone-page' },
    h('div', { class: 'phone-hero' }, h('h1', { class: 'title' }, 'Kerstquiz')),
    h('div', { class: 'phone-body center stack' },
      h('p', { class: 'big' }, `Hoi ${state.player.name}!`),
      h('p', { class: 'lead' }, 'Je doet mee. Wacht tot de quiz begint.'),
      h('p', { class: 'muted' }, 'Kamercode ', h('strong', { class: 'gold' }, state.player.code)),
      h('button', { class: 'link', onclick: rejoin }, 'Andere naam of ander spel? Opnieuw aanmelden'),
    ),
  ));
}

function renderQuestion(q) {
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
      h('h2', { class: 'p-question' }, q.text),
      photo && h('img', { class: 'p-photo', src: photo, alt: '' }),
      q.media_url && spotifyPlayer(q.media_url, { compact: true }),
      answerArea,
      q.rate_tree && ratingArea(q),
    ),
  ));
  showMine(q);
}

function choiceArea(q) {
  const buttons = (q.options || []).map((text, k) =>
    h('button', {
      class: `p-option opt-${LETTERS[k].toLowerCase()}`,
      'data-choice': k,
      'aria-pressed': 'false',
      onclick: () => submit(q, { choice: k }),
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

/** Cijfer 1–10 voor de boom (telt niet voor de score). */
function ratingArea(q) {
  return h('section', { class: 'p-rating', 'aria-label': 'Cijfer voor deze boom' },
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
  return answerForm(input, q.unit, 'De drie die het dichtst zitten krijgen een punt.', () => {
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
      h('div', { class: `done-icon ${answered ? 'ok' : ''}`, 'aria-hidden': 'true' }, answered ? '✓' : '⏱'),
      h('p', { class: 'big' }, answered ? 'Antwoord ontvangen' : 'De tijd is om'),
      answered && h('p', { class: 'muted' }, `Jouw antwoord: ${mineText(q)}`),
      q?.rate_tree && state.mine.rating != null && h('p', { class: 'muted' }, `Jouw cijfer voor de boom: ${state.mine.rating}`),
      h('p', { class: 'lead' }, 'Kijk naar het grote scherm'),
    ),
  ));
}

function renderLookUp() {
  mount(h('div', { class: 'phone-page' },
    h('header', { class: 'p-top' }, h('span', {}), h('span', {}), h('span', { class: 'p-name' }, state.player.name)),
    h('div', { class: 'phone-body center stack' },
      h('div', { class: 'done-icon', 'aria-hidden': 'true' }, '★'),
      h('p', { class: 'big' }, 'Kijk naar het grote scherm'),
    ),
  ));
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
