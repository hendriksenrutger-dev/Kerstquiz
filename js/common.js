// Gedeelde hulpfuncties voor tv, speler en (later) beheer.

const cfg = window.KERSTQUIZ_CONFIG || {};
export const sb = window.supabase && cfg.supabaseUrl
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  : null;

export const LETTERS = ['A', 'B', 'C', 'D'];

// ---------- DOM ----------

/** Element maken: h('div', {class: 'x', onclick: fn}, 'tekst', kind, …). Tekst wordt nooit als HTML gelezen. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(...nodes) {
  const app = document.getElementById('app');
  app.replaceChildren(...nodes);
}

let toastTimer;
export function toast(msg, ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Opslag in de browser (altijd met try/catch) ----------

export function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
export function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* privé-venster: dan maar zonder */ }
}

// ---------- Hash-route ----------

/** '#speler?code=AB12' → { view: 'speler', params: URLSearchParams } */
export function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [view, query] = raw.split('?');
  return { view: (view || 'speler').toLowerCase(), params: new URLSearchParams(query || '') };
}

// ---------- Servertijd ----------
// De timer wordt berekend uit de starttijd in de database. Omdat de klok
// van een telefoon kan afwijken, meten we het verschil met de server.

let clockOffset = 0;
export async function syncClock() {
  try {
    const t0 = Date.now();
    const { data, error } = await sb.rpc('server_time');
    const t1 = Date.now();
    if (error || !data) return;
    clockOffset = new Date(data).getTime() - (t0 + t1) / 2;
  } catch { /* volgende keer beter */ }
}
export const serverNow = () => Date.now() + clockOffset;

/** Resterende seconden (kan negatief zijn) voor de huidige vraag. */
export function secondsLeft(game, question) {
  if (!game?.question_started_at || !question) return 0;
  const end = new Date(game.question_started_at).getTime() + question.time_limit * 1000;
  return (end - serverNow()) / 1000;
}

// ---------- Data ----------

export async function fetchQuestions() {
  const { data, error } = await sb
    .from('questions')
    .select('id, position, category, kind, text, photo_path, options, unit, time_limit, rate_tree')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchGame(id) {
  const { data, error } = await sb.from('games').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Leesbare foutmelding uit een Supabase-fout. */
export function errorText(err) {
  const m = (err && (err.message || err.error_description || String(err))) || '';
  const map = {
    kamercode_onbekend: 'Deze kamercode bestaat niet. Kijk nog eens op het grote scherm.',
    naam_bezet: 'Deze naam is al bezet in dit spel. Kies een andere naam.',
    naam_ongeldig: 'Vul een naam in van maximaal 14 tekens.',
    vraag_gesloten: 'De tijd is om.',
    speler_onbekend: 'Je aanmelding is niet meer geldig. Meld je opnieuw aan.',
    keuze_ongeldig: 'Deze keuze kan niet.',
    geen_toegang: 'Je bent niet ingelogd als beheerder.',
    'Invalid login credentials': 'E-mailadres of wachtwoord klopt niet.',
    'Failed to fetch': 'Geen verbinding. Controleer het internet en probeer opnieuw.',
  };
  for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
  return m || 'Er ging iets mis. Probeer het opnieuw.';
}

// ---------- Verbindingsmelding ----------

let bannerTimer = null;
/** Toon na een paar seconden zonder verbinding een melding onderin het scherm. */
function setConnected(ok) {
  let el = document.getElementById('conn-banner');
  if (!el) {
    el = h('div', { id: 'conn-banner', class: 'conn-banner', role: 'status', hidden: true },
      h('span', { class: 'conn-dot', 'aria-hidden': 'true' }), 'Geen verbinding – opnieuw verbinden…');
    document.body.append(el);
  }
  clearTimeout(bannerTimer);
  if (ok) { el.hidden = true; return; }
  bannerTimer = setTimeout(() => { el.hidden = false; }, 4000);
}

// ---------- Realtime met automatisch opnieuw verbinden ----------

/**
 * Luister naar wijzigingen. `onChange` krijgt de payload; `refresh` haalt de
 * actuele status op. Dat gebeurt na elk (her)verbinden, bij terugkeer naar de
 * app, als het netwerk terugkomt en als vangnet elke 15 s (elke 5 s zolang de
 * verbinding weg is). Bij een fout wordt opnieuw verbonden met oplopende wachttijd.
 */
export function liveSync(name, listeners, onChange, refresh) {
  let channel = null;
  let retryTimer = null;
  let stopped = false;
  let connected = false;
  let attempt = 0;
  let lastRefresh = Date.now();

  const doRefresh = () => { lastRefresh = Date.now(); return refresh(); };

  const connect = () => {
    if (stopped) return;
    if (channel) sb.removeChannel(channel);
    const mine = sb.channel(`${name}-${Math.random().toString(36).slice(2, 8)}`);
    channel = mine;
    for (const l of listeners) {
      mine.on('postgres_changes', { schema: 'public', ...l }, (payload) => onChange(payload));
    }
    mine.subscribe((status) => {
      if (stopped || channel !== mine) return; // melding van een oud kanaal
      if (status === 'SUBSCRIBED') {
        connected = true; attempt = 0; setConnected(true);
        doRefresh();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        connected = false; setConnected(false);
        clearTimeout(retryTimer);
        const delay = Math.min(15000, 2000 * 2 ** attempt++);
        retryTimer = setTimeout(connect, delay);
      }
    });
  };
  connect();

  const onWake = () => {
    if (document.visibilityState !== 'visible') return;
    syncClock();
    doRefresh();
    if (!connected) { attempt = 0; clearTimeout(retryTimer); connect(); }
  };
  const onOffline = () => { connected = false; setConnected(false); };
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('offline', onOffline);
  const poll = setInterval(() => {
    const every = connected && navigator.onLine !== false ? 15000 : 5000;
    if (Date.now() - lastRefresh >= every) doRefresh();
  }, 1000);

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearInterval(poll);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('online', onWake);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('offline', onOffline);
    setConnected(true);
    if (channel) sb.removeChannel(channel);
    channel = null;
  };
}

// ---------- Scherm aan houden en volledig scherm (tv) ----------

let wakeLock = null;
/** Houd het scherm aan (Wake Lock API), als de browser dat ondersteunt. */
export function keepScreenOn() {
  if (!('wakeLock' in navigator)) return;
  const request = async () => {
    if (document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* bijv. batterijbesparing */ }
  };
  request();
  // De browser laat de wake lock los als de app op de achtergrond gaat; daarna opnieuw vragen.
  document.addEventListener('visibilitychange', request);
  // Sommige browsers willen eerst een tik op het scherm.
  document.addEventListener('pointerdown', request, { passive: true });
}

export const canFullscreen = () => Boolean(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

export function toggleFullscreen() {
  const el = document.documentElement;
  if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
}

/** Knop "Volledig scherm" (verborgen als de browser het niet kan, zoals op de iPhone). */
export function fullscreenButton(cls = 'link') {
  if (!canFullscreen()) return null;
  const btn = h('button', { class: cls, type: 'button', onclick: toggleFullscreen });
  const update = () => { btn.textContent = isFullscreen() ? '⤡ Venster' : '⤢ Volledig scherm'; };
  update();
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  return btn;
}

/** Realtime moet het token van de ingelogde beheerder gebruiken. */
export async function syncRealtimeAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) sb.realtime.setAuth(data.session.access_token);
}

/** QR-code als SVG-element (zelf getekend, zodat hij scherp schaalt). */
export function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 2; // witte rand
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n + 2 * m} ${n + 2 * m}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR-code om mee te doen');
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#F5F1E6');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', '#0F2A1D');
  svg.append(bg, path);
  return svg;
}

/** Link waarmee spelers meedoen. */
export function joinUrl(code) {
  return `${location.origin}${location.pathname}#speler?code=${encodeURIComponent(code)}`;
}

// ---------- Inloggen (tv en beheer) ----------

/** Inlogformulier met e-mail en wachtwoord. `onSuccess` wordt aangeroepen na inloggen. */
export function loginForm(onSuccess, message) {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'naam@voorbeeld.nl' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'form-error', role: 'alert' }, message || '');
  const btn = h('button', { class: 'btn btn-gold', type: 'submit' }, 'Inloggen');

  return h('form', {
    class: 'card login-card',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = '';
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
      btn.disabled = false;
      if (error) { err.textContent = errorText(error); return; }
      await onSuccess();
    },
  },
    h('h2', { class: 'serif' }, 'Inloggen quizmaster'),
    h('label', {}, 'E-mailadres', email),
    h('label', {}, 'Wachtwoord', pw),
    err,
    btn,
  );
}
