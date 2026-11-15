// Tests voor js/scoring.js. Uitvoeren: node tests/scoring.test.mjs
import assert from 'node:assert/strict';
import {
  normalize, levenshtein, judgeOpen, estimateWinners, choiceWinners, scoreboard, parseNumber,
} from '../js/scoring.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✓', name); };

test('normaliseren', () => {
  assert.equal(normalize('  Crème   Brûlée! '), 'creme brulee');
  assert.equal(normalize('Sint-Nicolaas'), 'sintnicolaas');
  assert.equal(normalize('Wham!'), 'wham');
  assert.equal(normalize("'s-Hertogenbosch"), 'shertogenbosch');
  assert.equal(normalize(''), '');
});

test('levenshtein', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('oslo', 'olso'), 2);
  assert.equal(levenshtein('abc', 'abc'), 0);
});

const ans = (list) => list.map(([id, t]) => ({ player_id: id, text_answer: t }));

test('open: exact, schrijfwijze, tikfouten en fout', () => {
  const groups = judgeOpen(ans([
    ['a', 'Oostenrijk'], ['b', 'oostenrijk'], ['c', 'Oostenrijk!'],
    ['d', 'Oostenrjk'], ['e', 'Ostenrik'], ['f', 'Duitsland'], ['g', '  '],
  ]), ['Oostenrijk']);
  const by = Object.fromEntries(groups.map((g) => [g.normalized, g]));
  assert.equal(by.oostenrijk.count, 3);
  assert.equal(by.oostenrijk.correct, true);
  assert.equal(by.oostenrijk.reasonText, 'schrijfwijze'); // "Oostenrijk!" wijkt af
  assert.equal(by.oostenrjk.reasonText, '1 tikfout');
  assert.equal(by.ostenrik.reasonText, '2 tikfouten');   // 10 tekens: ≤ 2 mag
  assert.equal(by.duitsland.correct, false);
  assert.equal(by.duitsland.reasonText, 'fout');
  assert.equal(groups.length, 4); // lege antwoorden tellen niet mee
  assert.equal(groups[0].normalized, 'oostenrijk'); // grootste groep eerst
});

test('open: exact als iedereen het precies zo schreef', () => {
  const [g] = judgeOpen(ans([['a', 'Wham!'], ['b', 'wham!']]), ['Wham!']);
  assert.equal(g.reasonText, 'exact');
});

test('open: korte antwoorden maximaal 1 tikfout', () => {
  const groups = judgeOpen(ans([['a', 'Olso'], ['b', 'Osl']]), ['Oslo']);
  const by = Object.fromEntries(groups.map((g) => [g.normalized, g]));
  assert.equal(by.olso.correct, false); // afstand 2 bij 4 tekens
  assert.equal(by.osl.correct, true);
});

test('open: omzetting door Rutger', () => {
  const groups = judgeOpen(ans([['a', 'Austria'], ['b', 'Oostenrijk']]), ['Oostenrijk'], new Map([['austria', true]]));
  const by = Object.fromEntries(groups.map((g) => [g.normalized, g]));
  assert.equal(by.austria.correct, true);
  assert.equal(by.austria.reasonText, 'handmatig goed');
  // omzetting die gelijk is aan het automatische oordeel telt niet als handmatig
  const [g] = judgeOpen(ans([['b', 'Oostenrijk']]), ['Oostenrijk'], new Map([['oostenrijk', true]]));
  assert.equal(g.overridden, false);
});

const est = (list) => list.map(([id, n]) => ({ player_id: id, number_answer: n }));

test('schatting: minder dan 3 precies goed → aanvullen tot 3', () => {
  const w = estimateWinners(est([['a', 1818], ['b', 1820], ['c', 1810], ['d', 1700], ['e', 1900]]), 1818);
  assert.deepEqual([...w].sort(), ['a', 'b', 'c']);
});

test('schatting: gelijke afstand op de laatste plek → allemaal een punt', () => {
  const w = estimateWinners(est([['a', 100], ['b', 98], ['c', 105], ['d', 95], ['e', 200]]), 100);
  assert.deepEqual([...w].sort(), ['a', 'b', 'c', 'd']); // c en d allebei 5 ernaast
});

test('schatting: meer dan 3 precies goed → alleen die', () => {
  const w = estimateWinners(est([['a', 7], ['b', 7], ['c', 7], ['d', 7], ['e', 8]]), 7);
  assert.deepEqual([...w].sort(), ['a', 'b', 'c', 'd']);
});

test('schatting: minder dan 3 inzendingen', () => {
  assert.deepEqual([...estimateWinners(est([['a', 1], ['b', 50]]), 10)].sort(), ['a', 'b']);
  assert.equal(estimateWinners([], 10).size, 0);
});

test('meerkeuze', () => {
  const w = choiceWinners([{ player_id: 'a', choice: 1 }, { player_id: 'b', choice: 2 }, { player_id: 'c', choice: null }], 1);
  assert.deepEqual([...w], ['a']);
});

test('scorebord met gedeelde plaatsen en gemiste vragen', () => {
  const players = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Cas' }];
  const questions = [{ id: 'q1', kind: 'meerkeuze' }, { id: 'q2', kind: 'open' }, { id: 'q3', kind: 'schatting' }];
  const keys = new Map([
    ['q1', { correct_option: 0 }],
    ['q2', { correct_texts: ['Oslo'] }],
    ['q3', { correct_value: 10 }],
  ]);
  const answers = [
    { question_id: 'q1', player_id: 'a', choice: 0 }, { question_id: 'q1', player_id: 'b', choice: 0 },
    { question_id: 'q2', player_id: 'a', text_answer: 'oslo' }, { question_id: 'q2', player_id: 'b', text_answer: 'Bergen' },
    { question_id: 'q3', player_id: 'b', number_answer: 11 },
  ];
  const overrides = [{ question_id: 'q2', normalized: 'bergen', correct: true }];
  const board = scoreboard(players, questions, keys, answers, overrides);
  assert.deepEqual(board.map((r) => [r.name, r.points, r.place]), [['Bob', 3, 1], ['Anna', 2, 2], ['Cas', 0, 3]]);
  const tie = scoreboard(players, questions.slice(0, 1), keys, answers, []);
  assert.deepEqual(tie.map((r) => r.place), [1, 1, 3]);
});

test('getallen van de telefoon', () => {
  assert.equal(parseNumber('1818'), 1818);
  assert.equal(parseNumber('1818,5'), 1818.5);
  assert.equal(parseNumber('1.818,5'), 1818.5);
  assert.equal(parseNumber('1.818'), 1818);
  assert.equal(parseNumber('2.5'), 2.5);
  assert.equal(parseNumber('1 000 000'), 1000000);
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
});

console.log(`\n${passed} tests geslaagd`);

import { formatNumber } from '../js/scoring.js';
assert.equal(formatNumber(1818), '1818');
assert.equal(formatNumber(1818.5), '1818,5');
assert.equal(formatNumber(25000), '25.000');
console.log('✓ getallen tonen');

import { treeRanking, ownerOf } from '../js/scoring.js';
{
  const qs = [
    { id: 't1', kind: 'meerkeuze', rate_tree: true, options: ['Anna', 'Bob', 'Cas', 'Dirk'] },
    { id: 't2', kind: 'meerkeuze', rate_tree: true, options: ['Eva', 'Fien', 'Gijs', 'Hans'] },
    { id: 't3', kind: 'meerkeuze', rate_tree: true, options: ['Ivo', 'Jan', 'Kim', 'Lot'] },
    { id: 'q4', kind: 'meerkeuze', rate_tree: false, options: ['a', 'b', 'c', 'd'] },
  ];
  const keys = new Map([['t1', { correct_option: 2 }], ['t2', { correct_option: 0 }], ['t3', { correct_option: 3 }]]);
  const r = (q, ...vals) => vals.map((v, i) => ({ question_id: q, player_id: `p${i}`, rating: v }));
  const answers = [...r('t1', 8, 9, 10), ...r('t2', 9, 9, 9), ...r('t3', 10, 10), { question_id: 't1', player_id: 'x', rating: null }];
  const { ranked, tooFew } = treeRanking(qs, keys, answers, 3);
  assert.deepEqual(ranked.map((t) => [t.owner, t.average, t.votes]), [['Cas', 9, 3], ['Eva', 9, 3]]); // gelijk: volgorde blijft
  assert.deepEqual(tooFew.map((t) => t.owner), ['Lot']); // 10 gemiddeld, maar maar 2 stemmen
  assert.equal(ownerOf(qs[0], keys.get('t1')), 'Cas');
  assert.equal(ownerOf({ kind: 'open' }, { correct_texts: ['Oma'] }), 'Oma');
  console.log('✓ mooiste kerstboom');
}
