// Beheer (#beheer): vragen beheren, foto's uploaden, kerstbomen toevoegen,
// spelinstellingen en een spel starten. Licht thema; werkt op iPad en iPhone.
import { sb, h, mount, toast, LETTERS, errorText, loginForm } from './common.js';
import { parseNumber, formatNumber } from './scoring.js';

const TREE_CATEGORY = 'Van wie is deze kerstboom?';
const DEFAULT_CATEGORIES = [TREE_CATEGORY, 'In welke stad staat deze kerstboom?', 'Kerstfeitje'];
const KINDS = [
  { value: 'meerkeuze', label: 'Meerkeuze' },
  { value: 'open', label: 'Open' },
  { value: 'schatting', label: 'Schatting' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));
const PHOTO_MAX = 1600;
const PHOTO_QUALITY = 0.8;

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
    h('h1', { class: 'serif' }, 'Kerstquiz beheer'),
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
  const paths = state.questions.map((q) => q.photo_path).filter((p) => p && !state.thumbs.has(p));
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
    .filter((q) => q.category === TREE_CATEGORY && Array.isArray(q.options))
    .flatMap((q) => q.options);
  return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl'));
}

const treeCount = () => state.questions.filter((q) => q.category === TREE_CATEGORY).length;

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
  const path = `vragen/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
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
    status.textContent = 'Foto verkleinen…';
    try {
      blob = await resizePhoto(file);
      removed = false;
      show(URL.createObjectURL(blob));
      status.textContent = `Klaar (${Math.round(blob.size / 1024)} kB)`;
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
      h('button', { class: 'btn btn-light btn-lg', onclick: renderTreeForm }, '🎄 Snel een kerstboom toevoegen'),
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
    h('h1', { class: 'serif' }, 'Kerstquiz beheer'),
    h('div', { class: 'row' },
      h('a', { class: 'link', href: '#tv' }, 'Tv-scherm'),
      h('button', { class: 'link', onclick: logout }, 'Uitloggen'),
    ),
  );
}

function questionItem(q, i) {
  const thumb = q.photo_path ? state.thumbs.get(q.photo_path) : null;
  const ans = state.answers.get(q.id);
  return h('li', { class: 'q-item b-card' },
    h('div', { class: 'q-num' }, i + 1),
    thumb ? h('img', { class: 'q-thumb', src: thumb, alt: '' }) : h('div', { class: 'q-thumb q-thumb-empty', 'aria-hidden': 'true' }),
    h('div', { class: 'q-info' },
      h('div', { class: 'q-tags' },
        q.category && h('span', { class: 'b-label' }, q.category),
        h('span', { class: 'b-kind' }, KIND_LABEL[q.kind] || q.kind),
        h('span', { class: 'muted' }, `${q.time_limit} s`),
        q.rate_tree && h('span', { class: 'muted' }, '★ cijfer'),
      ),
      h('div', { class: 'q-title' }, q.text),
      h('div', { class: 'muted q-answer' }, answerSummary(q, ans)),
    ),
    h('div', { class: 'q-buttons' },
      h('button', { class: 'icon-btn', 'aria-label': 'Omhoog', title: 'Omhoog', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'icon-btn', 'aria-label': 'Omlaag', title: 'Omlaag', disabled: i === state.questions.length - 1, onclick: () => move(i, 1) }, '↓'),
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


async function move(i, dir) {
  const list = [...state.questions];
  const j = i + dir;
  [list[i], list[j]] = [list[j], list[i]];
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
  return h('section', { class: 'b-section' },
    h('h2', { class: 'serif' }, 'Spelinstellingen'),
    state.settingsMissing
      ? h('p', { class: 'b-card b-warning' }, 'Voer eerst supabase/002_beheer.sql uit in Supabase om de spelinstellingen te kunnen opslaan.')
      : h('form', {
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
  );
}

// ---------------------------------------------------------------- spel starten

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

function renderEdit(q) {
  setScreen(null);
  const isNew = !q;
  const ans = q ? state.answers.get(q.id) : null;
  const opts = q?.options || ['', '', '', ''];

  const listId = 'rubrieken';
  const category = h('input', { type: 'text', list: listId, value: q?.category || '', placeholder: 'Bijv. Kerstfeitje', maxlength: '60' });
  const datalist = h('datalist', { id: listId }, categorySuggestions().map((c) => h('option', { value: c })));
  const text = h('textarea', { rows: '3', required: true, maxlength: '300', placeholder: 'De vraag zoals spelers hem zien' });
  text.value = q?.text || '';
  const time = h('input', { type: 'number', inputmode: 'numeric', min: '5', max: '600', step: '1', value: String(q?.time_limit ?? 20), class: 'input-short' });
  const rate = h('input', { type: 'checkbox', checked: Boolean(q?.rate_tree) });

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
  const estBlock = h('fieldset', { class: 'b-fieldset' },
    h('legend', {}, 'Juiste waarde'),
    h('div', { class: 'row' }, h('label', {}, 'Waarde', value), h('label', {}, 'Eenheid (optioneel)', unit)),
  );


  const updateKind = () => {
    kindButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(KINDS[i].value === kind)));
    mcBlock.hidden = kind !== 'meerkeuze';
    openBlock.hidden = kind !== 'open';
    estBlock.hidden = kind !== 'schatting';
  };

  const photo = photoPicker(q?.photo_path ? state.thumbs.get(q.photo_path) : null);
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
      const answerRow = { correct_option: null, correct_texts: null, correct_value: null };

      if (!row.text) return (err.textContent = 'Vul de vraag in.');
      if (!(row.time_limit >= 5 && row.time_limit <= 600)) return (err.textContent = 'De tijd moet tussen 5 en 600 seconden liggen.');
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
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Bezig met opslaan…';
      try {
        await saveQuestion(q, row, answerRow, photo.get());
        toast('Vraag opgeslagen');
        renderList();
      } catch (ex) {
        err.textContent = errorText(ex);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Opslaan';
      }
    },
  },
    h('label', {}, 'Rubriek', category, datalist),
    h('div', { class: 'stack-tight' }, h('span', { class: 'field-label' }, 'Soort'), h('div', { class: 'segmented' }, kindButtons)),
    h('label', {}, 'Vraag', text),
    h('div', { class: 'stack-tight' }, h('span', { class: 'field-label' }, 'Foto (optioneel)'), photo.el),
    mcBlock, openBlock, estBlock,
    h('label', {}, 'Tijd in seconden', time),
    h('label', { class: 'check' }, rate, 'Spelers geven deze boom een cijfer'),
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
    ),
    h('h1', { class: 'serif' }, isNew ? 'Nieuwe vraag' : 'Vraag bewerken'),
    h('div', { class: 'b-card' }, form),
  ));
}

/** Vraag + juiste antwoord opslaan, inclusief foto-upload. */
async function saveQuestion(existing, row, answerRow, photoChoice) {
  let newPath = null;
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
  if (aErr) throw aErr;

  // oude foto opruimen als die is vervangen of verwijderd
  if (oldPath && (newPath || photoChoice.removed)) await removePhoto(oldPath);

  const idx = state.questions.findIndex((x) => x.id === saved.id);
  if (idx >= 0) state.questions[idx] = saved; else state.questions.push(saved);
  state.answers.set(saved.id, { question_id: saved.id, ...answerRow });
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
        }, { correct_option: correct, correct_texts: null, correct_value: null }, { blob, removed: false });
        toast(`Boom van ${ownerName} opgeslagen`);
        // formulier leegmaken voor de volgende boom (cijfer-vinkje blijft staan)
        owner.value = '';
        others.forEach((i) => { i.value = ''; });
        photo.reset();
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
