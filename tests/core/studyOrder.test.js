// 復習ミックス以外の出題順と語数(Docs/21_Quiz.md §7)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf } from '../../core/word.js';
import { notOwnQuestions } from '../../core/distractors.js';
import { studyOrder, STUDY_ORDERS } from '../../core/studyOrder.js';

/** @typedef {import('../../core/book.js').Book} Book */
/** @typedef {import('../../core/word.js').Word} Word */

/** 種を固定した乱数(同順位の散らし方を再現するため) */
const seeded = (seed = 1) => () => ((seed = (seed * 48271) % 2147483647) / 2147483647);

/** @param {string} en @param {string} [pos] @returns {Word} */
const w = (en, pos = '名') => ({ en, pos, ja: en + 'の意味' });

/**
 * a〜e の 5 語と句表現 1 語。
 * - 回答数: a 3 / b 1 / c 0 / d 2 / e 5 / ph 1
 * - 正答率: a 1/3 / b 0/1 / c なし / d 2/2 / e 1/5 / ph 1/1
 * - 最後の回答: a 9/20 / b 日時なし(v1 の記録) / d 9/25 / e 9/10 / ph 9/28
 * - 追加日: a・b 9/01(単語帳の並びは a → b)/ c 9/05 / d・ph 9/10 / e 9/03
 * @returns {Book}
 */
const sample = () => ({
  words: [w('a'), w('b'), w('c'), w('d'), w('e'), w('deal with', '動詞句')],
  added: {
    'a|名': '2026-09-01', 'b|名': '2026-09-01', 'c|名': '2026-09-05', 'd|名': '2026-09-10', 'e|名': '2026-09-03',
    'deal with|動詞句': '2026-09-10',
  },
  records: {
    hist: { 'a|名': [0, 1, 0], 'b|名': [0], 'd|名': [1, 1], 'e|名': [0, 0, 1, 0, 0], 'deal with|動詞句': [1] },
    self: {},
    last: {
      'a|名': '2026-09-20T00:00:00.000Z', 'd|名': '2026-09-25T00:00:00.000Z', 'e|名': '2026-09-10T00:00:00.000Z',
      'deal with|動詞句': '2026-09-28T00:00:00.000Z',
    },
  },
  starred: [],
});

/** @param {Word[]} ws */
const ens = (ws) => ws.map((x) => x.en);
/** @param {Partial<import('../../core/studyOrder.js').OrderOptions>} o */
const run = (o) => ens(studyOrder(sample(), { order: 'shuffle', kind: 'word', rng: seeded(), ...o }));

test('few: 回答数の少ない順', () => {
  assert.deepEqual(run({ order: 'few' }), ['c', 'b', 'd', 'a', 'e']);
});

test('stale: 回答の無い語 → 日時の無い古い記録の語 → 最後の回答の古い順', () => {
  assert.deepEqual(run({ order: 'stale' }), ['c', 'b', 'e', 'a', 'd']);
});

test('newest / oldest: 追加日の順。同じ日の語は単語帳の並び(新しい順ではその逆)で決める', () => {
  assert.deepEqual(run({ order: 'newest' }), ['d', 'c', 'e', 'b', 'a']);
  assert.deepEqual(run({ order: 'oldest' }), ['a', 'b', 'e', 'c', 'd']);
});

test('lowAcc: 正答率の低い順。同率なら誤答の多い順、回答の無い語は最後', () => {
  assert.deepEqual(run({ order: 'lowAcc' }), ['b', 'e', 'a', 'd', 'c']);
});

test('同順位の語は乱数で散らす(few で回答 0 回の語が複数あると、種によって先頭が変わる)', () => {
  const b = sample();
  b.words.push(w('f'), w('g'), w('h'));
  const heads = new Set();
  for (let s = 1; s <= 20; s++) heads.add(studyOrder(b, { order: 'few', kind: 'word', rng: seeded(s) })[0].en);
  assert.ok(heads.size > 1, `先頭が常に ${[...heads]}`);
  for (const h of heads) assert.ok(['c', 'f', 'g', 'h'].includes(h), `回答のある語 ${h} が先頭に来た`);
});

test('shuffle: すべての語を 1 回ずつ出す', () => {
  assert.deepEqual(run({ order: 'shuffle' }).sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('count: 並べたあとで先頭から count 語に切り詰める。省略・語数より多ければすべて', () => {
  assert.deepEqual(run({ order: 'few', count: 2 }), ['c', 'b']);
  assert.equal(run({ order: 'few', count: 50 }).length, 5);
  assert.equal(run({ order: 'few' }).length, 5);
  assert.deepEqual(run({ order: 'few', count: 0 }), []);
});

test('kind: 種別で絞ってから切り詰める(句表現だけなら句表現が count 語まで出る)', () => {
  assert.deepEqual(run({ order: 'newest', kind: 'phrase', count: 1 }), ['deal with']);
  assert.equal(ens(studyOrder(sample(), { order: 'newest' })).length, 6, '既定は単語と句表現の両方');
  assert.deepEqual(ens(studyOrder(sample(), { order: 'newest', count: 2 })), ['deal with', 'd']);
});

test('INV-5: どの出題順でも単語帳の語だけを出す(陽性対照: 単語帳に無い語を混ぜると検出される)', () => {
  const b = sample();
  for (const order of STUDY_ORDERS) {
    const qs = studyOrder(b, { order, rng: seeded() });
    assert.deepEqual(notOwnQuestions(qs, b.words), [], order);
    assert.equal(new Set(qs.map(keyOf)).size, b.words.length, `${order}: 全語を 1 回ずつ`);
  }
  assert.equal(notOwnQuestions([...studyOrder(b, { order: 'few' }), w('builtin-only')], b.words).length, 1);
});

test('渡した単語帳は変えない', () => {
  const b = sample();
  const before = JSON.stringify(b);
  for (const order of STUDY_ORDERS) studyOrder(b, { order, count: 2, rng: seeded() });
  assert.equal(JSON.stringify(b), before);
});
