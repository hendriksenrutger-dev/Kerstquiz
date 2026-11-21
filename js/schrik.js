// Schrikeffect: na een ingesteld aantal seconden verschijnt plotseling een geest met een gil.
// Werkt op de tv en op de telefoons, op basis van de starttijd van de vraag (serverklok).

import { serverNow } from './common.js?v=57';

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
    UNLOCK_EVENTS.forEach((ev) => document.removeEventListener(ev, unlock, { capture: true }));
    listening = false;
  } catch { /* geen geluid mogelijk */ }
}

/** Aanroepen met de vragenlijst: alleen bij een schrik wordt het geluid (één keer) vrijgegeven. */
export function prepareScareAudio(questions) {
  if (ctx || listening || !(questions || []).some((q) => q.scare_after)) return;
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
  if (!key || !game?.question_started_at) return;
  const at = new Date(game.question_started_at).getTime() + q.scare_after * 1000;
  const delay = at - serverNow();
  if (delay < -1500) return; // al voorbij (bijv. later binnengekomen): niet alsnog schrikken
  // Beeld alvast inladen, zodat het meteen verschijnt
  let img = null;
  if (imageUrl) { img = new Image(); img.src = imageUrl; }
  timer = setTimeout(() => { if (!stillValid || stillValid()) showScare(imageUrl); }, Math.max(0, delay));
}

export function cancelScare() {
  clearTimeout(timer);
  timer = null;
  timerKey = '';
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

/** Een gil, opgebouwd met de geluidschip (geen geluidsbestand nodig). */
function scream() {
  if (!ctx) return;
  const go = () => playScream();
  if (ctx.state === 'suspended') ctx.resume().then(go, go); else go();
  // na de gil het geluidskanaal weer op pauze (zodat Spotify ongestoord kan spelen)
  setTimeout(() => { try { ctx.suspend(); } catch { /* */ } }, 2600);
}

function playScream() {
  try {
    const t = ctx.currentTime + 0.02;
    const dur = 1.9;

    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.9, t + 0.04);
    out.gain.setValueAtTime(0.9, t + dur - 0.5);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // vervorming: maakt het rauw
    const shaper = ctx.createWaveShaper();
    const n = 1024; const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(4 * x); }
    shaper.curve = curve;
    shaper.connect(out);
    out.connect(comp);

    // klinkerkleur "aaa" (formanten)
    const formants = [[850, 6, 1], [1250, 7, 0.8], [2900, 9, 0.5]].map(([f, q, g]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const gn = ctx.createGain(); gn.gain.value = g;
      bp.connect(gn); gn.connect(shaper);
      return bp;
    });

    // stem: een paar ontstemde zaagtanden die omhoog schieten en trillen
    const vib = ctx.createOscillator(); vib.frequency.value = 7.5;
    const vibGain = ctx.createGain(); vibGain.gain.value = 45;
    vib.connect(vibGain);
    [0, 9, -13].forEach((detune) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(1350, t + 0.14);
      o.frequency.linearRampToValueAtTime(1250, t + 1.1);
      o.frequency.exponentialRampToValueAtTime(800, t + dur);
      vibGain.connect(o.frequency);
      const g = ctx.createGain(); g.gain.value = 0.35;
      o.connect(g); formants.forEach((f) => g.connect(f));
      o.start(t); o.stop(t + dur);
    });
    vib.start(t); vib.stop(t + dur);

    // adem/ruis
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2600; nf.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = 0.25;
    noise.connect(nf); nf.connect(ng); ng.connect(shaper);
    noise.start(t); noise.stop(t + dur);

    // dreun bij het verschijnen
    const boom = ctx.createOscillator(); boom.type = 'sine';
    boom.frequency.setValueAtTime(110, t); boom.frequency.exponentialRampToValueAtTime(35, t + 0.6);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(1, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    boom.connect(bg); bg.connect(comp);
    boom.start(t); boom.stop(t + 0.75);
  } catch { /* geluid mislukt: de geest komt toch */ }
}
