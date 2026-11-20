// Gedeelde hulpfuncties voor tv, speler en (later) beheer.

const cfg = window.KERSTQUIZ_CONFIG || {};
export const sb = window.supabase && cfg.supabaseUrl
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Geen gedeeld slot tussen tabbladen: dat kon blijven hangen (zwart scherm),
      // bijvoorbeeld met beheer in een ander tabblad of de telefoon in het voorbeeld.
      lock: async (_name, _timeout, fn) => fn(),
    },
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
/** Duur van het schrikbeeld; bij een schrikvraag komt de echte vraag pas daarna. */
export const SCARE_SECONDS = 3;

/** Schrikvraag: zitten we nog vóór (of in) de schrik? Dan alleen de tekst "Kijk goed…" tonen. */
export function inScarePhase(game, q) {
  if (!q?.scare_only || !game?.question_started_at) return false;
  const end = new Date(game.question_started_at).getTime() + ((q.scare_after || 0) + SCARE_SECONDS) * 1000;
  return serverNow() < end;
}

export function secondsLeft(game, question) {
  if (!game?.question_started_at || !question) return 0;
  const end = new Date(game.question_started_at).getTime() + question.time_limit * 1000;
  return (end - serverNow()) / 1000;
}

// ---------- Data ----------

export async function fetchQuestions() {
  const { data, error } = await sb
    .from('questions')
    .select('*')
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
    media_url: 'Voer eerst supabase/003_muziek.sql uit in Supabase om Spotify-links op te slaan.',
    tiebreak: 'Voer eerst supabase/004_extra.sql uit in Supabase om schiftingsvragen op te slaan.',
    geen_schifting: 'Deze schiftingsvraag is niet voor jou.',
    start_music: 'Voer eerst supabase/005_muziek_start_einde.sql uit in Supabase.',
    answer_photo_path: 'Voer eerst supabase/006_antwoordfoto.sql uit in Supabase om een foto bij het antwoord op te slaan.',
    answer_media_url: 'Voer eerst supabase/008_antwoordnummer.sql uit in Supabase om een nummer bij het antwoord op te slaan.',
    'mime type image/gif is not supported': 'GIF wordt nog niet toegestaan: voer eerst supabase/007_gif.sql uit in Supabase.',
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

// ---------- Spotify ----------

const SPOTIFY_RE = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(track|album|playlist|episode|show)[/:]([A-Za-z0-9]{22})/;

/** Spotify-link → { type, id } of null. Werkt met "Link kopiëren" uit de Spotify-app. */
export function parseSpotify(link) {
  const m = SPOTIFY_RE.exec(String(link || '').trim());
  return m ? { type: m[1], id: m[2] } : null;
}

/** Nette, opgeschoonde link om op te slaan. */
export function cleanSpotifyLink(link) {
  const s = parseSpotify(link);
  return s ? `https://open.spotify.com/${s.type}/${s.id}` : null;
}

/**
 * Spotify-speler (iframe). Spotify speelt zonder ingelogde Spotify-account in
 * die browser alleen een fragment van 30 seconden.
 * @param compact  kleine speler (80 px hoog) voor de telefoon
 */
export function spotifyPlayer(link, { compact = false } = {}) {
  const s = parseSpotify(link);
  if (!s) return null;
  return h('iframe', {
    class: `spotify ${compact ? 'spotify-compact' : ''}`,
    src: `https://open.spotify.com/embed/${s.type}/${s.id}?utm_source=generator&theme=0`,
    height: compact ? '80' : '152',
    width: '100%',
    title: 'Spotify-speler',
    allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
    loading: 'lazy',
  });
}

// ---------- Afgedekte Spotify-speler (antwoord niet verklappen) ----------

let spotifyApiPromise = null;
/** Laad de officiële Spotify iFrame API één keer. */
function loadSpotifyApi() {
  if (spotifyApiPromise) return spotifyApiPromise;
  spotifyApiPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Spotify laadt niet')), 8000);
    window.onSpotifyIframeApiReady = (api) => { clearTimeout(timer); resolve(api); };
    const script = document.createElement('script');
    script.src = 'https://open.spotify.com/embed/iframe-api/v1';
    script.async = true;
    script.onerror = () => { clearTimeout(timer); reject(new Error('Spotify laadt niet')); };
    document.head.append(script);
  });
  spotifyApiPromise.catch(() => { spotifyApiPromise = null; }); // later opnieuw proberen
  return spotifyApiPromise;
}

/**
 * Spotify-speler die tijdens de vraag is afgedekt: je ziet geen titel, artiest
 * of hoes, alleen een eigen ▶/⏸-knop. De knop stuurt de verborgen speler aan.
 * @param allowReveal  toon een linkje "Speler tonen" (voor de quizmaster, als afspelen niet lukt)
 */
export function hiddenSpotifyPlayer(link, { compact = false, allowReveal = false } = {}) {
  const s = parseSpotify(link);
  if (!s) return null;
  const height = compact ? 80 : 152;
  const holder = h('div', { class: 'spotify-holder' });
  const label = h('span', { class: 'music-cover-text' }, 'Luister goed…');
  const btn = h('button', { type: 'button', class: 'music-play', disabled: true, 'aria-label': 'Afspelen' }, '▶');
  const cover = h('div', { class: 'music-cover' },
    h('span', { class: 'music-bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
    label,
    btn,
  );
  const wrap = h('div', { class: `music-wrap ${compact ? 'music-compact' : ''}`, style: { height: `${height}px` } }, holder, cover);

  const reveal = () => cover.remove();
  if (allowReveal) {
    cover.append(h('button', { type: 'button', class: 'music-reveal', onclick: reveal }, 'Speler tonen'));
  }

  let controller = null;
  let playing = false;
  const setPlaying = (p) => {
    playing = p;
    btn.textContent = p ? '⏸' : '▶';
    btn.setAttribute('aria-label', p ? 'Pauzeren' : 'Afspelen');
    wrap.classList.toggle('is-playing', p);
  };
  btn.addEventListener('click', () => {
    if (!controller) return;
    controller.togglePlay();
    // Als Spotify niet reageert (bijv. geblokkeerd), na even een hint geven.
    setTimeout(() => {
      if (!playing) label.textContent = allowReveal ? 'Speelt het niet? Tik op "Speler tonen".' : 'Luister naar het grote scherm.';
    }, 2500);
  });

  const start = () => {
    if (!holder.isConnected) { requestAnimationFrame(start); return; }
    loadSpotifyApi().then((api) => {
      api.createController(holder, { uri: `spotify:${s.type}:${s.id}`, width: '100%', height }, (c) => {
        controller = c;
        btn.disabled = false;
        c.addListener('playback_update', (e) => {
          setPlaying(!e.data.isPaused);
          if (!e.data.isPaused) label.textContent = 'Luister goed…';
        });
      });
    }).catch(() => {
      // Zonder de API: gewone speler eronder; op de tv kan Rutger hem tonen.
      holder.replaceWith(spotifyPlayer(link, { compact }));
      label.textContent = allowReveal ? 'Tik op "Speler tonen" om af te spelen.' : 'Luister naar het grote scherm.';
      btn.remove();
    });
  };
  start();
  return wrap;
}

// ---------- Achtergrondmuziek met herhalen (tv) ----------

/**
 * Zichtbare Spotify-speler die je vanuit de app kunt starten (play()) en die
 * opnieuw begint als het nummer of fragment is afgelopen (herhalen).
 * Browsers starten geluid alleen na een tik: roep play() aan ín een klik.
 * @returns {{ el: HTMLElement, play(): void, pause(): void }}
 */
export function loopingSpotifyPlayer(link) {
  const s = parseSpotify(link);
  if (!s) return null;
  const uri = `spotify:${s.type}:${s.id}`;
  const isList = s.type !== 'track'; // playlist/album: Spotify speelt zelf het volgende nummer
  const holder = h('div', { class: 'spotify-holder' });
  const debug = h('div', { class: 'bg-music-debug', hidden: !musicDebug() });
  const el = h('div', { class: 'bg-music', 'data-link': link },
    h('span', { class: 'bg-music-label', 'aria-hidden': 'true' }, '♪'),
    h('div', { class: 'bg-music-frame' }, holder),
    debug);

  let ctrl = null;
  let wanted = false;          // moet er muziek klinken?
  let last = { position: 0, duration: 0, isPaused: true };
  let lastUpdate = 0;          // tijdstip van het laatste signaal van Spotify
  let restartTimer = null;
  let restarts = 0;

  const startPlayback = () => {
    if (!ctrl) return;
    if (typeof ctrl.play === 'function') ctrl.play(); else ctrl.togglePlay();
  };
  const restart = (why) => {
    if (!ctrl || !wanted) return;
    restarts++;
    note(`opnieuw (${why})`);
    if (isList && typeof ctrl.loadUri === 'function') { ctrl.loadUri(uri); setTimeout(startPlayback, 800); return; }
    if (typeof ctrl.seek === 'function') ctrl.seek(0);
    startPlayback();
  };
  const note = (extra = '') => {
    if (debug.hidden) return;
    debug.textContent = `pos ${Math.round(last.position)} / dur ${Math.round(last.duration)} · ${last.isPaused ? 'pauze' : 'speelt'} · herstart ${restarts} ${extra}`;
  };

  // Is dit het einde (van het nummer of van het fragment van 30 s), of pauzeerde iemand zelf?
  const looksEnded = (d) => {
    const pos = d.position || 0;
    const dur = d.duration || 0;
    if (dur > 0 && pos >= dur - 2000) return true;               // einde van het nummer
    if (pos >= 28000 && pos <= 32500) return true;                 // einde van het fragment (preview)
    if (pos === 0 && last.position > 1000) return true;            // teruggesprongen naar het begin
    return false;
  };

  const init = () => {
    if (!holder.isConnected) { requestAnimationFrame(init); return; }
    loadSpotifyApi().then((api) => {
      api.createController(holder, { uri, width: '100%', height: 80 }, (c) => {
        ctrl = c;
        c.addListener('playback_update', (e) => {
          const d = e.data || {};
          const wasPlaying = !last.isPaused;
          lastUpdate = Date.now();
          clearTimeout(restartTimer);
          if (d.isPaused && wanted && wasPlaying) {
            if (looksEnded(d)) {
              // Bij een playlist even wachten: misschien start Spotify zelf het volgende nummer.
              restartTimer = setTimeout(() => { if (last.isPaused && wanted) restart('einde'); }, isList ? 3000 : 300);
            } else {
              wanted = false; // zelf gepauzeerd
            }
          }
          if (!d.isPaused) wanted = true; // zelf op ▶ getikt telt ook
          last = { position: d.position || 0, duration: d.duration || 0, isPaused: Boolean(d.isPaused) };
          note();
        });
        if (wanted) startPlayback();
      });
    }).catch(() => {
      // Zonder de API: gewone speler, dan tik je zelf op ▶ (geen herhalen).
      holder.replaceWith(spotifyPlayer(link, { compact: true }));
    });
  };
  init();

  // Vangnet: speelt er niets meer terwijl dat wel zou moeten (geen signalen meer), dan opnieuw.
  setInterval(() => {
    if (!wanted || !ctrl || !el.classList.contains('bg-music-on')) return;
    const silentFor = Date.now() - lastUpdate;
    if (!last.isPaused && silentFor > 6000) restart('stil');
    else if (last.isPaused && silentFor > 8000 && looksEnded(last)) restart('stil na einde');
  }, 2000);

  return {
    el,
    play() { wanted = true; lastUpdate = Date.now(); startPlayback(); },
    pause() {
      wanted = false;
      clearTimeout(restartTimer);
      if (ctrl && !last.isPaused) { if (typeof ctrl.pause === 'function') ctrl.pause(); else ctrl.togglePlay(); }
    },
  };
}

/** Met #tv?debug=1 toont de muziekspeler de signalen van Spotify (om problemen te zoeken). */
function musicDebug() {
  return /[?&]debug=1/.test(location.hash) || /[?&]debug=1/.test(location.search);
}

// ---------- Versie (altijd de nieuwste versie laden) ----------

// Bij elke nieuwe versie ophogen, samen met version.txt en de ?v=… in index.html en de imports.
export const APP_VERSION = '40';

/**
 * GitHub Pages en Safari bewaren bestanden een tijd in de cache. Is er een nieuwere
 * versie online (version.txt), laad de pagina dan opnieuw met ?v=… in de url, zodat
 * de browser alle nieuwe bestanden ophaalt.
 */
export async function checkVersion() {
  try {
    const res = await fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const online = parseInt((await res.text()).trim(), 10);
    const mine = parseInt(APP_VERSION, 10);
    // Alleen herladen als er online een NIEUWERE versie staat. Vlak na een update
    // geeft GitHub soms nog even het oude nummer; daar niet op reageren.
    if (!(online > mine)) return;
    const params = new URLSearchParams(location.search);
    if (params.get('v') === String(online)) return; // al geprobeerd
    // Vangnet: hoogstens één automatische herlaadbeurt per minuut.
    try {
      const last = Number(sessionStorage.getItem('kerstquiz_reload') || 0);
      if (Date.now() - last < 60000) return;
      sessionStorage.setItem('kerstquiz_reload', String(Date.now()));
    } catch { /* geen opslag: toch één keer proberen */ }
    params.set('v', String(online));
    location.replace(`${location.pathname}?${params}${location.hash}`);
  } catch { /* offline: dan maar de huidige versie */ }
}

// ---------- Naam van de quiz ----------

export const QUIZ_NAME = 'Kerstquiz B&S';

/** Titel "Kerstquiz B&S": sierlijk schrift met "B&S" in goud eronder. */
export function brandTitle(extraClass = '') {
  return h('h1', { class: `brand ${extraClass}`, 'aria-label': QUIZ_NAME },
    h('span', { class: 'brand-script', 'aria-hidden': 'true' }, 'Kerstquiz'),
    h('span', { class: 'brand-bs', 'aria-hidden': 'true' }, 'B&S'));
}

/** Fijne gouden sierlijn met een sterretje. */
export function ornament() {
  return h('div', { class: 'ornament', 'aria-hidden': 'true' }, h('span'), '✦', h('span'));
}

// ---------- Speler die de tv zelf start en stopt (muziek bij vraag en antwoord) ----------

/**
 * Spotify-speler via de iFrame API die vanuit de app te bedienen is.
 * play() moet binnen een tik worden aangeroepen (anders houdt de browser het tegen).
 * Speelt één keer (geen herhalen).
 */
export function deckPlayer(link, { height = 152 } = {}) {
  const s = parseSpotify(link);
  if (!s) return null;
  const holder = h('div', { class: 'spotify-holder' });
  const el = h('div', { class: 'deck-player', 'data-link': link }, holder);
  let ctrl = null;
  let wanted = false;
  let playing = false;
  let startedAt = 0;     // tijdstip van de laatste start door de app
  let kicks = 0;         // hoe vaak we het nummer na een onverwachte stop opnieuw hebben aangezet
  const listeners = [];

  // Alleen "speel af" sturen (geen terugspoelen ervoor: die twee berichten kwamen
  // op de iPad soms in de verkeerde volgorde aan, waardoor het na 1 s stopte).
  const start = () => {
    if (!ctrl) return;
    startedAt = Date.now();
    kicks = 0;
    if (typeof ctrl.play === 'function') ctrl.play(); else ctrl.togglePlay();
  };
  const kick = () => {
    if (!ctrl || !wanted) return;
    kicks++;
    if (typeof ctrl.resume === 'function') ctrl.resume(); else ctrl.togglePlay();
  };
  const init = () => {
    if (!holder.isConnected) { requestAnimationFrame(init); return; }
    loadSpotifyApi().then((api) => {
      api.createController(holder, { uri: `spotify:${s.type}:${s.id}`, width: '100%', height }, (c) => {
        ctrl = c;
        c.addListener('playback_update', (e) => {
          const nowPlaying = !e.data.isPaused;
          // Stopt het vlak na de start uit zichzelf? Dan nog een duwtje geven.
          if (!nowPlaying && playing && wanted && Date.now() - startedAt < 3500 && kicks < 2) setTimeout(kick, 250);
          playing = nowPlaying;
          listeners.forEach((f) => f(playing));
        });
        if (wanted) start();
      });
    }).catch(() => {
      holder.replaceWith(spotifyPlayer(link)); // zonder API: gewone speler, zelf op ▶ tikken
    });
  };
  init();

  const api = {
    el,
    play() { wanted = true; start(); },
    pause() {
      wanted = false;
      if (ctrl && playing) { if (typeof ctrl.pause === 'function') ctrl.pause(); else ctrl.togglePlay(); }
    },
    toggle() {
      if (playing) { api.pause(); return; }
      wanted = true;
      startedAt = Date.now();
      kicks = 0;
      if (!ctrl) return;
      if (typeof ctrl.resume === 'function') ctrl.resume(); else ctrl.togglePlay();
    },
    onChange(f) { listeners.push(f); f(playing); },
  };
  return api;
}
