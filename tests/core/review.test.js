import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf } from '../../core/word.js';
import { notOwnQuestions } from '../../core/distractors.js';
import { BUILTIN_VOCAB } from '../../core/builtinVocab.js';
import {
  REVIEW, GROUP_ORDER, reviewMix, recordAnswer, emptyRecords, missOften, answerPairs, statOf,
  sessionAgo, baseDate, baseIndex, statsCsv, CSV_COLUMNS,
} from '../../core/review.js';

/** @typedef {import('../../core/word.js').Word} Word */
/** @typedef {import('../../core/review.js').Session} Session */

/** @param {string} en @param {string} [pos] @returns {Word} */
const w = (en, pos = '名') => ({ en, pos, ja: en + 'の意味' });

/** 7/1, 7/3, 7/4(語なし), 7/8, 7/10(明日) */
/** @type {Session[]} */
const SESSIONS = [
  { date: '2026-07-08', items: [w('d'), w('e')] },
  { date: '2026-07-01', items: [w('a')] },
  { date: '2026-07-03', items: [w('b'), w('c')] },
  { date: '2026-07-04', items: [] },
  { date: '2026-07-10', items: [w('f')] },
];
const TODAY = '2026-07-09';

test('基準の回は今日以前で最も新しい回。明日の回・語の無い回は数えない', () => {
  assert.equal(baseDate(SESSIONS, TODAY), '2026-07-08');
  assert.equal(baseDate(SESSIONS, '2026-07-10'), '2026-07-10');
  assert.equal(baseIndex(SESSIONS, '2026-06-30'), -1);
  assert.equal(baseDate(SESSIONS, '2026-06-30'), null);
});

test('n 回前は日付でなく回で数える(学習しなかった日があっても前の回を拾う)', () => {
  assert.deepEqual(sessionAgo(SESSIONS, TODAY, 0).map((x) => x.en), ['d', 'e']);
  assert.deepEqual(sessionAgo(SESSIONS, TODAY, 1).map((x) => x.en), ['b', 'c']);
  assert.deepEqual(sessionAgo(SESSIONS, TODAY, 2).map((x) => x.en), ['a']);
  assert.deepEqual(sessionAgo(SESSIONS, TODAY, 3), []);
});

test('よく間違える: 直近 M 回のうち P 回以上の誤答', () => {
  assert.equal(REVIEW.M, 5);
  assert.equal(REVIEW.P, 2);
  const r = { hist: { a: [0, 0, 1, 1, 1, 1, 1], b: [1, 1, 1, 0, 1, 0], c: [0] }, self: {} };
  assert.equal(missOften(r, 'a'), false, '6 回以上前の誤答は数えない');
  assert.equal(missOften(r, 'b'), true);
  assert.equal(missOften(r, 'c'), false);
  assert.equal(missOften(r, 'none'), false);
});

test('recordAnswer: 正誤と自己申告を同時に積み、直近 10 件だけ残す。渡した記録は変えない', () => {
  let r = emptyRecords();
  const before = r;
  for (let i = 0; i < 12; i++) r = recordAnswer(r, 'a|名', i % 3 !== 0, i % 2 === 0);
  assert.deepEqual(before, { hist: {}, self: {} });
  assert.equal(r.hist['a|名'].length, REVIEW.KEEP);
  assert.equal(r.self['a|名'].length, REVIEW.KEEP);
  assert.deepEqual(r.hist['a|名'], [1, 0, 1, 1, 0, 1, 1, 0, 1, 1]);
});

test('answerPairs: 自己申告の無い古い記録は、末尾から揃えて null にする', () => {
  const r = { hist: { k: [0, 1, 1, 0] }, self: { k: [1, 0] } };
  assert.deepEqual(answerPairs(r, 'k'), [
    { ok: false, self: null }, { ok: true, self: null }, { ok: true, self: true }, { ok: false, self: false },
  ]);
  const s = statOf({ en: 'k', ja: 'x' }, { hist: { 'k|': [1, 0, 0] }, self: { 'k|': [1, 1, 0] } });
  assert.deepEqual([s.n, s.correct, s.wrong, s.mis, s.said, s.unknown], [3, 1, 2, 1, 2, 1]);
  assert.equal(s.misRate, 0.5, '思い違い率 = 思い違い / 「わかる」の申告');
});

test('復習ミックス: 群の順は 今日 → 1 回前 → 3 回前 → よく間違える → 回答数が少ない。先の群に入った語は後に出ない', () => {
  /** @type {Session[]} */
  const sessions = [
    { date: '2026-07-01', items: [w('old1'), w('old2')] },
    { date: '2026-07-02', items: [w('three')] },
    { date: '2026-07-03', items: [w('x')] },
    { date: '2026-07-04', items: [w('one'), w('old1')] },
    { date: '2026-07-05', items: [w('today')] },
  ];
  const records = { hist: { 'old1|名': [0, 0], 'today|名': [0, 0], 'old2|名': [1] }, self: {} };
  const qs = reviewMix(sessions, records, { today: '2026-07-05', rng: () => 0.5 });
  const order = qs.map((q) => GROUP_ORDER.indexOf(q.group));
  assert.deepEqual(order, order.slice().sort((a, b) => a - b), '群の順に並ぶ');
  assert.equal(new Set(qs.map((q) => keyOf(q.word))).size, qs.length, '同じ語は 1 度だけ');
  const groups = Object.fromEntries(['today', 'd1', 'd3', 'miss', 'few'].map((g) => [g, qs.filter((q) => q.group === g).map((q) => q.word.en).sort()]));
  assert.deepEqual(groups, {
    today: ['today'],
    d1: ['old1', 'one'],
    d3: ['three'],
    miss: [], // old1 と today はよく間違えるが、先の群に入っている
    few: ['old2', 'x'], // 未回答の x が先。old2 は 1 回
  });
  assert.deepEqual(qs.filter((q) => q.group === 'few').map((q) => q.word.en), ['x', 'old2'], 'few は回答数の少ない順');
});

test('復習ミックス: 回答数が少ない群は上限 FEW 件', () => {
  const items = Array.from({ length: 30 }, (_, i) => w('w' + i));
  const qs = reviewMix([{ date: '2026-07-01', items }], emptyRecords(), { today: '2026-06-30' });
  assert.equal(qs.length, REVIEW.FEW);
  assert.ok(qs.every((q) => q.group === 'few'));
});

test('復習ミックス: 種別で絞れる(取り込んだ語は単語に kind を持たない)', () => {
  const phrase = { en: 'deal with A', pos: '動詞句', kind: 'phrase', ja: 'A に対処する' };
  const sessions = [{ date: '2026-07-01', items: [w('a'), phrase] }];
  const q = (/** @type {'all' | 'word' | 'phrase'} */ kind) =>
    reviewMix(sessions, emptyRecords(), { today: '2026-07-01', kind, rng: () => 0 }).map((x) => x.word.en).sort();
  assert.deepEqual(q('all'), ['a', 'deal with A']);
  assert.deepEqual(q('word'), ['a']);
  assert.deepEqual(q('phrase'), ['deal with A']);
});

test('INV-5: 自分の単語帳から作った出題集合に、内蔵語彙の語は入らない', () => {
  /** @type {Session[]} */
  const sessions = [
    { date: '2026-07-01', items: [w('budget'), w('merger')] },
    { date: '2026-07-02', items: [w('venue'), w('expand', '動')] },
  ];
  const own = sessions.flatMap((s) => s.items);
  for (let seed = 0; seed < 20; seed++) {
    const qs = reviewMix(sessions, emptyRecords(), { today: '2026-07-02', rng: () => (seed * 0.37) % 1 });
    assert.equal(qs.length, own.length);
    assert.deepEqual(notOwnQuestions(qs.map((q) => q.word), own), []);
  }
});

test('INV-5 陽性対照: 回に内蔵語彙の語が紛れ込むと、出題集合の検査が検出する', () => {
  const own = [w('budget'), w('merger')];
  const leaked = BUILTIN_VOCAB[0];
  const sessions = [{ date: '2026-07-01', items: [...own, leaked] }];
  const qs = reviewMix(sessions, emptyRecords(), { today: '2026-07-01' });
  assert.deepEqual(notOwnQuestions(qs.map((q) => q.word), own).map(keyOf), [keyOf(leaked)]);
});

test('statsCsv: 列は既存アプリと同じ。区切り・引用符を含む値は引用符で囲む', () => {
  const word = { en: 'deal with A, B', pos: '動詞句', kind: 'phrase', ja: '「A」に"対処"する' };
  const s = statOf(word, { hist: { [keyOf(word)]: [1, 0, 1] }, self: { [keyOf(word)]: [1, 1] } });
  const csv = statsCsv([s], new Map([[keyOf(word), '2026-07-01']]));
  const [head, row] = csv.split('\r\n');
  assert.equal(head, CSV_COLUMNS.join(','));
  assert.equal(row, '"deal with A, B",動詞句,,"「A」に""対処""する",phrase,"deal with A, B|動詞句",2026-07-01,3,2,1,0.667,1,2,0.5,0,1 0 1,- 1 1,0,0');
});
