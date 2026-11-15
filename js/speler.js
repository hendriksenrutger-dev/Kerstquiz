// Spelersscherm (#speler): telefoon, zonder login.
import {
  sb, h, mount, toast, load, save, LETTERS, syncClock, secondsLeft,
  fetchQuestions, fetchGame, errorText, liveSync,
} from './common.js';

const PLAYER_KEY = 'kerstquiz_speler';

const state = {
  player: null,     // { id, gameId, name, code }
  game: null,
  questions: [],
  screen: '',       // sleutel van het getoonde scherm
  choice: null,     // eigen keuze bij de huidige vraag
  choiceFor: null,  // vraag-id waar `choice` bij hoort
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
    spellcheck: false, required: true, placeholder: 'ABCD', value: code || '', class: 'code-input',
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
    h('label', {}, 'Kamercode', room),
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
    if (state.choiceFor !== q.id) {
      state.choiceFor = q.id;
      state.choice = null;
      // eerder gegeven antwoord terughalen (na herladen of bij "vorige vraag")
      sb.rpc('get_my_answer', { p_player_id: state.player.id, p_question_id: q.id }).then(({ data }) => {
        if (state.choiceFor === q.id && data?.[0]?.choice != null && state.choice == null) {
          state.choice = data[0].choice;
          markChoice();
          if (state.timeUp) { state.screen = ''; render(); }
        }
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
  const buttons = (q.options || []).map((text, k) =>
    h('button', {
      class: `p-option opt-${LETTERS[k].toLowerCase()}`,
      'data-choice': k,
      'aria-pressed': 'false',
      onclick: () => choose(q, k),
    },
      h('span', { class: 'letter', 'aria-hidden': 'true' }, LETTERS[k]),
      h('span', { class: 'option-text' }, h('span', { class: 'sr-only' }, `${LETTERS[k]}: `), text),
      h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'),
    ));

  mount(h('div', { class: 'phone-page' },
    topBar(q),
    h('div', { class: 'phone-body stack' },
      q.category && h('span', { class: 'label' }, q.category),
      h('h2', { class: 'p-question' }, q.text),
      photo && h('img', { class: 'p-photo', src: photo, alt: '' }),
      h('div', { class: 'p-options' }, buttons),
      h('p', { class: 'hint center' }, 'Je kunt je keuze wijzigen tot de tijd om is.'),
    ),
  ));
  markChoice();
}

function markChoice() {
  document.querySelectorAll('.p-option').forEach((b) => {
    const on = Number(b.dataset.choice) === state.choice;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

async function choose(q, k) {
  const previous = state.choice;
  state.choice = k;
  markChoice();
  const { error } = await sb.rpc('submit_answer', {
    p_player_id: state.player.id, p_question_id: q.id, p_choice: k,
  });
  if (error) {
    const msg = errorText(error);
    if (error.message?.includes('vraag_gesloten')) {
      state.choice = previous;
      state.screen = '';
      await refresh();
      return;
    }
    if (error.message?.includes('speler_onbekend')) return rejoin();
    state.choice = previous;
    markChoice();
    toast(msg);
  }
}

function renderDone() {
  const answered = state.choice != null;
  mount(h('div', { class: 'phone-page' },
    topBar(currentQuestion()),
    h('div', { class: 'phone-body center stack' },
      h('div', { class: `done-icon ${answered ? 'ok' : ''}`, 'aria-hidden': 'true' }, answered ? '✓' : '⏱'),
      h('p', { class: 'big' }, answered ? 'Antwoord ontvangen' : 'De tijd is om'),
      answered && h('p', { class: 'muted' }, `Jouw keuze: ${LETTERS[state.choice]}`),
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
