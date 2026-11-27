// Schrikeffect: na een ingesteld aantal seconden verschijnt plotseling een geest met een gil.
// Werkt op de tv en op de telefoons, op basis van de starttijd van de vraag (serverklok).

import { serverNow } from './common.js?v=85';

let ctx = null;
let timer = null;
let timerKey = '';

/**
 * Geluid voor de gil vrijgeven: browsers spelen pas geluid af na een tik van de gebruiker.
 * Alleen als de quiz een schrik heeft, en maar één keer: daarna staat het geluidskanaal
 * weer op pauze. Op de iPad kan een actief geluidskanaal anders Spotify stilzetten.
 */
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'];
let listening = false;

function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    // iOS: een heel kort stil geluidje binnen de tik zet het geluid echt aan
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
    setTimeout(() => { try { ctx.suspend(); } catch { /* */ } }, 300);
    unlockMedia();
    UNLOCK_EVENTS.forEach((ev) => document.removeEventListener(ev, unlock, { capture: true }));
    listening = false;
  } catch { /* geen geluid mogelijk */ }
}

/**
 * Vlak voor de gil een nieuw geluidskanaal maken. Een oud kanaal kan nog aan een vorige uitgang
 * vastzitten (bijv. de tv, terwijl het geluid inmiddels via Bluetooth naar een speaker gaat) en blijft
 * dan stil. Na een eerdere tik mag de browser (Chrome) een nieuw kanaal meteen laten klinken; lukt dat
 * niet (iPad zonder tik), dan blijft het oude, vrijgegeven kanaal in gebruik.
 */
function freshContext() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const n = new AC();
    if (n.state === 'running' || !ctx) {
      const old = ctx;
      ctx = n;
      if (old) old.close().catch(() => {});
    } else {
      n.close().catch(() => {});
    }
  } catch { /* geen nieuw kanaal: het oude gebruiken */ }
}

/** Aanroepen met de vragenlijst: alleen bij een schrik wordt het geluid (één keer) vrijgegeven. */
export function prepareScareAudio(questions) {
  if (ctx || listening || !(questions || []).some((q) => q.scare_after)) return;
  mediaPlayers();  // gil alvast als geluidsbestand klaarzetten
  listening = true;
  UNLOCK_EVENTS.forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));
}

/**
 * Plan de schrik voor deze vraag (of annuleer een oude).
 * `stillValid` wordt vlak voor de schrik gecontroleerd (zelfde vraag nog in beeld?).
 */
export function scheduleScare(game, q, stillValid, imageUrl = null) {
  const key = q?.scare_after ? `${q.id}|${game?.question_started_at}` : '';
  if (key === timerKey) return;
  clearTimeout(timer);
  timer = null;
  timerKey = key;
  if (!key || !game?.question_started_at) { sleepAgain(); return; }
  const at = new Date(game.question_started_at).getTime() + q.scare_after * 1000;
  const delay = at - serverNow();
  if (delay < -1500) return; // al voorbij (bijv. later binnengekomen): niet alsnog schrikken
  // Geluid alvast wakker maken: een Bluetooth-speaker valt na een paar seconden stilte in slaap en
  // mist dan de gil. Een onhoorbaar ruisje houdt de verbinding open tot na de gil.
  keepAwake(Math.max(0, delay) + 3500);
  // Beeld alvast inladen, zodat het meteen verschijnt
  let img = null;
  if (imageUrl) { img = new Image(); img.src = imageUrl; }
  timer = setTimeout(() => { if (!stillValid || stillValid()) showScare(imageUrl); }, Math.max(0, delay));
}

export function cancelScare() {
  clearTimeout(timer);
  timer = null;
  timerKey = '';
  sleepAgain();
}

// ---------------------------------------------------------------- gil als gewoon geluidsbestand
// De gil wordt vooraf opgenomen (OfflineAudioContext) en als WAV afgespeeld via een <audio>-speler,
// net als filmpjes. Dat gaat betrouwbaar naar een Bluetooth-speaker (Sonos), waar live opgebouwd
// geluid (Web Audio) op sommige tablets niet aankomt. Korter dan 5 s, dus Chrome pauzeert Spotify er niet voor.

let screamEl = null;   // <audio> met de opgenomen gil
let hushEl = null;     // <audio> met een onhoorbaar ruisje (houdt Bluetooth wakker)
let awake = false;
let sleepTimer = null;

/** Mono 16-bit WAV van een reeks samples. */
function wavUrl(samples, rate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** De twee spelers maken (één keer) en de gil opnemen. */
function mediaPlayers() {
  if (screamEl) return;
  try {
    screamEl = new Audio(); screamEl.preload = 'auto';
    const rate = 22050;
    const hush = new Float32Array(rate);
    for (let i = 0; i < rate; i++) hush[i] = (Math.random() * 2 - 1) * 0.0006;  // ruim onder -60 dB: onhoorbaar
    hushEl = new Audio(wavUrl(hush, rate)); hushEl.loop = true; hushEl.preload = 'auto';
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return;
    const off = new OAC(1, Math.ceil(44100 * 2.1), 44100);
    buildScream(off, 0.02);
    const done = (b) => { screamEl.src = wavUrl(b.getChannelData(0), 44100); };
    const r = off.startRendering();
    if (r && r.then) r.then(done).catch(() => {}); else off.oncomplete = (e) => done(e.renderedBuffer);
  } catch { /* dan de gil live (Web Audio) */ }
}

/** Binnen een tik: de spelers één keer kort (stil) laten spelen, zodat ze later geluid mogen maken (iPad). */
function unlockMedia() {
  mediaPlayers();
  for (const el of [screamEl, hushEl]) {
    if (!el || !el.src) continue;
    try { el.muted = true; el.play()?.then(() => { el.pause(); el.muted = false; el.currentTime = 0; }, () => { el.muted = false; }); } catch { /* */ }
  }
}

/** Geluid wakker houden tot `ms` vanaf nu: een Bluetooth-speaker valt na stilte in slaap en mist dan de gil. */
function keepAwake(ms) {
  mediaPlayers();
  if (hushEl && !awake) {
    awake = true;
    try { hushEl.muted = false; hushEl.play()?.catch(() => {}); } catch { /* */ }
  }
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(sleepAgain, ms);
}

function sleepAgain() {
  clearTimeout(sleepTimer);
  if (!awake) return;
  awake = false;
  try { hushEl.pause(); } catch { /* */ }
}

const GHOST_SVG = `
<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="gb" cx="50%" cy="35%" r="70%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset=".7" stop-color="#e8eef0"/>
      <stop offset="1" stop-color="#b9c6cc"/>
    </radialGradient>
  </defs>
  <path fill="url(#gb)" d="M22 98C22 46 52 8 100 8S178 46 178 98V222Q170 236 158 218Q146 238 134 218Q122 238 110 218Q100 238 90 218Q78 238 66 218Q54 238 42 218Q30 236 22 222Z"/>
  <ellipse cx="68" cy="96" rx="18" ry="32" fill="#0b0b0b" transform="rotate(-14 68 96)"/>
  <ellipse cx="132" cy="96" rx="18" ry="32" fill="#0b0b0b" transform="rotate(14 132 96)"/>
  <circle cx="71" cy="102" r="5" fill="#d11"/>
  <circle cx="129" cy="102" r="5" fill="#d11"/>
  <path d="M78 150C78 134 122 134 122 150L118 196C114 212 86 212 82 196Z" fill="#0b0b0b"/>
</svg>`;

/** Het schrikbeeld (eigen foto/GIF, anders de geest) en de gil. */
export function showScare(imageUrl = null) {
  document.querySelector('.scare')?.remove();
  const el = document.createElement('div');
  el.className = 'scare';
  el.setAttribute('aria-hidden', 'true');
  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'scare-img';
    img.alt = '';
    img.src = imageUrl;
    el.append(img);
  } else {
    el.innerHTML = `<div class="scare-ghost">${GHOST_SVG}</div>`;
  }
  document.body.append(el);
  scream();
  try { navigator.vibrate?.([500, 100, 700]); } catch { /* geen trilfunctie */ }
  setTimeout(() => el.classList.add('scare-out'), 2600);
  setTimeout(() => el.remove(), 3200);
}

/** De gil: het opgenomen geluidsbestand, of (lukt dat niet) live opgebouwd met de geluidschip. */
function scream() {
  if (awake) { clearTimeout(sleepTimer); sleepTimer = setTimeout(sleepAgain, 2600); }
  if (screamEl && screamEl.src) {
    try {
      screamEl.muted = false; screamEl.currentTime = 0;
      const p = screamEl.play();
      if (p && p.catch) p.catch(liveScream);
      return;
    } catch { /* live proberen */ }
  }
  liveScream();
}

function liveScream() {
  freshContext();
  if (!ctx) return;
  const go = () => buildScream(ctx, ctx.currentTime + 0.02);
  if (ctx.state === 'suspended') ctx.resume().then(go, go); else go();
  setTimeout(() => { try { ctx.suspend(); } catch { /* */ } }, 2600);
}

/** De gil opbouwen in geluidskanaal `c` (live of offline opnemen), beginnend op tijd `t`. */
function buildScream(c, t) {
  try {
    const dur = 1.9;

    const comp = c.createDynamicsCompressor();
    comp.connect(c.destination);
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.9, t + 0.04);
    out.gain.setValueAtTime(0.9, t + dur - 0.5);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // vervorming: maakt het rauw
    const shaper = c.createWaveShaper();
    const n = 1024; const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(4 * x); }
    shaper.curve = curve;
    shaper.connect(out);
    out.connect(comp);

    // klinkerkleur "aaa" (formanten)
    const formants = [[850, 6, 1], [1250, 7, 0.8], [2900, 9, 0.5]].map(([f, q, g]) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const gn = c.createGain(); gn.gain.value = g;
      bp.connect(gn); gn.connect(shaper);
      return bp;
    });

    // stem: een paar ontstemde zaagtanden die omhoog schieten en trillen
    const vib = c.createOscillator(); vib.frequency.value = 7.5;
    const vibGain = c.createGain(); vibGain.gain.value = 45;
    vib.connect(vibGain);
    [0, 9, -13].forEach((detune) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(1350, t + 0.14);
      o.frequency.linearRampToValueAtTime(1250, t + 1.1);
      o.frequency.exponentialRampToValueAtTime(800, t + dur);
      vibGain.connect(o.frequency);
      const g = c.createGain(); g.gain.value = 0.35;
      o.connect(g); formants.forEach((f) => g.connect(f));
      o.start(t); o.stop(t + dur);
    });
    vib.start(t); vib.stop(t + dur);

    // adem/ruis
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource(); noise.buffer = buf;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2600; nf.Q.value = 1.2;
    const ng = c.createGain(); ng.gain.value = 0.25;
    noise.connect(nf); nf.connect(ng); ng.connect(shaper);
    noise.start(t); noise.stop(t + dur);

    // dreun bij het verschijnen
    const boom = c.createOscillator(); boom.type = 'sine';
    boom.frequency.setValueAtTime(110, t); boom.frequency.exponentialRampToValueAtTime(35, t + 0.6);
    const bg = c.createGain();
    bg.gain.setValueAtTime(1, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    boom.connect(bg); bg.connect(comp);
    boom.start(t); boom.stop(t + 0.75);
  } catch { /* geluid mislukt: de geest komt toch */ }
}
