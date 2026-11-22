// Beheer (#beheer): vragen beheren, foto's uploaden, kerstbomen toevoegen,
// spelinstellingen en een spel starten. Licht thema; werkt op iPad en iPhone.
import {
  sb, h, mount, toast, LETTERS, errorText, loginForm, parseSpotify, cleanSpotifyLink, spotifyPlayer, SCARE_SECONDS,
} from './common.js?v=73';
import { parseNumber, formatNumber } from './scoring.js?v=73';
import { addTestPlayers } from './proef.js?v=73';

const TREE_CATEGORY = 'Van wie is deze kerstboom?';
// Drie soorten muziekvragen (zie renderMusicForm)
const MUSIC = {
  // Spotify speelt alleen op de tv: met speler in beeld, of alleen geluid (als de speler het antwoord zou verraden)
  ingestuurd: { category: 'Wie heeft dit nummer ingestuurd?', mode: 'alleen_tv' },
  artiest: { category: 'Van wie is dit nummer?', mode: 'alleen_geluid' },
  zin: { category: 'Maak de zin af', mode: 'alleen_tv' },
};
const DEFAULT_CATEGORIES = [TREE_CATEGORY, ...Object.values(MUSIC).map((m) => m.category), 'In welke stad staat deze kerstboom?', 'Kerstfeitje'];
const REVEAL_EFFECTS = [
  { value: '', label: 'Gewoon tonen' },
  { value: 'vervagen', label: 'Langzaam scherper (begint wazig)' },
  { value: 'inzoomen', label: 'Langzaam uitzoomen (begint heel dichtbij)' },
  { value: 'puzzel', label: 'Puzzelstukjes die één voor één wegvallen' },
];
/** "1:05" of "65" → 65 seconden; leeg → null; ongeldig → false. */
function parseTime(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,3})(?::([0-5]?\d))?$/);
  if (!m) return false;
  return m[2] != null ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]);
}
const formatTime = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');
const timeInput = (sec) => h('input', { type: 'text', inputmode: 'numeric', value: formatTime(sec), placeholder: '0:00', class: 'input-short', maxlength: '6' });

const KINDS = [
  { value: 'meerkeuze', label: 'Meerkeuze' },
  { value: 'open', label: 'Open' },
  { value: 'schatting', label: 'Schatting' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));
const PHOTO_MAX = 1600;
const PHOTO_QUALITY = 0.8;
const GIF_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;  // grens van Supabase (gratis)

const state = {
  questions: [],
  answers: new Map(),   // question_id → rij uit question_answers
  thumbs: new Map(),    // photo_path → tijdelijke link
  settings: { min_votes: 10 },
};

export async function startBeheer(params) {
  document.body.className = 'beheer';
  const { data } = await sb.auth.getSession();
  if (!data.session) return renderLogin(params);
  await afterLogin(params);
}

function renderLogin(params, message) {
  mount(h('div', { class: 'beheer-page beheer-login' },
    h('h1', { class: 'serif' }, 'Kerstquiz · beheer'),
    loginForm(() => afterLogin(params), message),
  ));
}

async function afterLogin(params) {
  mount(h('div', { class: 'beheer-page' }, h('p', { class: 'muted' }, 'Laden…')));
  try {
    await loadAll();
  } catch (e) {
    return renderLogin(params, errorText(e));
  }
  if (params?.get('scherm') === 'boom') return renderTreeForm();
  if (params?.get('scherm') === 'nummer') return renderMusicForm();
  renderList();
}

// ---------------------------------------------------------------- data

async function loadAll() {
  const [q, a, s] = await Promise.all([
    sb.from('questions').select('*').order('position').order('created_at'),
    sb.from('question_answers').select('*'),
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (q.error) throw q.error;
  if (a.error) throw a.error;
  state.questions = q.data || [];
  state.answers = new Map((a.data || []).map((r) => [r.question_id, r]));
  // settings bestaat pas na 002_beheer.sql; zonder die tabel gewoon de standaard
  if (s.data) state.settings = s.data;
  state.settingsMissing = Boolean(s.error);
  await loadThumbs();
}

async function loadThumbs() {
  const paths = [
    ...state.questions.map((q) => q.photo_path),
    ...[...state.answers.values()].map((a) => a.answer_photo_path),
    ...state.questions.map((q) => q.scare_path),
    ...state.questions.map((q) => q.video_path),
    ...state.questions.map((q) => q.audio_path),
    ...[...state.answers.values()].map((a) => a.answer_video_path),
  ].filter((p) => p && !state.thumbs.has(p));
  if (!paths.length) return;
  const { data } = await sb.storage.from('fotos').createSignedUrls(paths, 60 * 60);
  for (const row of data || []) if (row.signedUrl) state.thumbs.set(row.path, row.signedUrl);
}

function categorySuggestions() {
  const used = state.questions.map((q) => q.category).filter(Boolean);
  return [...new Set([...used, ...DEFAULT_CATEGORIES])];
}

function treeNameSuggestions() {
  const names = state.questions
    .filter((q) => (q.category === TREE_CATEGORY || q.category === MUSIC.ingestuurd.category) && Array.isArray(q.options))
    .flatMap((q) => q.options);
  return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl'));
}

const treeCount = () => state.questions.filter((q) => q.category === TREE_CATEGORY).length;
const musicCount = () => state.questions.filter((q) => q.media_url).length;

function setScreen(scherm) {
  history.replaceState(null, '', scherm ? `#beheer?scherm=${scherm}` : '#beheer');
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- foto's

/** Verklein in de browser tot max 1600 px, JPEG kwaliteit 0,8. */
async function resizePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Deze foto kan niet worden geopend. Kies een JPEG- of PNG-foto.'));
      i.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const hgt = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
    return await new Promise((resolve, reject) => canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Verkleinen van de foto is mislukt.'))),
      'image/jpeg', PHOTO_QUALITY,
    ));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadPhoto(blob) {
  const gif = blob.type === 'image/gif';
  const path = `vragen/${crypto.randomUUID()}.${gif ? 'gif' : 'jpg'}`;
  const { error } = await sb.storage.from('fotos').upload(path, blob, { contentType: gif ? 'image/gif' : 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

// Ook een filmpje (bijv. een schermopname) mag: de tv gebruikt alleen het geluid ervan.
const AUDIO_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' };
async function uploadAudio(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = AUDIO_TYPES[ext] || (file.type && /^(audio|video)\//.test(file.type) ? file.type : 'audio/mpeg');
  const path = `geluid/${crypto.randomUUID()}.${AUDIO_TYPES[ext] ? ext : 'mp3'}`;
  const { error } = await sb.storage.from('fotos').upload(path, file, { contentType: type, upsert: false });
  if (error) throw error;
  return path;
}

async function uploadVideo(file) {
  const type = file.type || 'video/mp4';
  const ext = type === 'video/quicktime' ? 'mov' : type === 'video/webm' ? 'webm' : 'mp4';
  const path = `filmpjes/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('fotos').upload(path, file, { contentType: type, upsert: false });
  if (error) throw error;
  return path;
}

/** Filmpjekiezer met voorbeeld. Geeft { el, get() } terug; get() → { file, removed }. */
function videoPicker(currentUrl, label, { audio = false } = {}) {
  let file = null;
  let removed = false;
  const what = audio ? 'geluidsbestand' : 'filmpje';
  const preview = audio
    ? h('audio', { class: 'audio-preview', controls: true, preload: 'metadata' })
    : h('video', { class: 'video-preview', controls: true, playsinline: true, preload: 'metadata' });
  const status = h('p', { class: 'hint' });
  const input = h('input', { type: 'file', accept: audio ? 'audio/*,.mp3,.m4a' : 'video/*', class: 'sr-only' });
  // Bij geluid ook een aparte knop voor een filmpje uit de galerij (Android toont de galerij alleen bij video/*).
  const galleryInput = audio ? h('input', { type: 'file', accept: 'video/*', class: 'sr-only' }) : null;
  const removeBtn = h('button', { type: 'button', class: 'btn btn-light btn-small' }, `${audio ? 'Geluid' : 'Filmpje'} verwijderen`);
  const show = (url) => {
    preview.hidden = !url;
    removeBtn.hidden = !url;
    if (url) preview.src = url; else preview.removeAttribute('src');
  };
  show(currentUrl);
  const onPick = (inp) => {
    const f = inp.files?.[0];
    inp.value = '';
    if (!f) return;
    if (f.size > VIDEO_MAX_BYTES) {
      status.textContent = `Dit ${what} is te groot (${Math.round(f.size / 1048576)} MB). Maximaal 50 MB: kort het in, of kies een lagere kwaliteit.`;
      return;
    }
    file = f;
    removed = false;
    show(URL.createObjectURL(f));
    status.textContent = `Gekozen (${Math.round(f.size / 1048576)} MB). Wordt geüpload bij Opslaan.`;
  };
  input.addEventListener('change', () => onPick(input));
  galleryInput?.addEventListener('change', () => onPick(galleryInput));
  removeBtn.addEventListener('click', () => { file = null; removed = true; show(null); status.textContent = ''; });
  const pick = h('label', { class: 'btn btn-green' }, input, currentUrl ? `Ander ${what} kiezen` : `${audio ? 'Geluidsbestand' : 'Filmpje'} kiezen`);
  const el = h('div', { class: 'stack-tight' },
    h('span', { class: 'field-label' }, label),
    preview,
    h('div', { class: 'row' }, pick, galleryInput && h('label', { class: 'btn btn-light' }, galleryInput, '🎬 Filmpje uit galerij'), removeBtn),
    status);
  return { el, get: () => ({ file, removed }) };
}

async function removePhoto(path) {
  if (!path) return;
  await sb.storage.from('fotos').remove([path]);
  state.thumbs.delete(path);
}

/** Fotokiezer met voorbeeld. Geeft { el, get() } terug; get() → { blob, removed }. */
function photoPicker(currentUrl, { big = false } = {}) {
  let blob = null;
  let removed = false;
  const preview = h('img', { class: 'photo-preview', alt: 'Gekozen foto' });
  const empty = h('div', { class: 'photo-empty' }, 'Nog geen foto');
  const status = h('p', { class: 'hint' });
  const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' });
  const removeBtn = h('button', { type: 'button', class: 'btn btn-light btn-small' }, 'Foto verwijderen');

  const show = (url) => {
    preview.hidden = !url;
    empty.hidden = Boolean(url);
    removeBtn.hidden = !url;
    if (url) preview.src = url; else preview.removeAttribute('src');
  };
  show(currentUrl);

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.type === 'image/gif') {
        // Bewegende GIF: niet verkleinen of omzetten, anders blijft alleen het eerste beeld over.
        if (file.size > GIF_MAX_BYTES) throw new Error(`Deze GIF is te groot (${Math.round(file.size / 1048576)} MB). Maximaal 10 MB.`);
        blob = file;
        status.textContent = `Bewegende GIF (${Math.round(blob.size / 1024)} kB)`;
      } else {
        status.textContent = 'Foto verkleinen…';
        blob = await resizePhoto(file);
        status.textContent = `Klaar (${Math.round(blob.size / 1024)} kB)`;
      }
      removed = false;
      show(URL.createObjectURL(blob));
    } catch (e) {
      status.textContent = e.message;
    }
    input.value = '';
  });
  removeBtn.addEventListener('click', () => { blob = null; removed = true; show(null); status.textContent = ''; });

  const pick = h('label', { class: `btn btn-green ${big ? 'btn-block btn-lg' : ''}` }, input, currentUrl ? 'Andere foto kiezen' : 'Foto kiezen');

  const el = h('div', { class: `photo-picker ${big ? 'photo-picker-big' : ''}` },
    h('div', { class: 'photo-frame' }, preview, empty),
    h('div', { class: 'row' }, pick, removeBtn),
    status,
  );
  return { el, get: () => ({ blob, removed }), reset: () => { blob = null; removed = false; show(null); status.textContent = ''; } };
}

// ---------------------------------------------------------------- vragenlijst

function renderList() {
  setScreen(null);
  const items = state.questions.map((q, i) => questionItem(q, i));

  mount(h('div', { class: 'beheer-page' },
    header(),
    h('section', { class: 'b-card b-actions' },
      h('button', { class: 'btn btn-green btn-lg', onclick: startGame, disabled: state.questions.length === 0 }, 'Start quiz op dit scherm'),
      h('button', { class: 'btn btn-light btn-lg', onclick: renderTreeForm }, '🎄 Kerstboom toevoegen'),
      h('button', { class: 'btn btn-light btn-lg', onclick: renderMusicForm }, '🎵 Nummer toevoegen'),
      h('button', { class: 'btn btn-light btn-lg', onclick: () => renderEdit(null, { scareOnly: true }) }, '👻 Schrikvraag toevoegen'),
      h('button', {
        class: 'btn btn-light btn-lg btn-test', onclick: startTestGame, disabled: state.questions.length === 0,
        title: 'Testquiz met 30 testspelers die zelf antwoorden',
      }, 'Test'),
    ),
    h('section', { class: 'b-section' },
      h('div', { class: 'b-section-head' },
        h('h2', { class: 'serif' }, `Vragen (${state.questions.length})`),
        h('button', { class: 'btn btn-green', onclick: () => renderEdit(null) }, '+ Vraag toevoegen'),
      ),
      items.length
        ? h('ol', { class: 'q-list' }, items)
        : h('p', { class: 'b-card muted' }, 'Nog geen vragen. Tik op "+ Vraag toevoegen".'),
    ),
    settingsCard(),
  ));
}

function header() {
  return h('header', { class: 'b-header' },
    h('h1', { class: 'serif' }, 'Kerstquiz · beheer'),
    h('div', { class: 'row' },
      h('a', { class: 'link', href: '#tv' }, '← Beginscherm'),
      h('a', { class: 'link', href: '#afstand' }, '📱 Afstandsbediening'),
      h('button', { class: 'link', onclick: logout }, 'Uitloggen'),
    ),
  );
}

function questionItem(q, i) {
  const thumb = q.photo_path ? state.thumbs.get(q.photo_path) : null;
  const ans = state.answers.get(q.id);
  return h('li', { class: 'q-item b-card', 'data-index': i },
    h('button', {
      type: 'button', class: 'drag-handle', 'aria-label': 'Slepen om te verplaatsen', title: 'Vasthouden en slepen',
      onpointerdown: (e) => startDrag(e, i),
    }, '⠿'),
    h('button', { type: 'button', class: 'q-num', title: 'Tik om naar een ander nummer te verplaatsen', onclick: () => moveAsk(i) }, i + 1),
    thumb ? h('img', { class: 'q-thumb', src: thumb, alt: '' }) : h('div', { class: 'q-thumb q-thumb-empty', 'aria-hidden': 'true' }),
    h('div', { class: 'q-info' },
      h('div', { class: 'q-tags' },
        q.category && h('span', { class: 'b-label' }, q.category),
        h('span', { class: 'b-kind' }, KIND_LABEL[q.kind] || q.kind),
        h('span', { class: 'muted' }, `${q.scare_only ? q.time_limit - (q.scare_after || 0) - SCARE_SECONDS : q.time_limit} s`),
        q.rate_tree && h('span', { class: 'muted' }, '★ cijfer'),
        q.tiebreak && h('span', { class: 'b-tiebreak' }, '⚖️ Schifting'),
        q.scare_after && h('span', { class: 'b-tiebreak' }, `${q.scare_path ? '🤡' : '👻'} ${q.scare_only ? 'Schrikvraag' : 'Schrik'} na ${q.scare_after} s`),
        ans?.answer_photo_path && h('span', { class: 'muted' }, '📷 antwoordfoto'),
        ans?.answer_media_url && h('span', { class: 'muted' }, '♪ antwoordnummer'),
        q.video_path && h('span', { class: 'muted' }, '🎬 filmpje'),
        q.audio_path && h('span', { class: 'muted' }, q.audio_reverse ? '⏪ geluid achterstevoren' : '🔊 geluid'),
        q.reveal_effect && h('span', { class: 'muted' }, `🧩 ${q.reveal_effect === 'puzzel' ? 'puzzelstukjes' : q.reveal_effect === 'inzoomen' ? 'uitzoomen' : 'wazig → scherp'}`),
        q.media_seconds && h('span', { class: 'muted' }, `🎧 intro ${q.media_seconds} s`),
        q.media_start && h('span', { class: 'muted' }, `⏩ vanaf ${formatTime(q.media_start)}`),
        q.fastest_count && h('span', { class: 'muted' }, `⚡ ${q.fastest_count} snelsten`),
        ans?.answer_video_path && h('span', { class: 'muted' }, '🎬 antwoordfilmpje'),
        q.media_url && h('span', { class: 'b-music' }, ['alleen_geluid', 'verbergen'].includes(q.media_mode) ? '♪ Spotify (alleen geluid)' : '♪ Spotify (speler op tv)'),
      ),
      h('div', { class: 'q-title' }, q.text),
      h('div', { class: 'muted q-answer' }, answerSummary(q, ans)),
    ),
    h('div', { class: 'q-buttons' },
      h('button', { class: 'icon-btn', 'aria-label': 'Omhoog', title: 'Omhoog', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'icon-btn', 'aria-label': 'Omlaag', title: 'Omlaag', disabled: i === state.questions.length - 1, onclick: () => move(i, 1) }, '↓'),
      h('button', { class: 'btn btn-light btn-small', onclick: () => moveAsk(i), title: 'Naar een ander nummer verplaatsen' }, '↕ Naar…'),
      h('a', { class: 'btn btn-light btn-small', href: `#tv?voorbeeld=${q.id}`, title: 'Bekijk deze vraag zoals op de tv' }, '👁 Voorbeeld'),
      h('button', { class: 'btn btn-light btn-small', onclick: () => renderEdit(q) }, 'Bewerken'),
      h('button', { class: 'btn btn-danger btn-small', onclick: () => removeQuestion(q) }, 'Verwijderen'),
    ),
  );
}

function answerSummary(q, ans) {
  if (!ans) return '⚠ Nog geen goed antwoord';
  if (q.kind === 'meerkeuze' && ans.correct_option != null) {
    return `✓ ${LETTERS[ans.correct_option]}: ${(q.options || [])[ans.correct_option] ?? ''}`;
  }
  if (q.kind === 'open' && ans.correct_texts?.length) return `✓ ${ans.correct_texts.join(' / ')}`;
  if (q.kind === 'schatting' && ans.correct_value != null) return `✓ ${formatNumber(ans.correct_value)}${q.unit ? ` ${q.unit}` : ''}`;
  return '⚠ Nog geen goed antwoord';
}


function move(i, dir) {
  return moveTo(i, i + dir);
}

/** Vraag `i` naar een ander nummer: vraag het nummer. */
function moveAsk(i) {
  const n = state.questions.length;
  const answer = prompt(`Naar welk nummer moet vraag ${i + 1} (1–${n})?`, String(i + 1));
  if (answer == null) return;
  const to = parseInt(answer, 10);
  if (!(to >= 1 && to <= n)) return toast(`Kies een nummer van 1 tot en met ${n}.`);
  moveTo(i, to - 1);
}

/** Slepen aan het ⠿-handvat (werkt met vinger en muis). */
function startDrag(e, from) {
  const item = e.currentTarget.closest('.q-item');
  const list = item?.parentElement;
  if (!item || !list) return;
  e.preventDefault();
  const items = [...list.children];
  const rects = items.map((el) => el.getBoundingClientRect());
  const startY = e.clientY;
  let to = from;
  let lastY = e.clientY;
  item.classList.add('dragging');
  const scrollTimer = setInterval(() => {
    // automatisch scrollen bij de rand van het scherm
    const edge = 80;
    if (lastY < edge) window.scrollBy(0, -12); else if (lastY > window.innerHeight - edge) window.scrollBy(0, 12);
  }, 16);
  const startScroll = window.scrollY;
  const onMove = (ev) => {
    lastY = ev.clientY;
    const dy = ev.clientY - startY + (window.scrollY - startScroll);
    item.style.transform = `translateY(${dy}px)`;
    const center = rects[from].top + rects[from].height / 2 + dy;
    to = from;
    rects.forEach((r, k) => {
      const mid = r.top + r.height / 2;
      if (k < from && center < mid) to = Math.min(to, k);
      if (k > from && center > mid) to = Math.max(to, k);
    });
    const h0 = rects[from].height + 10;
    items.forEach((el, k) => {
      if (el === item) return;
      let shift = 0;
      if (from < to && k > from && k <= to) shift = -h0;
      if (from > to && k < from && k >= to) shift = h0;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const onUp = () => {
    clearInterval(scrollTimer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    items.forEach((el) => { el.style.transform = ''; });
    item.classList.remove('dragging');
    if (to !== from) moveTo(from, to);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

async function moveTo(i, j) {
  if (i === j || j < 0 || j >= state.questions.length) return;
  const list = [...state.questions];
  const [q] = list.splice(i, 1);
  list.splice(j, 0, q);
  // posities opnieuw nummeren 1..n en alleen gewijzigde rijen opslaan
  const updates = [];
  list.forEach((q, k) => {
    if (q.position !== k + 1) { updates.push({ id: q.id, position: k + 1 }); q.position = k + 1; }
  });
  state.questions = list;
  renderList();
  const results = await Promise.all(updates.map((u) => sb.from('questions').update({ position: u.position }).eq('id', u.id)));
  const failed = results.find((r) => r.error);
  if (failed) {
    toast(errorText(failed.error));
    await loadAll();
    renderList();
  }
}

async function removeQuestion(q) {
  if (!confirm(`Vraag verwijderen?\n\n"${q.text}"\n\nDit kan niet ongedaan worden gemaakt.`)) return;
  const { error } = await sb.from('questions').delete().eq('id', q.id);
  if (error) return toast(errorText(error));
  await removePhoto(q.photo_path);
  await removePhoto(state.answers.get(q.id)?.answer_photo_path);
  await removePhoto(q.scare_path);
  await removePhoto(q.video_path);
  await removePhoto(q.audio_path);
  await removePhoto(state.answers.get(q.id)?.answer_video_path);
  state.questions = state.questions.filter((x) => x.id !== q.id);
  state.answers.delete(q.id);
  toast('Vraag verwijderd');
  renderList();
}

// ---------------------------------------------------------------- spelinstellingen

function settingsCard() {
  const input = h('input', {
    type: 'number', inputmode: 'numeric', min: '1', max: '100', step: '1',
    value: String(state.settings.min_votes), class: 'input-short',
  });
  const btn = h('button', { class: 'btn btn-green', type: 'submit' }, 'Opslaan');
  const hasMusic = 'start_music' in state.settings;
  const startMusic = spotifyField(state.settings.start_music || '', { label: 'Muziek bij de start (wachtruimte en "Zo werkt het")' });
  const endMusic = spotifyField(state.settings.end_music || '', { label: 'Muziek bij het einde (eindstand en mooiste kerstboom)' });
  const musicBtn = h('button', { class: 'btn btn-green', type: 'submit' }, 'Muziek opslaan');
  const hasCountdown = 'countdown_seconds' in state.settings;
  const cdSecs = h('input', { type: 'number', inputmode: 'numeric', min: '3', max: '600', step: '1', value: state.settings.countdown_seconds ? String(state.settings.countdown_seconds) : '', placeholder: 'geen', class: 'input-short' });
  const cdMusic = spotifyField(state.settings.countdown_music || '', { label: 'Muziek tijdens het aftellen (optioneel)' });
  const cdStart = timeInput(state.settings.countdown_music_start);
  const cdBpm = h('input', { type: 'number', inputmode: 'numeric', min: '40', max: '240', step: '1', value: state.settings.countdown_bpm ? String(state.settings.countdown_bpm) : '', placeholder: 'geen', class: 'input-short' });
  const cdInfo = h('p', { class: 'hint' });
  /** Laat zien hoe lang het aftellen echt duurt en wanneer de drop moet vallen. */
  const updateCdInfo = () => {
    const secs = parseInt(cdSecs.value, 10);
    const bpm = parseInt(cdBpm.value, 10);
    if (!(secs >= 3)) { cdInfo.textContent = ''; return; }
    let tick = 1;
    if (bpm >= 40) { const beat = 60 / bpm; tick = beat * Math.max(1, Math.round(1 / beat)); }
    const dur = secs * tick;
    const st = parseTime(cdStart.value);
    const fmt = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0').replace('.', ',')}`;
    cdInfo.textContent = `Het aftellen duurt ${dur.toFixed(1).replace('.', ',')} s${bpm >= 40 ? ` (elke tel ${tick.toFixed(3).replace('.', ',')} s = ${Math.round(tick / (60 / bpm))} beat${Math.round(tick / (60 / bpm)) > 1 ? 's' : ''})` : ''}.`
      + (st ? ` De muziek begint op ${formatTime(st)}, dus bij 0 is het nummer op ${fmt(st + dur)}: zet daar de drop.` : ' Tip: beginpunt = moment van de drop min deze duur.');
  };
  [cdSecs, cdBpm, cdStart].forEach((el) => el.addEventListener('input', updateCdInfo));
  updateCdInfo();
  const cdBtn = h('button', { class: 'btn btn-green', type: 'submit' }, 'Aftellen opslaan');

  return h('section', { class: 'b-section' },
    h('h2', { class: 'serif' }, 'Spelinstellingen'),
    state.settingsMissing
      ? h('p', { class: 'b-card b-warning' }, 'Voer eerst supabase/002_beheer.sql uit in Supabase om de spelinstellingen te kunnen opslaan.')
      : [h('form', {
        class: 'b-card stack',
        onsubmit: async (e) => {
          e.preventDefault();
          const n = parseInt(input.value, 10);
          if (!(n >= 1)) return toast('Vul een getal van 1 of hoger in.');
          btn.disabled = true;
          const { error } = await sb.from('settings').update({ min_votes: n }).eq('id', 1);
          // ook toepassen op spellen die nog niet afgelopen zijn
          if (!error) await sb.from('games').update({ min_votes: n }).neq('status', 'tree');
          btn.disabled = false;
          if (error) return toast(errorText(error));
          state.settings.min_votes = n;
          toast('Opgeslagen');
        },
      },
        h('label', {}, 'Minimum aantal stemmen voor de mooiste kerstboom',
          h('div', { class: 'row' }, input, btn)),
        h('p', { class: 'hint' }, 'Een boom met minder stemmen kan niet winnen.'),
      ),
      hasMusic
        ? h('form', {
          class: 'b-card stack',
          onsubmit: async (e) => {
            e.preventDefault();
            const start = startMusic.value();
            const end = endMusic.value();
            if (start === false || end === false) return toast('Een Spotify-link wordt niet herkend.');
            musicBtn.disabled = true;
            const { error } = await sb.from('settings').update({ start_music: start, end_music: end }).eq('id', 1);
            musicBtn.disabled = false;
            if (error) return toast(errorText(error));
            Object.assign(state.settings, { start_music: start, end_music: end });
            toast('Muziek opgeslagen');
          },
        },
          startMusic.el,
          endMusic.el,
          h('p', { class: 'hint' }, 'Op de tv verschijnt onderin een kleine speler; tik op ▶ om te starten. Laat een veld leeg voor geen muziek.'),
          musicBtn,
        )
        : h('p', { class: 'b-card b-warning' }, 'Voer supabase/005_muziek_start_einde.sql uit in Supabase om muziek bij de start en het einde in te stellen.'),
      hasCountdown
        ? h('form', {
          class: 'b-card stack',
          onsubmit: async (e) => {
            e.preventDefault();
            const secs = cdSecs.value.trim() ? parseInt(cdSecs.value, 10) : null;
            if (secs != null && !(secs >= 3 && secs <= 600)) return toast('Kies 3 tot 600 seconden, of laat het leeg.');
            const link = cdMusic.value();
            if (link === false) return toast('De Spotify-link wordt niet herkend.');
            const st = parseTime(cdStart.value);
            if (st === false) return toast('Vul het beginpunt in als minuten:seconden, bijvoorbeeld 1:05.');
            const row = { countdown_seconds: secs, countdown_music: link };
            if (st || state.settings.countdown_music_start) row.countdown_music_start = st || null;
            const bpm = cdBpm.value.trim() ? parseInt(cdBpm.value, 10) : null;
            if (bpm != null && !(bpm >= 40 && bpm <= 240)) return toast('BPM: kies 40 tot 240, of laat het leeg.');
            if (bpm || state.settings.countdown_bpm) row.countdown_bpm = bpm || null;
            cdBtn.disabled = true;
            const { error } = await sb.from('settings').update(row).eq('id', 1);
            cdBtn.disabled = false;
            if (error) return toast(errorText(error));
            Object.assign(state.settings, row);
            toast('Aftellen opgeslagen');
          },
        },
          h('label', {}, '⏱ Aftellen na "Zo werkt het": aantal seconden', cdSecs,
            h('span', { class: 'hint' }, 'Op de tv staat dan "Quiz begint in" met grote aftellende seconden; bij 0 start de eerste vraag vanzelf. Leeg = geen aftelscherm.')),
          cdMusic.el,
          h('label', {}, '⏩ Muziek begint bij (minuten:seconden)', cdStart,
            h('span', { class: 'hint' }, 'Bijvoorbeeld 0:45. Leeg = vanaf het begin.')),
          h('label', {}, '🥁 BPM van het nummer (optioneel)', cdBpm,
            h('span', { class: 'hint' }, 'Dan tikt de klok op de beat in plaats van precies elke seconde (bijv. 126 bpm: elke 2 tellen). Op te zoeken via songbpm.com.')),
          cdInfo,
          cdBtn,
        )
        : h('p', { class: 'b-card b-warning' }, 'Voer supabase/019_aftellen.sql uit in Supabase om het aftellen in te stellen.'),
      ],
  );
}

// ---------------------------------------------------------------- spel starten

/** Testquiz: nieuw, apart spel met 30 testspelers die zelf willekeurig antwoorden. */
async function startTestGame(e) {
  if (!confirm('Testquiz starten?\n\nEr komt een apart testspel met 30 testspelers die zelf willekeurig antwoorden. Gebruik voor de echte avond "Start quiz op dit scherm".')) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Testspelers toevoegen…';
  const { data, error } = await sb.rpc('create_game');
  if (error) { btn.disabled = false; btn.textContent = 'Test'; return toast(errorText(error)); }
  try {
    await addTestPlayers(data.id, data.code);
  } catch (ex) {
    toast(errorText(ex));
  }
  location.hash = `#tv?spel=${data.id}`;
}

async function startGame() {
  const { data, error } = await sb.rpc('create_game');
  if (error) return toast(errorText(error));
  location.hash = `#tv?spel=${data.id}`;
}

async function logout() {
  await sb.auth.signOut();
  renderLogin(null);
}

// ---------------------------------------------------------------- vraag bewerken

function renderEdit(q, { scareOnly: newScare = false } = {}) {
  setScreen(null);
  const isNew = !q;
  // Schrikvraag: eerst alleen "Kijk goed…" in beeld, dan het schrikbeeld, daarna de echte vraag.
  const scareOnly = q ? Boolean(q.scare_only) : newScare;
  const ans = q ? state.answers.get(q.id) : null;
  const opts = q?.options || ['', '', '', ''];

  const listId = 'rubrieken';
  const category = h('input', { type: 'text', list: listId, value: q?.category || '', placeholder: 'Bijv. Kerstfeitje', maxlength: '60' });
  const datalist = h('datalist', { id: listId }, categorySuggestions().map((c) => h('option', { value: c })));
  const text = h('textarea', { rows: '3', required: true, maxlength: '300', placeholder: 'De vraag zoals spelers hem zien' });
  text.value = q?.scare_only && !q.scare_text ? '' : q?.text || '';  // oude schrikvraag: tekst was "Kijk goed…"
  const scareText = h('input', { type: 'text', maxlength: '80', value: q?.scare_text || (q?.scare_only ? q.text : 'Kijk goed…') });
  // Bij een schrikvraag is de opgeslagen tijd: schrik + duur van de schrik + tijd om te antwoorden.
  const answerTime = q?.scare_only ? q.time_limit - (q.scare_after || 0) - SCARE_SECONDS : q?.time_limit;
  const time = h('input', { type: 'number', inputmode: 'numeric', min: '5', max: '600', step: '1', value: String(answerTime >= 5 && answerTime <= 120 ? answerTime : 20), class: 'input-short' });
  const rate = h('input', { type: 'checkbox', checked: Boolean(q?.rate_tree) });
  const fastest = h('input', { type: 'checkbox', checked: Boolean(q?.fastest_count) });
  const scare = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '600', step: '1', value: q?.scare_after ? String(q.scare_after) : (scareOnly ? '5' : ''), placeholder: 'geen', class: 'input-short' });

  let kind = q?.kind || 'meerkeuze';
  const kindButtons = KINDS.map((k) => h('button', {
    type: 'button', class: 'seg', 'aria-pressed': String(k.value === kind),
    onclick: () => { kind = k.value; updateKind(); },
  }, k.label));

  // meerkeuze
  const optionInputs = LETTERS.map((L, i) => h('input', { type: 'text', value: opts[i] || '', maxlength: '80', placeholder: `Optie ${L}` }));
  let correct = ans?.correct_option ?? null;
  const correctButtons = LETTERS.map((L, i) => h('button', {
    type: 'button', class: `correct-btn opt-${L.toLowerCase()}`, 'aria-label': `${L} is goed`,
    onclick: () => { correct = i; updateCorrect(); },
  }, h('span', { class: 'letter' }, L)));
  const updateCorrect = () => correctButtons.forEach((b, i) => {
    b.setAttribute('aria-pressed', String(i === correct));
    b.classList.toggle('is-correct', i === correct);
  });
  const mcBlock = h('fieldset', { class: 'b-fieldset' },
    h('legend', {}, 'Opties – tik op de letter van het goede antwoord'),
    LETTERS.map((L, i) => h('div', { class: 'mc-row' }, correctButtons[i], optionInputs[i])),
  );

  // open
  const openTexts = h('textarea', { rows: '4', placeholder: 'Eén goed antwoord per regel' });
  openTexts.value = (ans?.correct_texts || []).join('\n');
  const openBlock = h('fieldset', { class: 'b-fieldset' },
    h('legend', {}, 'Goede antwoorden'),
    openTexts,
    h('p', { class: 'hint' }, 'Eén per regel. Kleine tikfouten worden later automatisch goed gerekend.'),
  );

  // schatting
  const value = h('input', { type: 'text', inputmode: 'decimal', value: ans?.correct_value != null ? String(ans.correct_value).replace('.', ',') : '', placeholder: 'Bijv. 1843', class: 'input-short' });
  const unit = h('input', { type: 'text', value: q?.unit || '', maxlength: '20', placeholder: 'Bijv. jaar, kg', class: 'input-short' });
  const tiebreak = h('input', { type: 'checkbox', checked: Boolean(q?.tiebreak) });
  const estBlock = h('fieldset', { class: 'b-fieldset' },
    h('legend', {}, 'Juiste waarde'),
    h('div', { class: 'row' }, h('label', {}, 'Waarde', value), h('label', {}, 'Eenheid (optioneel)', unit)),
    h('label', { class: 'check' }, tiebreak, 'Schiftingsvraag'),
    h('p', { class: 'hint' }, 'Een schiftingsvraag komt niet in de gewone quiz. Hij wordt alleen gesteld bij een gelijke stand in de top 3, aan de spelers die gelijk staan. Zet er 2 à 3 klaar.'),
  );


  const updateKind = () => {
    kindButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(KINDS[i].value === kind)));
    mcBlock.hidden = kind !== 'meerkeuze';
    openBlock.hidden = kind !== 'open';
    estBlock.hidden = kind !== 'schatting';
  };

  const photo = photoPicker(q?.photo_path ? state.thumbs.get(q.photo_path) : null);
  const answerPhoto = photoPicker(ans?.answer_photo_path ? state.thumbs.get(ans.answer_photo_path) : null);
  const hideText = h('input', { type: 'checkbox', checked: Boolean(ans?.hide_answer_text) });
  const answerFx = h('select', { class: 'b-select' }, REVEAL_EFFECTS.map((r) => h('option', { value: r.value, selected: (ans?.answer_reveal_effect || '') === r.value }, r.label)));
  const scarePhoto = photoPicker(q?.scare_path ? state.thumbs.get(q.scare_path) : null);
  const video = videoPicker(q?.video_path ? state.thumbs.get(q.video_path) : null, '🎬 Filmpje bij de vraag (optioneel)');
  const answerVideo = videoPicker(ans?.answer_video_path ? state.thumbs.get(ans.answer_video_path) : null, '🎬 Filmpje bij het antwoord (optioneel)');
  const audioPick = videoPicker(q?.audio_path ? state.thumbs.get(q.audio_path) : null, '🔊 Geluidsfragment bij de vraag (mp3, m4a of een filmpje/schermopname, optioneel)', { audio: true });
  const audioReverse = h('input', { type: 'checkbox', checked: Boolean(q?.audio_reverse) });
  const music = spotifyField(q?.media_url || '');
  const answerMusic = spotifyField(ans?.answer_media_url || '', { label: 'Spotify-link bij het antwoord (optioneel)' });
  const answerSoundOnly = h('input', { type: 'checkbox', checked: Boolean(ans?.answer_media_hidden) });
  const mediaStart = timeInput(q?.media_start);
  const answerMediaStart = timeInput(ans?.answer_media_start);
  // Spotify speelt alleen op de tv. Standaard alleen geluid: de speler toont titel en artiest en zou het antwoord verraden.
  // Een oude "afgedekt"-vraag telt ook als alleen geluid.
  const currentMode = q?.media_url ? (q.media_mode || 'alleen_tv') : 'alleen_geluid';
  const soundOnly = h('input', { type: 'checkbox', checked: currentMode === 'alleen_geluid' || currentMode === 'verbergen' });
  const introSecs = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '30', step: '1', value: q?.media_seconds ? String(q.media_seconds) : '', placeholder: 'heel', class: 'input-short' });
  const revealFx = h('select', { class: 'b-select' }, REVEAL_EFFECTS.map((r) => h('option', { value: r.value, selected: (q?.reveal_effect || '') === r.value }, r.label)));
  const modeField = h('span', { class: 'hint' }, 'Het nummer speelt alleen op de tv. Zonder vinkje staat de Spotify-speler in beeld; die toont titel en artiest, dus vink "alleen geluid" aan als dat het antwoord verraadt.');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const saveBtn = h('button', { class: 'btn btn-green btn-lg', type: 'submit' }, 'Opslaan');

  const form = h('form', {
    class: 'stack',
    oninput: () => { err.textContent = ''; },
    onchange: () => { err.textContent = ''; },
    onclick: (e) => { if (e.target.closest('button[type=button]')) err.textContent = ''; },
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const row = {
        category: category.value.trim(),
        kind,
        text: text.value.trim(),
        time_limit: parseInt(time.value, 10),
        rate_tree: rate.checked,
        options: null,
        unit: null,
      };
      const link = music.value();
      if (link === false) return (err.textContent = 'Deze Spotify-link wordt niet herkend. Gebruik in Spotify: Delen → Link kopiëren.');
      // Alleen meesturen als er een link is of was (dan werkt het ook zonder 003_muziek.sql).
      if (link || q?.media_url) row.media_url = link;
      if (link) row.media_mode = soundOnly.checked ? 'alleen_geluid' : 'alleen_tv';
      // Intro raden en foto onthullen: alleen meesturen als ingesteld of eerder ingesteld (werkt dan ook zonder 015).
      const secs = introSecs.value.trim() ? parseInt(introSecs.value, 10) : null;
      if (secs != null && !(secs >= 1 && secs <= 30)) return (err.textContent = 'Intro raden: kies 1 tot 30 seconden (of laat het leeg).');
      if (link && (secs != null || q?.media_seconds)) row.media_seconds = secs;
      if (!link && q?.media_seconds) row.media_seconds = null;
      if (revealFx.value || q?.reveal_effect) row.reveal_effect = revealFx.value || null;
      const answerLink = answerMusic.value();
      if (answerLink === false) return (err.textContent = 'De Spotify-link bij het antwoord wordt niet herkend.');
      const answerRow = { correct_option: null, correct_texts: null, correct_value: null };
      if (answerSoundOnly.checked || ans?.answer_media_hidden) answerRow.answer_media_hidden = answerSoundOnly.checked;
      // Beginpunt van de nummers (alleen meesturen als ingesteld of eerder ingesteld; werkt dan ook zonder 022).
      const ms = parseTime(mediaStart.value);
      const ams = parseTime(answerMediaStart.value);
      if (ms === false || ams === false) return (err.textContent = 'Vul het beginpunt in als minuten:seconden, bijvoorbeeld 1:05.');
      if (ms || q?.media_start) row.media_start = ms || null;
      if (ams || ans?.answer_media_start) answerRow.answer_media_start = ams || null;
      // Alleen meesturen als ingesteld of eerder ingesteld (werkt dan ook zonder 017_antwoordfoto_onthullen.sql).
      if (answerFx.value || ans?.answer_reveal_effect) answerRow.answer_reveal_effect = answerFx.value || null;
      // Alleen meesturen als het aan staat of stond (dan werkt het ook zonder 013_antwoord_alleen_foto.sql).
      if (hideText.checked || ans?.hide_answer_text) answerRow.hide_answer_text = hideText.checked;

      if (!row.text) return (err.textContent = 'Vul de vraag in.');
      // Alleen meesturen als het aan staat of stond (werkt dan ook zonder 016_snelsten.sql).
      if (fastest.checked || q?.fastest_count) row.fastest_count = fastest.checked ? 3 : null;
      if (scareOnly) {
        // Eerst de tekst vóór de schrik, dan de schrik, daarna de echte vraag met de ingestelde tijd.
        const secs = parseInt(scare.value, 10);
        if (!(secs >= 1 && secs <= 300)) return (err.textContent = 'Vul in na hoeveel seconden de schrik komt.');
        if (!(row.time_limit >= 5 && row.time_limit <= 290)) return (err.textContent = 'De tijd om te antwoorden moet tussen 5 en 290 seconden liggen.');
        row.time_limit += secs + SCARE_SECONDS;
        row.scare_after = secs;
        row.scare_only = true;
        row.scare_text = scareText.value.trim() || 'Kijk goed…';
        row.rate_tree = false;
      }
      if (!(row.time_limit >= 5 && row.time_limit <= 600)) return (err.textContent = 'De tijd moet tussen 5 en 600 seconden liggen.');
      const scareVal = scareOnly ? row.scare_after : scare.value.trim() ? parseInt(scare.value, 10) : null;
      if (scareVal != null && !(scareVal >= 1 && scareVal < row.time_limit)) return (err.textContent = 'De schrik moet komen voordat de tijd om is (minimaal 1 seconde).');
      // Alleen meesturen als het is of was ingesteld (dan werkt het ook zonder 009_schrik.sql).
      if (scareVal != null || q?.scare_after) row.scare_after = scareVal;
      if (kind === 'meerkeuze') {
        row.options = optionInputs.map((i) => i.value.trim());
        if (row.options.some((o) => !o)) return (err.textContent = 'Vul alle vier de opties in.');
        if (correct == null) return (err.textContent = 'Tik op de letter van het goede antwoord.');
        answerRow.correct_option = correct;
      } else if (kind === 'open') {
        const lines = openTexts.value.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return (err.textContent = 'Vul minstens één goed antwoord in.');
        answerRow.correct_texts = lines;
      } else {
        const v = parseNumber(value.value);
        if (v == null) return (err.textContent = 'Vul een geldig getal in als juiste waarde.');
        answerRow.correct_value = v;
        row.unit = unit.value.trim() || null;
        if (tiebreak.checked || q?.tiebreak !== undefined) row.tiebreak = tiebreak.checked;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Bezig met opslaan…';
      try {
        // Alleen meesturen als er een link is of was (dan werkt het ook zonder 008_antwoordnummer.sql).
        if (answerLink || ans?.answer_media_url) answerRow.answer_media_url = answerLink;
        const sc = scarePhoto.get();
        const oldScare = q?.scare_path || null;
        const vd = video.get();
        const avd = answerVideo.get();
        const au = audioPick.get();
        const oldAudio = q?.audio_path || null;
        // Alleen meesturen als er geluid is of was (werkt dan ook zonder 018_geluid_achterstevoren.sql).
        if (au.file || oldAudio || audioReverse.checked) row.audio_reverse = audioReverse.checked;
        const oldVideo = q?.video_path || null;
        const oldAnswerVideo = ans?.answer_video_path || null;
        const uploaded = [];
        try {
          if (sc.blob) uploaded.push(row.scare_path = await uploadPhoto(sc.blob));
          else if (sc.removed && oldScare) row.scare_path = null;
          if (vd.file) { saveBtn.textContent = 'Filmpje uploaden…'; uploaded.push(row.video_path = await uploadVideo(vd.file)); }
          else if (vd.removed && oldVideo) row.video_path = null;
          if (avd.file) { saveBtn.textContent = 'Filmpje uploaden…'; uploaded.push(answerRow.answer_video_path = await uploadVideo(avd.file)); }
          else if (avd.removed && oldAnswerVideo) answerRow.answer_video_path = null;
          if (au.file) { saveBtn.textContent = 'Geluid uploaden…'; uploaded.push(row.audio_path = await uploadAudio(au.file)); }
          else if (au.removed && oldAudio) { row.audio_path = null; row.audio_reverse = false; }
          saveBtn.textContent = 'Bezig met opslaan…';
          await saveQuestion(q, row, answerRow, photo.get(), answerPhoto.get());
        } catch (ex2) {
          for (const p of uploaded) await removePhoto(p);
          throw ex2;
        }
        if (oldScare && 'scare_path' in row) await removePhoto(oldScare);
        if (oldVideo && 'video_path' in row) await removePhoto(oldVideo);
        if (oldAnswerVideo && 'answer_video_path' in answerRow) await removePhoto(oldAnswerVideo);
        if (oldAudio && 'audio_path' in row) await removePhoto(oldAudio);
        toast('Vraag opgeslagen');
        renderList();
      } catch (ex) {
        err.textContent = errorText(ex);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Opslaan';
      }
    },
  },
    // ---- 1. De vraag en het goede antwoord (altijd open)
    h('label', {}, 'Rubriek', category, datalist),
    scareOnly && h('label', {}, 'Tekst vóór de schrik', scareText,
      h('span', { class: 'hint' }, 'Op de tv en de telefoons staat eerst alleen deze tekst. Na het ingestelde aantal seconden komt het schrikbeeld met een gil, en daarna de echte vraag hieronder.')),
    h('div', { class: 'stack-tight' }, h('span', { class: 'field-label' }, 'Soort'), h('div', { class: 'segmented' }, kindButtons)),
    h('label', {}, scareOnly ? 'Vraag (verschijnt na de schrik)' : 'Vraag', text),
    mcBlock, openBlock, estBlock,
    h('label', {}, scareOnly ? 'Tijd om te antwoorden (na de schrik), in seconden' : 'Tijd in seconden', time),

    // ---- 2. Beeld bij de vraag
    formSection('📷 Foto of filmpje bij de vraag', Boolean(q?.photo_path || q?.video_path || q?.reveal_effect),
      h('div', { class: 'stack-tight' }, h('span', { class: 'field-label' }, 'Foto'), photo.el),
      h('label', {}, 'Foto onthullen', revealFx,
        h('span', { class: 'hint' }, 'De foto wordt tijdens de vraag langzaam zichtbaar op de tv (na ongeveer 85% van de tijd helemaal). Op de telefoons staat de foto dan niet.')),
      video.el,
      h('span', { class: 'hint' }, 'Een filmpje start vanzelf met geluid op de tv, op de plek van de foto (op de telefoons staat dan "Kijk naar het grote scherm"). Maximaal 50 MB.')),

    // ---- 3. Muziek en geluid bij de vraag
    formSection('🎵 Muziek of geluid bij de vraag', Boolean(q?.media_url || q?.audio_path),
      music.el,
      h('label', {}, '⏩ Begin bij (minuten:seconden)', mediaStart,
      h('span', { class: 'hint' }, 'Bijvoorbeeld 1:05 om meteen bij het refrein te beginnen. Leeg = vanaf het begin. Werkt alleen als je in Chrome bij Spotify bent ingelogd (anders speelt Spotify een eigen fragment).')),
    h('label', { class: 'check' }, soundOnly, 'Alleen geluid: geen speler in beeld bij de vraag'),
      modeField,
      h('label', {}, '🎧 Intro raden: speel maar … seconden', introSecs,
        h('span', { class: 'hint' }, 'Leeg = het hele fragment. Met een getal speelt de tv alleen het begin en stopt dan vanzelf; op de tv staat een knop "Nog een keer". Telefoons spelen het nummer dan niet.')),
      h('div', { class: 'stack-tight b-subblock' },
        audioPick.el,
        h('label', { class: 'check' }, audioReverse, '⏪ Achterstevoren afspelen bij de vraag (bij het antwoord gewoon vooruit)'),
        h('span', { class: 'hint' }, 'Eigen geluid, alleen op de tv. Is het een filmpje en staat "achterstevoren" aan, dan speelt bij het antwoord het hele filmpje met beeld.'))),

    // ---- 4. Wat er bij het antwoord te zien en te horen is
    formSection('✅ Bij het antwoord', Boolean(ans?.answer_photo_path || ans?.answer_video_path || ans?.answer_media_url || ans?.hide_answer_text || ans?.answer_reveal_effect),
      h('div', { class: 'stack-tight' },
        h('span', { class: 'field-label' }, 'Foto bij het antwoord'),
        h('span', { class: 'hint' }, 'De tv toont deze foto in de antwoordenronde in plaats van de vraagfoto. Spelers zien hem pas dan.'),
        answerPhoto.el),
      h('label', { class: 'check' }, hideText, 'Alleen de foto of het filmpje tonen, zonder antwoordtekst'),
      h('label', {}, 'Antwoordfoto onthullen', answerFx,
        h('span', { class: 'hint' }, 'De antwoordfoto wordt in 8 seconden langzaam zichtbaar zodra het antwoord op de tv komt.')),
      answerVideo.el,
      h('div', { class: 'stack-tight b-subblock' },
        answerMusic.el,
        h('span', { class: 'hint' }, 'Dit nummer speelt in de antwoordenronde, bijvoorbeeld het nummer van het antwoord.'),
        h('label', {}, '⏩ Begin bij (minuten:seconden)', answerMediaStart),
        h('label', { class: 'check' }, answerSoundOnly, 'Alleen geluid: geen speler in beeld bij het antwoord'))),

    // ---- 5. Extra's
    formSection('✨ Extra: snelsten, schrik, kerstboom', Boolean(q?.fastest_count || (q?.scare_after && !scareOnly) || q?.rate_tree) || scareOnly,
      h('label', { class: 'check' }, fastest, '⚡ Alleen de 3 snelste goede antwoorden krijgen een punt'),
      h('span', { class: 'hint' }, 'Voor meerkeuze en open vragen, bijvoorbeeld bij puzzelstukjes. Telt het moment van het laatst ingestuurde antwoord.'),
      h('fieldset', { class: 'b-fieldset' },
        h('legend', {}, scareOnly ? '👻 Schrik' : '👻 Schrikeffect'),
        h('label', {}, 'Na … seconden', scare),
        h('span', { class: 'hint' }, scareOnly
          ? 'Na zoveel seconden (vanaf het begin van de vraag) verschijnt op de tv en op de telefoons plotseling het schrikbeeld met een gil.'
          : 'Na zoveel seconden verschijnt op de tv en op de telefoons plotseling het schrikbeeld met een gil. Leeg = geen schrik.'),
        h('span', { class: 'field-label' }, 'Schrikbeeld (foto of bewegende GIF)'),
        h('span', { class: 'hint' }, 'Zonder schrikbeeld komt er een getekende geest.'),
        scarePhoto.el),
      !scareOnly && h('label', { class: 'check' }, rate, 'Spelers geven deze boom een cijfer')),
    err,
    h('div', { class: 'row' },
      saveBtn,
      h('button', { type: 'button', class: 'btn btn-light btn-lg', onclick: renderList }, 'Annuleren'),
    ),
  );

  updateKind();
  updateCorrect();

  mount(h('div', { class: 'beheer-page' },
    h('header', { class: 'b-header' },
      h('button', { class: 'link', onclick: renderList }, '← Terug naar de vragen'),
      !isNew && h('a', { class: 'link', href: `#tv?voorbeeld=${q.id}` }, '👁 Voorbeeld (opgeslagen versie)'),
    ),
    h('h1', { class: 'serif' }, scareOnly ? (isNew ? 'Schrikvraag toevoegen' : 'Schrikvraag bewerken') : isNew ? 'Nieuwe vraag' : 'Vraag bewerken'),
    h('div', { class: 'b-card' }, form),
  ));
}

/** Inklapbaar blok in het bewerkformulier; staat open als er al iets in is ingesteld. */
function formSection(title, open, ...children) {
  return h('details', { class: 'b-section-fold', open: open || undefined },
    h('summary', {}, title),
    h('div', { class: 'stack' }, children));
}

/** Vraag + juiste antwoord opslaan, inclusief foto-upload. */
async function saveQuestion(existing, row, answerRow, photoChoice, answerPhotoChoice = null) {
  let newPath = null;
  // Foto bij het antwoord (optioneel; staat bij de juiste antwoorden, alleen voor de beheerder)
  const oldAnswerPath = existing ? state.answers.get(existing.id)?.answer_photo_path || null : null;
  let newAnswerPath = null;
  if (answerPhotoChoice?.blob) {
    newAnswerPath = await uploadPhoto(answerPhotoChoice.blob);
    answerRow.answer_photo_path = newAnswerPath;
  } else if (answerPhotoChoice?.removed && oldAnswerPath) {
    answerRow.answer_photo_path = null;
  }
  const oldPath = existing?.photo_path || null;
  if (photoChoice.blob) newPath = await uploadPhoto(photoChoice.blob);

  if (newPath) row.photo_path = newPath;
  else if (photoChoice.removed) row.photo_path = null;

  let saved;
  if (existing) {
    const { data, error } = await sb.from('questions').update(row).eq('id', existing.id).select().single();
    if (error) { if (newPath) await removePhoto(newPath); throw error; }
    saved = data;
  } else {
    row.position = Math.max(0, ...state.questions.map((x) => x.position)) + 1;
    const { data, error } = await sb.from('questions').insert(row).select().single();
    if (error) { if (newPath) await removePhoto(newPath); throw error; }
    saved = data;
  }

  const { error: aErr } = await sb.from('question_answers')
    .upsert({ question_id: saved.id, ...answerRow }, { onConflict: 'question_id' });
  if (aErr) { if (newAnswerPath) await removePhoto(newAnswerPath); throw aErr; }

  // oude foto's opruimen als die zijn vervangen of verwijderd
  if (oldPath && (newPath || photoChoice.removed)) await removePhoto(oldPath);
  if (oldAnswerPath && 'answer_photo_path' in answerRow) await removePhoto(oldAnswerPath);

  const idx = state.questions.findIndex((x) => x.id === saved.id);
  if (idx >= 0) state.questions[idx] = saved; else state.questions.push(saved);
  state.answers.set(saved.id, { ...(state.answers.get(saved.id) || {}), question_id: saved.id, ...answerRow });
  await loadThumbs();
  return saved;
}

// ---------------------------------------------------------------- snel een kerstboom (iPhone)

function renderTreeForm() {
  setScreen('boom');
  const listId = 'boomnamen';
  const names = h('datalist', { id: listId }, treeNameSuggestions().map((n) => h('option', { value: n })));
  const owner = h('input', { type: 'text', list: listId, maxlength: '80', autocapitalize: 'words', placeholder: 'Naam van de eigenaar' });
  const others = [1, 2, 3].map((n) => h('input', { type: 'text', list: listId, maxlength: '80', autocapitalize: 'words', placeholder: `Andere naam ${n}` }));
  const rate = h('input', { type: 'checkbox', checked: true });
  const photo = photoPicker(null, { big: true });
  const answerPhoto = photoPicker(null);
  const err = h('p', { class: 'form-error', role: 'alert' });
  const count = h('span', { class: 'tree-count' }, treeCountText());
  const saveBtn = h('button', { class: 'btn btn-green btn-lg btn-block', type: 'submit' }, 'Opslaan en volgende boom');

  const form = h('form', {
    class: 'stack',
    oninput: () => { err.textContent = ''; },
    onchange: () => { err.textContent = ''; },
    onclick: (e) => { if (e.target.closest('button[type=button]')) err.textContent = ''; },
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const ownerName = owner.value.trim();
      const otherNames = others.map((i) => i.value.trim());
      const { blob } = photo.get();
      if (!blob) return (err.textContent = 'Kies eerst een foto.');
      if (!ownerName) return (err.textContent = 'Vul in van wie de boom is.');
      if (otherNames.some((n) => !n)) return (err.textContent = 'Vul drie andere namen in.');
      const all = [ownerName, ...otherNames];
      if (new Set(all.map((n) => n.toLowerCase())).size < 4) return (err.textContent = 'Gebruik vier verschillende namen.');

      // De eigenaar op een willekeurige plek (A–D) zetten.
      const options = shuffle(all);
      const correct = options.indexOf(ownerName);

      saveBtn.disabled = true;
      saveBtn.textContent = 'Bezig met opslaan…';
      try {
        await saveQuestion(null, {
          category: TREE_CATEGORY, kind: 'meerkeuze', text: TREE_CATEGORY,
          time_limit: 20, rate_tree: rate.checked, options, unit: null,
        }, { correct_option: correct, correct_texts: null, correct_value: null }, { blob, removed: false }, answerPhoto.get());
        toast(`Boom van ${ownerName} opgeslagen`);
        // formulier leegmaken voor de volgende boom (cijfer-vinkje blijft staan)
        owner.value = '';
        others.forEach((i) => { i.value = ''; });
        photo.reset();
        answerPhoto.reset();
        count.textContent = treeCountText();
        names.replaceChildren(...treeNameSuggestions().map((n) => h('option', { value: n })));
        window.scrollTo(0, 0);
      } catch (ex) {
        err.textContent = errorText(ex);
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Opslaan en volgende boom';
    },
  },
    photo.el,
    h('label', {}, 'Van wie is deze boom?', owner, h('span', { class: 'hint' }, 'Dit is het goede antwoord.')),
    h('fieldset', { class: 'b-fieldset' },
      h('legend', {}, 'Drie andere namen'),
      others,
    ),
    names,
    h('div', { class: 'stack-tight' },
      h('span', { class: 'field-label' }, 'Foto bij het antwoord (optioneel)'),
      h('span', { class: 'hint' }, 'Bijvoorbeeld de eigenaar bij de boom. De tv toont hem pas in de antwoordenronde.'),
      answerPhoto.el),
    h('label', { class: 'check' }, rate, 'Spelers geven deze boom een cijfer'),
    err,
    saveBtn,
  );

  mount(h('div', { class: 'beheer-page tree-page' },
    h('header', { class: 'b-header' },
      h('button', { class: 'link', onclick: renderList }, '← Beheer'),
      count,
    ),
    h('h1', { class: 'serif' }, 'Kerstboom toevoegen'),
    form,
  ));
}

// ---------------------------------------------------------------- Spotify

/**
 * Invoerveld voor een Spotify-link met voorbeeldspeler.
 * value() → nette link, null (leeg) of false (niet herkend).
 */
function spotifyField(initial, { label = 'Spotify-link (optioneel)', required = false } = {}) {
  const input = h('input', {
    type: 'url', inputmode: 'url', value: initial, autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
    placeholder: 'https://open.spotify.com/track/…',
  });
  const preview = h('div', { class: 'spotify-preview' });
  const hint = h('span', { class: 'hint' }, 'In Spotify: Delen → Link kopiëren, en hier plakken. Het nummer klinkt op de tv en op de telefoons.');
  const show = () => {
    const v = input.value.trim();
    const player = v ? spotifyPlayer(v) : null;
    preview.replaceChildren(...(player ? [player] : v ? [h('p', { class: 'form-error' }, 'Deze link wordt niet herkend.')] : []));
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(show, 400); });
  show();
  return {
    el: h('div', { class: 'stack-tight' }, h('label', {}, label, input, hint), preview),
    value: () => {
      const v = input.value.trim();
      if (!v) return required ? false : null;
      return parseSpotify(v) ? cleanSpotifyLink(v) : false;
    },
    reset: () => { input.value = ''; show(); },
    input,
  };
}

// ---------------------------------------------------------------- snel een nummer toevoegen

let musicVariant = 'ingestuurd';

/**
 * Snel een muziekvraag toevoegen. Drie soorten:
 *  - ingestuurd: "Wie heeft dit nummer ingestuurd?" – meerkeuze met namen, speler zichtbaar
 *  - artiest:    "Van wie is dit nummer?" – open (artiest typen), speler afgedekt
 *  - zin:        "Maak de zin af" – meerkeuze met vervolgen, speler alleen op de tv
 */
function renderMusicForm() {
  setScreen('nummer');
  const listId = 'nummernamen';
  const names = h('datalist', { id: listId }, treeNameSuggestions().map((n) => h('option', { value: n })));
  const music = spotifyField('', { label: 'Spotify-link van het nummer', required: true });
  const time = h('input', { type: 'number', inputmode: 'numeric', min: '5', max: '600', value: '30', class: 'input-short' });
  const soundOnlyMusic = h('input', { type: 'checkbox' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const count = h('span', { class: 'tree-count' }, musicCountText());
  const saveBtn = h('button', { class: 'btn btn-green btn-lg btn-block', type: 'submit' }, 'Opslaan en volgend nummer');
  const txt = (placeholder, extra = {}) => h('input', { type: 'text', maxlength: '80', placeholder, ...extra });

  // ingestuurd
  const owner = txt('Naam van wie het instuurde', { list: listId, autocapitalize: 'words' });
  const others = [1, 2, 3].map((n) => txt(`Andere naam ${n}`, { list: listId, autocapitalize: 'words' }));
  const blockSubmit = h('div', { class: 'stack' },
    h('label', {}, 'Wie heeft dit nummer ingestuurd?', owner, h('span', { class: 'hint' }, 'Dit is het goede antwoord.')),
    h('fieldset', { class: 'b-fieldset' }, h('legend', {}, 'Drie andere namen'), others),
  );
  // artiest
  const artist = txt('Bijv. Wham!');
  const artistAlt = h('textarea', { rows: '2', placeholder: 'Bijv. George Michael' });
  const blockArtist = h('div', { class: 'stack' },
    h('label', {}, 'Juiste artiest', artist),
    h('label', {}, 'Ook goed (optioneel, één per regel)', artistAlt),
    h('p', { class: 'hint' }, 'Spelers typen de artiest; kleine tikfouten zijn goed. De speler is tijdens de vraag afgedekt, zodat de artiest niet in beeld staat.'),
  );
  // zin
  const begin = h('input', { type: 'text', maxlength: '200', placeholder: 'Bijv. Last Christmas, I gave you my' });
  const good = txt('Bijv. heart');
  const wrong = [1, 2, 3].map((n) => txt(`Fout vervolg ${n}`));
  const blockLyric = h('div', { class: 'stack' },
    h('label', {}, 'Begin van de zin (staat op de tv)', begin),
    h('label', {}, 'Goed vervolg', good),
    h('fieldset', { class: 'b-fieldset' }, h('legend', {}, 'Drie foute vervolgen'), wrong),
    h('p', { class: 'hint' }, 'De speler staat alleen op de tv. Zet het nummer op pauze vóór het antwoord klinkt.'),
  );

  const variants = [
    { value: 'ingestuurd', label: 'Wie stuurde het in?', block: blockSubmit },
    { value: 'artiest', label: 'Van wie is dit nummer?', block: blockArtist },
    { value: 'zin', label: 'Maak de zin af', block: blockLyric },
  ];
  const segButtons = variants.map((v) => h('button', {
    type: 'button', class: 'seg', onclick: () => { musicVariant = v.value; updateVariant(); },
  }, v.label));
  const updateVariant = () => variants.forEach((v, i) => {
    segButtons[i].setAttribute('aria-pressed', String(v.value === musicVariant));
    v.block.hidden = v.value !== musicVariant;
  });

  const differentFour = (list) => new Set(list.map((n) => n.toLowerCase())).size === 4;

  const form = h('form', {
    class: 'stack',
    oninput: () => { err.textContent = ''; },
    onsubmit: async (e) => {
      e.preventDefault();
      const link = music.value();
      if (!link) return (err.textContent = 'Plak een Spotify-link (Delen → Link kopiëren).');
      const seconds = parseInt(time.value, 10);
      if (!(seconds >= 5 && seconds <= 600)) return (err.textContent = 'De tijd moet tussen 5 en 600 seconden liggen.');
      const cfg = MUSIC[musicVariant];
      const row = { category: cfg.category, time_limit: seconds, rate_tree: false, unit: null, media_url: link, media_mode: soundOnlyMusic.checked ? 'alleen_geluid' : cfg.mode };
      let answerRow;
      let label;

      if (musicVariant === 'ingestuurd') {
        const all = [owner.value.trim(), ...others.map((i) => i.value.trim())];
        if (!all[0]) return (err.textContent = 'Vul in wie dit nummer instuurde.');
        if (all.some((n) => !n)) return (err.textContent = 'Vul drie andere namen in.');
        if (!differentFour(all)) return (err.textContent = 'Gebruik vier verschillende namen.');
        const options = shuffle(all);
        Object.assign(row, { kind: 'meerkeuze', text: cfg.category, options });
        answerRow = { correct_option: options.indexOf(all[0]), correct_texts: null, correct_value: null };
        label = `Nummer van ${all[0]}`;
      } else if (musicVariant === 'artiest') {
        const texts = [artist.value.trim(), ...artistAlt.value.split('\n').map((l) => l.trim())].filter(Boolean);
        if (!artist.value.trim()) return (err.textContent = 'Vul de juiste artiest in.');
        Object.assign(row, { kind: 'open', text: cfg.category, options: null });
        answerRow = { correct_option: null, correct_texts: texts, correct_value: null };
        label = `Nummer van ${texts[0]}`;
      } else {
        const start = begin.value.trim().replace(/[.…\s]+$/, '');
        const all = [good.value.trim(), ...wrong.map((i) => i.value.trim())];
        if (!start) return (err.textContent = 'Vul het begin van de zin in.');
        if (!all[0]) return (err.textContent = 'Vul het goede vervolg in.');
        if (all.some((n) => !n)) return (err.textContent = 'Vul drie foute vervolgen in.');
        if (!differentFour(all)) return (err.textContent = 'Gebruik vier verschillende vervolgen.');
        const options = shuffle(all);
        Object.assign(row, { kind: 'meerkeuze', text: `“${start} …”`, options });
        answerRow = { correct_option: options.indexOf(all[0]), correct_texts: null, correct_value: null };
        label = 'Zin';
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Bezig met opslaan…';
      try {
        await saveQuestion(null, row, answerRow, { blob: null, removed: false });
        toast(`${label} opgeslagen`);
        music.reset();
        for (const el of [owner, ...others, artist, artistAlt, begin, good, ...wrong]) el.value = '';
        count.textContent = musicCountText();
        names.replaceChildren(...treeNameSuggestions().map((n) => h('option', { value: n })));
        window.scrollTo(0, 0);
      } catch (ex) {
        err.textContent = errorText(ex);
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Opslaan en volgend nummer';
    },
  },
    h('div', { class: 'stack-tight' }, h('span', { class: 'field-label' }, 'Soort vraag'), h('div', { class: 'segmented segmented-wrap' }, segButtons)),
    music.el,
    h('label', { class: 'check' }, soundOnlyMusic, 'Alleen geluid: geen speler in beeld bij de vraag'),
    blockSubmit, blockArtist, blockLyric,
    names,
    h('label', {}, 'Tijd in seconden', time, h('span', { class: 'hint' }, 'Tijd om te luisteren en te antwoorden.')),
    err,
    saveBtn,
  );
  updateVariant();

  mount(h('div', { class: 'beheer-page tree-page' },
    h('header', { class: 'b-header' },
      h('button', { class: 'link', onclick: renderList }, '← Beheer'),
      count,
    ),
    h('h1', { class: 'serif' }, 'Nummer toevoegen'),
    form,
  ));
}

function musicCountText() {
  const n = musicCount();
  return `${n} ${n === 1 ? 'nummer' : 'nummers'}`;
}

function treeCountText() {
  const n = treeCount();
  return `${n} ${n === 1 ? 'boom' : 'bomen'}`;
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
