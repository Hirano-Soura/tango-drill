import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBook, moveKeys, countBook, duplicateKeys, sessionsOf, importIntoBook } from '../../core/book.js';
import { parseImport } from '../../core/importFormat.js';
import { planImport, confirmPlan } from '../../core/importPlan.js';
import { reviewMix, recordAnswer } from '../../core/review.js';
import { notOwnQuestions } from '../../core/distractors.js';
import { keyOf } from '../../core/word.js';

/** @typedef {import('../../core/book.js').Book} Book */

/**
 * 確認表を作って既定のまま確定する(画面で「確定」を押したのに当たる)。
 * @param {Book} b
 * @param {string} text
 */
const confirmed = (b, text) => confirmPlan(planImport(b.words, parseImport(text)));

// --- 回(B1: 追加した日で束ねる) ------------------------------------------------------------

/** @returns {Book} */
const dated = () => ({
  words: [
    { en: 'c', pos: '名' }, { en: 'a', pos: '名' }, { en: 'd', pos: '名' }, { en: 'b', pos: '名' }, { en: 'e', pos: '名' },
  ],
  added: { 'a|名': '2026-09-01', 'b|名': '2026-09-01', 'c|名': '2026-09-08', 'd|名': '2026-09-15', 'e|名': '2026-09-15' },
  records: { hist: {}, self: {} },
  starred: [],
});

test('sessionsOf: 追加した日ごとに 1 回とし、日付の昇順に並べる。回の中は単語帳の並び順', () => {
  assert.deepEqual(
    sessionsOf(dated()).map((s) => [s.date, s.items.map((w) => w.en).join('')]),
    [['2026-09-01', 'ab'], ['2026-09-08', 'c'], ['2026-09-15', 'de']],
  );
});

test('sessionsOf: 追加日の無い語はどの回にも入れない(日付の無い回を作らない)', () => {
  const b = dated();
  delete b.added['c|名'];
  const ss = sessionsOf(b);
  assert.deepEqual(ss.map((s) => s.date), ['2026-09-01', '2026-09-15']);
  assert.ok(!ss.some((s) => s.items.some((w) => w.en === 'c')));
});

test('sessionsOf: 復習ミックスの「今日」は最も新しい追加日の語、「1 回前」はその前の追加日の語', () => {
  const qs = reviewMix(sessionsOf(dated()), { hist: {}, self: {} }, { today: '2026-09-16', rng: () => 0.5 });
  const of = (/** @type {string} */ g) => qs.filter((q) => q.group === g).map((q) => q.word.en).sort().join('');
  assert.equal(of('today'), 'de');
  assert.equal(of('d1'), 'c');
});

test('INV-5: 単語帳から作った回の出題集合に、単語帳に無い語は入らない', () => {
  const b = dated();
  const qs = reviewMix(sessionsOf(b), { hist: {}, self: {} }, { today: '2026-09-16', rng: () => 0.5 });
  assert.ok(qs.length > 0, '出題が空で、何も確かめていない');
  assert.deepEqual(notOwnQuestions(qs.map((q) => q.word), b.words), []);
});

// --- 取り込みを単語帳に当てる --------------------------------------------------------------

test('importIntoBook: 新しく足した語には今日の追加日が付き、既にある語の追加日は変わらない', () => {
  const b = dated();
  const r = importIntoBook(b, confirmed(b, 'f | 名 | 新しい語\na | 名 | 埋める意味'), '2026-09-20');
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.book.added['f|名'], '2026-09-20');
  assert.equal(r.book.added['a|名'], '2026-09-01');
  for (const w of r.book.words) assert.ok(r.book.added[keyOf(w)], `${keyOf(w)} に追加日が無い`);
  assert.equal(b.words.length, 5, '渡した単語帳は変えない');
});

test('importIntoBook: 確定していない確認表は受け付けない(INV-2)', () => {
  const b = dated();
  const plan = planImport(b.words, parseImport('f | 名'));
  assert.throws(() => importIntoBook(b, /** @type {any} */ ({ plan, choices: {} }), '2026-09-20'), /INV-2/);
});

test('T-4.1: 品詞の無い語に記録を付けてから品詞を埋める取り込みをすると、記録・追加日・印が新しい鍵に付く', () => {
  /** @type {Book} */
  let b = { words: [{ en: 'itinerary', ja: '旅程' }], added: { 'itinerary|': '2026-09-01' }, records: { hist: {}, self: {} }, starred: ['itinerary|'] };
  b = { ...b, records: recordAnswer(recordAnswer(b.records, 'itinerary|', false, true), 'itinerary|', true, true) };
  const r = importIntoBook(b, confirmed(b, 'itinerary | 名'), '2026-09-20');
  assert.deepEqual(r.book.words, [{ en: 'itinerary', pos: '名', ja: '旅程' }]);
  assert.deepEqual(r.book.records.hist, { 'itinerary|名': [0, 1] });
  assert.deepEqual(r.book.records.self, { 'itinerary|名': [1, 1] });
  assert.deepEqual(r.book.added, { 'itinerary|名': '2026-09-01' });
  assert.deepEqual(r.book.starred, ['itinerary|名']);
});

/** @returns {Book} */
const sample = () => ({
  words: [{ en: 'itinerary', pos: '名' }, { en: 'secure', pos: '形' }],
  added: { 'itinerary|': '2026-09-01', 'secure|形': '2026-09-02' },
  records: { hist: { 'itinerary|': [0, 1], 'secure|形': [1] }, self: { 'itinerary|': [0, 1], 'secure|形': [1] } },
  starred: ['itinerary|'],
});

test('moveKeys: 追加日・記録・印を新しい鍵へ移し、古い鍵には残さない。渡した Book は変えない', () => {
  const b = sample();
  const before = JSON.stringify(b);
  const out = moveKeys(b, [{ from: 'itinerary|', to: 'itinerary|名' }]);
  assert.deepEqual(out.added, { 'itinerary|名': '2026-09-01', 'secure|形': '2026-09-02' });
  assert.deepEqual(out.records.hist, { 'itinerary|名': [0, 1], 'secure|形': [1] });
  assert.deepEqual(out.records.self, { 'itinerary|名': [0, 1], 'secure|形': [1] });
  assert.deepEqual(out.starred, ['itinerary|名']);
  assert.equal(JSON.stringify(b), before);
});

test('moveKeys: 移し先に消した語の記録が残っていれば、移してきた記録で置き換える', () => {
  const b = sample();
  b.records = { hist: { ...b.records.hist, 'itinerary|名': [1, 1, 1] }, self: { ...b.records.self } };
  const out = moveKeys(b, [{ from: 'itinerary|', to: 'itinerary|名' }]);
  assert.deepEqual(out.records.hist['itinerary|名'], [0, 1]);
});

test('moveKeys: 移す元に記録が無ければ、移し先に残っていた記録がそのまま付く', () => {
  const b = sample();
  b.records = { hist: { 'itinerary|名': [1, 1, 1] }, self: {} };
  const out = moveKeys(b, [{ from: 'itinerary|', to: 'itinerary|名' }]);
  assert.deepEqual(out.records.hist, { 'itinerary|名': [1, 1, 1] });
});

test('countBook: 記録件数は正誤の記録の総数(消した語の分も数える)', () => {
  assert.deepEqual(countBook(emptyBook()), { words: 0, answers: 0, recordedWords: 0, starred: 0 });
  const b = sample();
  b.records = { hist: { ...b.records.hist, 'gone|名': [1, 0, 0] }, self: b.records.self };
  assert.deepEqual(countBook(b), { words: 2, answers: 6, recordedWords: 3, starred: 1 });
});

test('duplicateKeys: 品詞の括弧書きだけが違う語は同じ鍵として重なる(INV-4)', () => {
  assert.deepEqual(duplicateKeys([{ en: 'a', pos: '名' }, { en: 'a', pos: '動' }]), []);
  assert.deepEqual(duplicateKeys([{ en: 'a', pos: '名' }, { en: 'a', pos: '名(可算)' }]), ['a|名']);
});
