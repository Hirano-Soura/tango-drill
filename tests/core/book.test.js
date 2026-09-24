import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBook, moveKeys, countBook, duplicateKeys } from '../../core/book.js';

/** @typedef {import('../../core/book.js').Book} Book */

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
