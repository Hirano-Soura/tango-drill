// T-8: 既存アプリの単語データと記録から単語帳を作る(core/migrate.js。Docs/22_Storage.md §6)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookFromLegacy, missingAfterMigration } from '../../core/migrate.js';
import { backupText, parseBackup } from '../../core/backup.js';
import { keyOf } from '../../core/word.js';

/**
 * 既存アプリの単語データの 1 日分(ファイルの包みを外した JSON。外すのは Tools/Migrate/legacyFiles.mjs)。
 * @param {string} date
 * @param {object[]} words
 * @param {object[]} [phrases]
 */
const day = (date, words, phrases = []) => ({
  name: `VOCAB_${date}.js`,
  date,
  text: JSON.stringify({ date, level: '600', theme: 'test', words, phrases }, null, 1),
});

const DAYS = [
  // 並びが日付順でなくても日付で並べる
  day('2026-07-19', [
    { en: 'secure', pos: '動', ja: '確保する' },
    { en: 'invoice', pos: '名', ja: '送り状' }, // 前の日と同じ鍵: 最も古い日の語を残す
    { en: 'apply', pos: '動詞', ja: '申し込む' }, // 品詞の別名: 読み手が 動 に揃えるので鍵が変わる
  ]),
  day('2026-07-18', [
    { en: 'invoice', pos: '名', ja: '請求書', ex: 'Please find the invoice attached.', exJa: '請求書を添付します。' },
    { en: 'secure', pos: '形', ja: '安全な' },
  ], [{ en: 'deal with', pos: '動詞句', ja: '～に対処する' }]),
];

const RECORDS = {
  hist: {
    'invoice|名': [1, 0],
    'apply|動詞': [0], // 既存アプリの鍵(品詞の別名のまま)
    secure: [1], // 鍵の形を変える前の見出し語だけの鍵: 最も古い secure(形)に当てる
    'gone|名': [1], // 単語データに無い語: 記録は残し、警告する
    'deal with|動詞句': [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0], // 直近 10 件にする
  },
  self: { 'invoice|名': [1, 1], 'apply|動詞': [0], secure: [1], 'gone|名': [1], 'deal with|動詞句': [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  weak: { 'apply|動詞': 1, 'secure|動': 1, 'gone|名': 1, 'invoice|名': 0 },
};

test('語は日付順に読み、同じ鍵は最も古い日の語を残し、追加日は単語データの日付にする', () => {
  const r = bookFromLegacy(DAYS);
  assert.deepEqual(r.problems, []);
  const book = /** @type {import('../../core/book.js').Book} */ (r.book);
  assert.deepEqual(book.words.map(keyOf), ['invoice|名', 'secure|形', 'deal with|動詞句', 'secure|動', 'apply|動']);
  assert.equal(book.words[0].ja, '請求書');
  assert.equal(book.words[2].kind, 'phrase');
  assert.deepEqual(book.added, {
    'invoice|名': '2026-07-18', 'secure|形': '2026-07-18', 'deal with|動詞句': '2026-07-18',
    'secure|動': '2026-07-19', 'apply|動': '2026-07-19',
  });
  assert.deepEqual(r.rekeys, [{ from: 'apply|動詞', to: 'apply|動' }]);
  assert.equal(r.sources.length, 6);
});

test('記録と印を新しい鍵へ移す(品詞の別名・見出し語だけの古い鍵・直近 10 件)', () => {
  const r = bookFromLegacy(DAYS, RECORDS);
  assert.deepEqual(r.problems, []);
  const book = /** @type {import('../../core/book.js').Book} */ (r.book);
  assert.deepEqual(book.records.hist['apply|動'], [0]);
  assert.deepEqual(book.records.hist['secure|形'], [1]);
  assert.deepEqual(book.records.hist['invoice|名'], [1, 0]);
  assert.deepEqual(book.records.hist['gone|名'], [1]);
  assert.deepEqual(book.records.hist['deal with|動詞句'], [1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  assert.equal(book.records.self['deal with|動詞句'].length, 10);
  assert.equal(book.records.hist['apply|動詞'], undefined);
  assert.equal(book.records.hist.secure, undefined);
  assert.deepEqual(book.starred.sort(), ['apply|動', 'secure|動']);
  assert.ok(r.warnings.some((w) => w.includes('gone|名') && w.includes('どの語にも当たりません')));
  assert.deepEqual(missingAfterMigration(book, r, RECORDS), []);
});

test('書き出したファイルを読み直しても欠落が無い(ツールが確かめる経路)', () => {
  const r = bookFromLegacy(DAYS, RECORDS);
  const back = parseBackup(backupText(/** @type {import('../../core/book.js').Book} */ (r.book), '2026-09-29T00:00:00.000Z'), { today: '2026-09-29' });
  assert.equal(back.fatal, undefined);
  assert.deepEqual(missingAfterMigration(/** @type {import('../../core/book.js').Book} */ (back.book), r, RECORDS), []);
});

test('陽性対照: 語・追加日・記録・印が欠ければ突き合わせが知らせる', () => {
  const r = bookFromLegacy(DAYS, RECORDS);
  const book = /** @type {import('../../core/book.js').Book} */ (r.book);
  const noWord = { ...book, words: book.words.filter((w) => w.en !== 'apply') };
  assert.deepEqual(missingAfterMigration(noWord, r, RECORDS), ['語 apply|動 がありません']);
  const wrongDate = { ...book, added: { ...book.added, 'secure|動': '2026-07-18' } };
  assert.deepEqual(missingAfterMigration(wrongDate, r, RECORDS), ['語 secure|動 の追加日が 2026-07-18 です(単語データは 2026-07-19)']);
  const { 'secure|形': _h, ...hist } = book.records.hist;
  assert.deepEqual(missingAfterMigration({ ...book, records: { ...book.records, hist } }, r, RECORDS), ['正誤の記録 secure が移っていません']);
  const { 'apply|動': _s, ...self } = book.records.self;
  assert.deepEqual(missingAfterMigration({ ...book, records: { ...book.records, self } }, r, RECORDS), ['自己申告の記録 apply|動詞 が移っていません']);
  assert.deepEqual(missingAfterMigration({ ...book, starred: ['secure|動'] }, r, RECORDS), ['印 apply|動詞 が移っていません']);
});

test('読み手が捨てた記録(0/1 以外を含む・配列でない)は、突き合わせが欠落として知らせる', () => {
  const bad = { hist: { 'invoice|名': [1, 2], 'secure|形': 'x', 'itinerary|名': [] }, self: {} };
  const r = bookFromLegacy(DAYS, bad);
  assert.deepEqual(r.problems, []);
  const book = /** @type {import('../../core/book.js').Book} */ (r.book);
  assert.equal(book.records.hist['invoice|名'], undefined);
  assert.ok(r.warnings.length > 0);
  // 空の記録は移すものが無いので欠落にしない
  assert.deepEqual(missingAfterMigration(book, r, bad), ['正誤の記録 invoice|名 が移っていません', '正誤の記録 secure|形 が移っていません']);
});

test('読めない日・日付の無い日・読めない語・鍵の衝突があれば単語帳を作らない', () => {
  const broken = { name: 'VOCAB_2026-07-20.js', date: '2026-07-20', text: '{"words":[}' };
  let r = bookFromLegacy([...DAYS, broken]);
  assert.equal(r.book, undefined);
  assert.match(r.problems[0], /^VOCAB_2026-07-20\.js: JSON として読めません/);

  r = bookFromLegacy([{ ...DAYS[0], date: '7/19' }]);
  assert.equal(r.book, undefined);
  assert.match(r.problems[0], /YYYY-MM-DD/);

  r = bookFromLegacy([day('2026-07-20', [{ en: '請求書', ja: 'invoice' }])]);
  assert.equal(r.book, undefined);
  assert.match(r.problems[0], /^VOCAB_2026-07-20\.js の 1 番目: /);

  // 見出し語だけの古い鍵と、新しい鍵が同じ語に当たる
  r = bookFromLegacy(DAYS, { hist: { secure: [1], 'secure|形': [0] } });
  assert.equal(r.book, undefined);
  assert.match(r.problems[0], /secure と secure\|形 が同じ語 secure\|形 に当たります/);
});

test('記録が無くても移行できる(記録は空)', () => {
  const r = bookFromLegacy(DAYS);
  assert.deepEqual(r.book?.records, { hist: {}, self: {}, last: {} });
  assert.deepEqual(r.book?.starred, []);
});
