// Puntentelling volgens SPEC hoofdstuk 5. Geen afhankelijkheden, zodat
// dit bestand ook los te testen is: node tests/scoring.test.mjs

// ---------------------------------------------------------------- open vragen

/** Kleine letters, accenten weg, leestekens en koppeltekens weg, spaties samenvoegen en bijsnijden. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accenten
    .replace(/[^\p{L}\p{N}\s]/gu, '')                    // leestekens en koppeltekens
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein-afstand (aantal tikfouten). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Toegestane afstand: ≤ 1 bij goede antwoorden tot en met 5 tekens, ≤ 2 bij langere. */
const allowedDistance = (correctNorm) => (correctNorm.length <= 5 ? 1 : 2);

/**
 * Automatisch oordeel voor één genormaliseerd antwoord.
 * @returns {{ correct: boolean, reason: 'exact'|'schrijfwijze'|'tikfout'|'fout', distance: number }}
 *   reason 'exact' of 'schrijfwijze' wordt per groep bepaald (zie judgeOpen).
 */
export function autoJudge(norm, correctTexts) {
  if (!norm) return { correct: false, reason: 'fout', distance: Infinity };
  let best = Infinity;
  for (const c of correctTexts || []) {
    const cn = normalize(c);
    if (!cn) continue;
    if (cn === norm) return { correct: true, reason: 'exact', distance: 0 };
    const d = levenshtein(norm, cn);
    if (d <= allowedDistance(cn) && d < best) best = d;
  }
  return best < Infinity
    ? { correct: true, reason: 'tikfout', distance: best }
    : { correct: false, reason: 'fout', distance: Infinity };
}

/**
 * Groepeer de antwoorden op een open vraag per genormaliseerde tekst.
 * @param answers   [{ player_id, text_answer }]
 * @param correctTexts  goede antwoorden (zoals Rutger ze invulde)
 * @param overrides Map normalized → boolean (handmatig omgezet)
 * @returns groepen, meeste spelers eerst:
 *   { normalized, display, count, playerIds, auto, correct, overridden, reasonText }
 */
export function judgeOpen(answers, correctTexts, overrides = new Map()) {
  const exactSet = new Set((correctTexts || []).map((c) => c.trim().toLowerCase()));
  const groups = new Map();
  for (const a of answers) {
    const raw = String(a.text_answer ?? '').trim();
    if (!raw) continue;
    const norm = normalize(raw);
    if (!norm) continue;
    let g = groups.get(norm);
    if (!g) { g = { normalized: norm, variants: new Map(), playerIds: [] }; groups.set(norm, g); }
    g.playerIds.push(a.player_id);
    g.variants.set(raw, (g.variants.get(raw) || 0) + 1);
  }

  return [...groups.values()].map((g) => {
    const display = [...g.variants.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const auto = autoJudge(g.normalized, correctTexts);
    let reason = auto.reason;
    if (reason === 'exact') {
      // Exact als iedereen in de groep het precies zo schreef (hoofdletters tellen niet).
      const allExact = [...g.variants.keys()].every((v) => exactSet.has(v.toLowerCase()));
      reason = allExact ? 'exact' : 'schrijfwijze';
    }
    const overridden = overrides.has(g.normalized) && overrides.get(g.normalized) !== auto.correct;
    const correct = overrides.has(g.normalized) ? overrides.get(g.normalized) : auto.correct;
    return {
      normalized: g.normalized,
      display,
      count: g.playerIds.length,
      playerIds: g.playerIds,
      auto: auto.correct,
      correct,
      overridden,
      reasonText: overridden ? (correct ? 'handmatig goed' : 'handmatig fout') : reasonLabel(reason, auto.distance),
    };
  }).sort((a, b) => b.count - a.count || a.display.localeCompare(b.display, 'nl'));
}

function reasonLabel(reason, distance) {
  if (reason === 'tikfout') return distance === 1 ? '1 tikfout' : `${distance} tikfouten`;
  return reason; // 'exact', 'schrijfwijze', 'fout'
}

// ---------------------------------------------------------------- schatting

/**
 * Puntwinnaars bij een schatting: iedereen die het precies goed heeft. Zijn dat
 * er minder dan 3, dan ook de dichtstbijzijnden tot er 3 zijn; bij gelijke
 * afstand op de laatste plek krijgen ze allemaal een punt.
 * @param answers [{ player_id, number_answer }]
 * @returns Set van player_id's
 */
export function estimateWinners(answers, correctValue) {
  const target = Number(correctValue);
  const list = answers
    .filter((a) => a.number_answer != null && Number.isFinite(Number(a.number_answer)))
    .map((a) => ({ id: a.player_id, d: Math.abs(Number(a.number_answer) - target) }))
    .sort((a, b) => a.d - b.d);
  if (!list.length || !Number.isFinite(target)) return new Set();
  const threshold = list[Math.min(3, list.length) - 1].d;
  return new Set(list.filter((x) => x.d <= threshold).map((x) => x.id));
}

// ---------------------------------------------------------------- meerkeuze

export function choiceWinners(answers, correctOption) {
  return new Set(answers.filter((a) => a.choice != null && a.choice === correctOption).map((a) => a.player_id));
}

// ---------------------------------------------------------------- per vraag en totaal

/**
 * Wie heeft deze vraag goed?
 * @param question  rij uit questions
 * @param key       rij uit question_answers (of undefined)
 * @param answers   antwoorden op deze vraag
 * @param overrides Map normalized → boolean voor deze vraag
 * @returns Set van player_id's met 1 punt
 */
export function winnersFor(question, key, answers, overrides) {
  return fastestWinners(question, baseWinners(question, key, answers, overrides), answers);
}

/**
 * "De snelsten": bij een vraag met fastest_count krijgen alleen de N snelste goede
 * antwoorden een punt (op tijdstip van het laatst ingestuurde antwoord). Bij precies
 * dezelfde tijd krijgen ze het allebei. Bij een schatting telt dit niet.
 */
export function fastestWinners(question, winners, answers) {
  const n = question?.fastest_count;
  if (!n || question.kind === 'schatting' || winners.size <= n) return winners;
  const times = answers.filter((a) => winners.has(a.player_id))
    .map((a) => ({ id: a.player_id, t: new Date(a.answered_at || 0).getTime() }))
    .sort((a, b) => a.t - b.t);
  const cutoff = times[n - 1]?.t;
  return new Set(times.filter((x) => x.t <= cutoff).map((x) => x.id));
}

function baseWinners(question, key, answers, overrides) {
  if (!key) return new Set();
  if (question.kind === 'meerkeuze') return choiceWinners(answers, key.correct_option);
  if (question.kind === 'open') {
    const ids = new Set();
    for (const g of judgeOpen(answers, key.correct_texts, overrides)) if (g.correct) g.playerIds.forEach((id) => ids.add(id));
    return ids;
  }
  if (question.kind === 'schatting') return estimateWinners(answers, key.correct_value);
  return new Set();
}

/**
 * Totaalscore en plaats per speler. Spelers met evenveel punten delen de plaats.
 * @returns [{ player_id, name, points, place }] hoogste eerst
 */
export function scoreboard(players, questions, keys, answers, overrides) {
  const points = new Map(players.map((p) => [p.id, 0]));
  for (const q of questions) {
    const qa = answers.filter((a) => a.question_id === q.id);
    const ov = new Map(overrides.filter((o) => o.question_id === q.id).map((o) => [o.normalized, o.correct]));
    for (const id of winnersFor(q, keys.get(q.id), qa, ov)) if (points.has(id)) points.set(id, points.get(id) + 1);
  }
  const rows = players.map((p) => ({ player_id: p.id, name: p.name, points: points.get(p.id) }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'nl'));
  rows.forEach((r, i) => { r.place = i > 0 && r.points === rows[i - 1].points ? rows[i - 1].place : i + 1; });
  return rows;
}

/** Getal uit invoer van een telefoon: "1.818,5", "1818,5", "1 818" → 1818.5 */
export function parseNumber(input) {
  let s = String(input ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');      // Nederlandse notatie
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // 1.818 → duizendtal
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Getal netjes tonen: komma als decimaalteken, duizendtal-punten pas vanaf 10.000 (dus "1818", niet "1.818"). */
export function formatNumber(n) {
  const v = Number(n);
  return v.toLocaleString('nl-NL', { maximumFractionDigits: 4, useGrouping: Math.abs(v) >= 10000 });
}

// ---------------------------------------------------------------- mooiste kerstboom

/** Naam van de eigenaar = het goede antwoord van de vraag. */
export function ownerOf(question, key) {
  if (!key) return '';
  if (question.kind === 'meerkeuze') return (question.options || [])[key.correct_option] ?? '';
  if (question.kind === 'open') return (key.correct_texts || [])[0] ?? '';
  return '';
}

/**
 * Ranglijst van de bomen (vragen met het cijfer-vinkje). Telt niet mee voor de score.
 * Een boom kan alleen winnen met minimaal `minVotes` stemmen.
 * @returns { ranked: [{ question, owner, average, votes }], tooFew: [...] }
 *   ranked: hoogste gemiddelde eerst (bij gelijk gemiddelde: meeste stemmen)
 */
export function treeRanking(questions, keys, answers, minVotes) {
  const all = questions.filter((q) => q.rate_tree).map((q) => {
    const ratings = answers.filter((a) => a.question_id === q.id && a.rating != null).map((a) => Number(a.rating));
    const votes = ratings.length;
    const average = votes ? ratings.reduce((s, r) => s + r, 0) / votes : 0;
    return { question: q, owner: ownerOf(q, keys.get(q.id)), average, votes };
  });
  const byScore = (a, b) => b.average - a.average || b.votes - a.votes;
  return {
    ranked: all.filter((t) => t.votes >= minVotes).sort(byScore),
    tooFew: all.filter((t) => t.votes < minVotes).sort(byScore),
  };
}

// ---------------------------------------------------------------- tussenstand

/**
 * Tussenstand zonder namen: de scores van de eerste 5, met gedeelde plaatsen.
 * Open vragen tellen met het automatische oordeel (geen omzettingen).
 * @returns [{ place, points }]
 */
export function interimTop(players, questionsSoFar, keys, answers, count = 5) {
  return scoreboard(players, questionsSoFar, keys, answers, []).slice(0, count)
    .map((r) => ({ place: r.place, points: r.points }));
}

// ---------------------------------------------------------------- schifting en winnaars

/**
 * Eindstand inclusief schiftingsvragen.
 * Volgorde: punten (hoog → laag), dan per gestelde schiftingsvraag de afstand
 * tot de juiste waarde (dichtst bij eerst; geen antwoord = achteraan).
 *
 * @param board       uitkomst van scoreboard()
 * @param doneIds     gestelde schiftingsvragen, in volgorde (games.tiebreak_done)
 * @param tbValues    Map question_id → juiste waarde
 * @param answers     alle antwoorden van dit spel
 * @param tiebreaksAvailable  zijn er schiftingsvragen klaargezet in beheer?
 * @returns {{
 *   rows: [{ player_id, name, points, place, distances }],
 *   pending: string[],   // namen die (nog) gelijk staan in de top 3
 *   winners: [{ name, place }],
 * }}
 */
export function finalRanking(board, doneIds, tbValues, answers, tiebreaksAvailable) {
  const dist = new Map(); // `${player}|${question}` → afstand
  for (const a of answers) {
    if (!tbValues.has(a.question_id) || a.number_answer == null) continue;
    dist.set(`${a.player_id}|${a.question_id}`, Math.abs(Number(a.number_answer) - Number(tbValues.get(a.question_id))));
  }
  const rows = board.map((r) => ({
    ...r,
    distances: doneIds.map((q) => dist.get(`${r.player_id}|${q}`) ?? Infinity),
  }));
  const cmp = (a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    for (let i = 0; i < doneIds.length; i++) {
      if (a.distances[i] !== b.distances[i]) return a.distances[i] - b.distances[i];
    }
    return 0;
  };
  rows.sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, 'nl'));
  rows.forEach((r, i) => { r.place = i > 0 && cmp(r, rows[i - 1]) === 0 ? rows[i - 1].place : i + 1; });

  // Groepen die gelijk staan en (deels) in de top 3 vallen.
  const pending = [];
  for (let i = 0; i < rows.length && i < 3;) {
    let j = i + 1;
    while (j < rows.length && cmp(rows[i], rows[j]) === 0) j++;
    if (j - i > 1) pending.push(...rows.slice(i, j).map((r) => r.name));
    i = j;
  }

  let winners;
  if (tiebreaksAvailable) {
    // Met schifting: de plaatsen 1–3 (precies drie zodra alles is beslist).
    winners = rows.filter((r) => r.place <= 3);
  } else {
    // Zonder schifting: iedereen met een van de drie hoogste scores.
    const top = [...new Set(rows.map((r) => r.points))].slice(0, 3);
    winners = rows.filter((r) => top.includes(r.points)).map((r) => ({ ...r, place: top.indexOf(r.points) + 1 }));
  }
  return { rows, pending, winners: winners.map((r) => ({ name: r.name, place: r.place })) };
}
