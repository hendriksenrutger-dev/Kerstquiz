// Afstandsbediening (#afstand): de telefoon van de quizmaster bedient de tv (tablet).
// Ingelogd als beheerder. Een tik zet "volgende" of "vorige" in remote_commands;
// de tv ziet dat direct en tikt zelf op zijn ▶- of ◀-knop.
import { sb, h, mount, toast, loginForm, errorText, fetchQuestions, liveSync } from './common.js?v=86';

const state = { game: null, questions: [], stop: null };

export async function startRemote() {
  document.body.className = 'phone remote-page';
  const { data } = await sb.auth.getSession();
  if (!data.session || data.session.user?.is_anonymous) return renderLogin();
  await afterLogin();
}

function renderLogin(message) {
  mount(h('div', { class: 'phone-page' },
    h('div', { class: 'phone-body stack' },
      h('h1', { class: 'serif' }, 'Afstandsbediening'),
      h('p', { class: 'muted' }, 'Log in met je beheer-account.'),
      loginForm(afterLogin, message))));
}

async function afterLogin() {
  mount(h('div', { class: 'phone-page' }, h('p', { class: 'muted center' }, 'Laden…')));
  try {
    const all = await fetchQuestions();
    state.questions = all.filter((q) => !q.tiebreak);
    // het nieuwste spel dat nog loopt
    const { data, error } = await sb.from('games').select('*').neq('status', 'tree').order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    state.game = data?.[0] || null;
  } catch (e) {
    return renderLogin(errorText(e));
  }
  if (!state.game) return renderNoGame();
  render();
  state.stop?.();
  state.stop = liveSync(`afstand-${state.game.id}`,
    [{ event: '*', table: 'games', filter: `id=eq.${state.game.id}` }],
    (payload) => { if (payload.new?.id) { state.game = payload.new; updateStatus(); } },
    async () => {
      const { data } = await sb.from('games').select('*').eq('id', state.game.id).maybeSingle();
      if (data) { state.game = data; updateStatus(); }
    });
}

function renderNoGame() {
  mount(h('div', { class: 'phone-page' },
    h('div', { class: 'phone-body center stack' },
      h('p', { class: 'big' }, 'Er loopt nog geen quiz'),
      h('p', { class: 'muted' }, 'Tik op de tablet op "Start quiz" en daarna hier op Vernieuwen.'),
      h('button', { class: 'btn btn-gold btn-lg', onclick: afterLogin }, 'Vernieuwen'))));
}

function statusText() {
  const g = state.game;
  if (!g) return '';
  const i = state.questions.findIndex((q) => q.id === g.current_question_id);
  const n = state.questions.length;
  switch (g.status) {
    case 'lobby': return 'Welkom / wachtruimte';
    case 'question': return i >= 0 ? `Vraag ${i + 1} van ${n}` : 'Uitleg / aftellen';
    case 'tussenstand': return 'Tussenstand';
    case 'answers': return i >= 0 ? `Antwoord ${i + 1} van ${n}` : 'De antwoorden';
    case 'final': return 'Eindstand';
    case 'schifting': return 'Schiftingsvraag';
    case 'tree': return 'Mooiste kerstboom';
    default: return g.status;
  }
}

/** Heeft de huidige vraag iets om nog een keer af te spelen (intro raden of eigen geluid)? */
function canReplay() {
  const g = state.game;
  if (!g || g.status !== 'question') return false;
  const q = state.questions.find((x) => x.id === g.current_question_id);
  return Boolean(q && ((q.media_url && q.media_seconds) || q.audio_path));
}

function updateStatus() {
  const el = document.getElementById('remote-status');
  if (el) el.textContent = statusText();
  const r = document.getElementById('remote-replay');
  if (r) r.hidden = !canReplay();
}

async function send(action, btn) {
  btn.disabled = true;
  if (navigator.vibrate) { try { navigator.vibrate(30); } catch { /* */ } }
  const { error } = await sb.from('remote_commands').insert({ game_id: state.game.id, action });
  btn.disabled = false;
  if (error) toast(errorText(error));
}

function render() {
  const prev = h('button', { class: 'remote-btn remote-prev', 'aria-label': 'Vorige' }, '◀');
  const nxt = h('button', { class: 'remote-btn remote-next', 'aria-label': 'Volgende' }, '▶');
  const again = h('button', { class: 'remote-again', id: 'remote-replay', hidden: !canReplay() }, '♪ Nog een keer');
  prev.addEventListener('click', () => send('prev', prev));
  nxt.addEventListener('click', () => send('next', nxt));
  again.addEventListener('click', () => send('replay', again));
  mount(h('div', { class: 'phone-page remote' },
    h('header', { class: 'remote-head' },
      h('span', { class: 'muted' }, `Kamercode ${state.game.code}`),
      h('button', { class: 'link', onclick: afterLogin }, 'Vernieuwen')),
    h('p', { class: 'remote-status', id: 'remote-status' }, statusText()),
    again,
    h('div', { class: 'remote-buttons' }, nxt, prev),
    h('p', { class: 'muted small center' }, '▶ doet hetzelfde als de gouden knop op de tablet, ◀ hetzelfde als "Vorige".'),
  ));
}
