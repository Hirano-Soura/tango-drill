// バックアップ形式(Docs/22_Storage.md)。INV-3 はバックアップの版にも及ぶ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBackup, readBackup, toBackup, backupText, READABLE_BACKUP_FORMATS, CURRENT_BACKUP_FORMAT,
} from '../../core/backup.js';
import { countBook } from '../../core/book.js';
import { parseImport } from '../../core/importFormat.js';
import { REVIEW } from '../../core/review.js';

/** @typedef {import('../../core/book.js').Book} Book */

const TODAY = '2026-09-25';
const OPTS = { today: TODAY };

/**
 * 一度でも読めるようにしたバックアップの版と、その見本。**行を消さない。**
 * @type {Record<string, string>}
 */
const EVER_READABLE = {
  'tango-drill-backup/v1': 'tango-drill-backup_v1.json',
};

/** @param {string} name */
const read = (name) => readFileSync(new URL('./fixtures/backup/' + name, import.meta.url), 'utf8');

/** @param {string} text */
const book = (text) => {
  const r = parseBackup(text, OPTS);
  assert.equal(r.fatal, undefined, String(r.fatal));
  return /** @type {Book} */ (r.book);
};

/** @returns {Book} */
const sample = () => ({
  words: [
    { en: 'allocate', pos: '動', ja: '割り当てる', tags: ['第3週'] },
    { en: 'secure', pos: '形', ja: '安全な' },
    { en: 'itinerary' },
  ],
  added: { 'allocate|動': '2026-09-17', 'secure|形': '2026-09-24', 'itinerary|': '2026-09-24' },
  records: {
    hist: { 'allocate|動': [1, 0, 1], 'secure|形': [0], 'gone|名': [1, 1] },
    self: { 'allocate|動': [1, 1, 1], 'secure|形': [1] },
  },
  starred: ['secure|形'],
});

// --- INV-3 -----------------------------------------------------------------------------

test('INV-3: 過去に読めたバックアップの版は今も読め、読める版にはすべて見本がある', () => {
  for (const f of Object.keys(EVER_READABLE)) assert.ok(READABLE_BACKUP_FORMATS.includes(f), `${f} が読めなくなっている`);
  for (const f of READABLE_BACKUP_FORMATS) assert.ok(f in EVER_READABLE, `${f} の見本が EVER_READABLE に無い`);
  assert.ok(READABLE_BACKUP_FORMATS.includes(CURRENT_BACKUP_FORMAT), '書き出しに使う版が読めない');
});

for (const [format, file] of Object.entries(EVER_READABLE)) {
  test(`INV-3: ${format} の見本(${file})を、1 語も落とさず警告なしで読める`, () => {
    for (const eol of ['\n', '\r\n']) {
      const text = read(file).replace(/\r?\n/g, eol);
      const r = parseBackup(text, OPTS);
      assert.equal(r.fatal, undefined, String(r.fatal));
      assert.equal(r.format, format);
      assert.deepEqual(r.warnings, []);
      const raw = JSON.parse(text);
      assert.ok(raw.words.length > 0, '見本が空で、何も確かめていない');
      assert.equal(r.book?.words.length, raw.words.length);
    }
  });
}

test('INV-3 陽性対照: 見本の版を新しい版に書き換えると、読めないと報告される', () => {
  const r = parseBackup(read('tango-drill-backup_v1.json').replace('"tango-drill-backup/v1"', '"tango-drill-backup/v2"'), OPTS);
  assert.match(r.fatal ?? '', /新しいため読めません/);
  assert.equal(r.book, undefined);
});

// --- 往復 ------------------------------------------------------------------------------

test('書き出して読み込むと同じ単語帳に戻り、語数と記録件数が一致する(T-4 の完了条件の core 側)', () => {
  const b = sample();
  const text = backupText(b, '2026-09-24T12:00:00.000Z');
  const r = parseBackup(text, OPTS);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.book, b);
  assert.equal(r.exportedAt, '2026-09-24T12:00:00.000Z');
  assert.deepEqual(countBook(/** @type {Book} */ (r.book)), countBook(b));
  assert.deepEqual(countBook(b), { words: 3, answers: 6, recordedWords: 3, starred: 1 });
});

test('往復の陽性対照: 書き出した記録を 1 件消すと、記録件数が一致しなくなる', () => {
  const b = sample();
  const data = /** @type {any} */ (JSON.parse(backupText(b, '2026-09-24T12:00:00.000Z')));
  data.records.hist['allocate|動'].pop();
  const r = readBackup(data, OPTS);
  assert.notDeepEqual(countBook(/** @type {Book} */ (r.book)), countBook(b));
});

test('見本の件数: 語 4・記録 6 件(消した語 secure|動 の 2 件を含む)・印 1', () => {
  assert.deepEqual(countBook(book(read('tango-drill-backup_v1.json'))), { words: 4, answers: 6, recordedWords: 3, starred: 1 });
});

test('書き出しは、単語帳に無い語の追加日と印を書かず、消した語の記録は書く。渡した単語帳は変えない', () => {
  const b = sample();
  b.added['gone|名'] = '2026-09-01';
  b.starred.push('gone|名');
  const before = JSON.stringify(b);
  const data = /** @type {any} */ (toBackup(b, '2026-09-24T12:00:00.000Z'));
  assert.equal(data.format, CURRENT_BACKUP_FORMAT);
  assert.equal(data.added['gone|名'], undefined);
  assert.deepEqual(data.starred, ['secure|形']);
  assert.deepEqual(data.records.hist['gone|名'], [1, 1]);
  data.words[0].tags.push('x');
  assert.equal(JSON.stringify(b), before);
});

// --- 読めないもの ------------------------------------------------------------------------

test('1 語でも読めなければ全体を読まない(部分的に読めたもので置き換えない)', () => {
  const data = JSON.parse(read('tango-drill-backup_v1.json'));
  data.words[2] = { ja: '見出し語が無い' };
  const r = readBackup(data, OPTS);
  assert.match(r.fatal ?? '', /3 番の語が読めません/);
  assert.equal(r.book, undefined);
});

test('同じ鍵の語が 2 つあるバックアップは読まない(INV-4)', () => {
  const data = JSON.parse(read('tango-drill-backup_v1.json'));
  data.words.push({ en: 'tentative', pos: '形', ja: '別の訳' });
  assert.match(readBackup(data, OPTS).fatal ?? '', /INV-4.*tentative\|形/);
});

test('JSON でない・最上位が配列・words が配列でない・形式の違うファイルは読まない', () => {
  assert.match(parseBackup('', OPTS).fatal ?? '', /空/);
  assert.match(parseBackup('{', OPTS).fatal ?? '', /JSON として読めません/);
  assert.match(parseBackup('[]', OPTS).fatal ?? '', /で始まっていません/);
  // 保存層は JSON にせず readBackup で読むので、最上位が配列のときの分岐はこちらで確かめる
  assert.match(readBackup([], OPTS).fatal ?? '', /最上位が/);
  assert.match(parseBackup('{"format":"tango-drill-backup/v1","words":{}}', OPTS).fatal ?? '', /words が配列/);
  assert.match(parseBackup('{"format":"tango-drill-backup/x"}', OPTS).fatal ?? '', /不明な形式/);
  assert.match(parseBackup('{"format":1}', OPTS).fatal ?? '', /文字列ではありません/);
});

test('語の取り込みファイルをバックアップとして読ませると、取り込みへ案内する', () => {
  const imp = readFileSync(new URL('./fixtures/import/tango-drill_v1.json', import.meta.url), 'utf8');
  assert.match(parseBackup(imp, OPTS).fatal ?? '', /バックアップのファイルではありません.*取り込み/);
  assert.match(parseBackup('{"words":[{"en":"a"}]}', OPTS).fatal ?? '', /format 欄なし/);
  const simple = readFileSync(new URL('./fixtures/import/simple_v1.txt', import.meta.url), 'utf8');
  assert.match(parseBackup(simple, OPTS).fatal ?? '', /で始まっていません.*取り込み/);
  assert.match(parseBackup('```json\n{"format":"tango-drill/v1","words":[]}\n```', OPTS).fatal ?? '', /取り込み/);
});

test('exportedAt は無くても警告しない(任意の欄)。あって読めなければ警告する', () => {
  const data = JSON.parse(read('tango-drill-backup_v1.json'));
  delete data.exportedAt;
  const r = readBackup(data, OPTS);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.exportedAt, undefined);
  data.exportedAt = 'きのう';
  assert.deepEqual(readBackup(data, OPTS).warnings, ['書き出した日時(exportedAt)が読めません']);
});

test('未知の欄は、最上位でも records の中でも無視して警告する', () => {
  const data = JSON.parse(read('tango-drill-backup_v1.json'));
  data.theme = 'dark';
  data.records.streak = 3;
  const r = readBackup(data, OPTS);
  assert.equal(r.fatal, undefined);
  assert.deepEqual(r.warnings, ['未知の項目 theme を無視しました', '未知の項目 records.streak を無視しました']);
});

test('バックアップを語の取り込みに渡すと、バックアップの読み込みへ案内する(確認表を素通りして記録ごと入らない)', () => {
  const text = read('tango-drill-backup_v1.json');
  const r = parseImport(text);
  assert.match(r.fatal ?? '', /バックアップのファイルです/);
  assert.equal(r.rows.length, 0);
  // 陽性対照: 版を語の取り込み形式に書き換えれば、語として読める(拒否が無条件でないこと)
  const asImport = parseImport(text.replace('"tango-drill-backup/v1"', '"tango-drill/v1"'));
  assert.equal(asImport.fatal, undefined);
  assert.equal(asImport.rows.filter((row) => row.word).length, 4);
});

// --- 寛容に読むもの(警告を出す) -----------------------------------------------------------

test('単語帳に無い語の追加日・印は捨て、記録は残す', () => {
  const data = JSON.parse(read('tango-drill-backup_v1.json'));
  data.added['gone|名'] = '2026-09-01';
  data.starred.push('gone|名');
  const r = readBackup(data, OPTS);
  const b = /** @type {Book} */ (r.book);
  assert.equal(b.added['gone|名'], undefined);
  assert.ok(!b.starred.includes('gone|名'));
  assert.deepEqual(b.records.hist['secure|動'], [1, 1]);
  assert.equal(r.warnings.length, 2, r.warnings.join(' / '));
});

test('追加日の無い語・読めない追加日は、読み込んだ日に追加したものとする(単語帳のどの語も追加日を持つ)', () => {
  const data = JSON.parse(read('tango-drill-backup_v1.json'));
  delete data.added['tentative|形'];
  data.added['itinerary|'] = '9/24';
  const r = readBackup(data, OPTS);
  const b = /** @type {Book} */ (r.book);
  assert.equal(b.added['tentative|形'], TODAY);
  assert.equal(b.added['itinerary|'], TODAY);
  assert.equal(b.added['allocate|動'], '2026-09-17');
  assert.ok(r.warnings.some((w) => /2 語を 2026-09-25/.test(w)), r.warnings.join(' / '));
});

test('読めない記録は語ごとに捨て、長すぎる記録は直近 KEEP 件にする', () => {
  const data = JSON.parse(read('tango-drill-backup_v1.json'));
  data.records.hist['tentative|形'] = [1, 2];
  data.records.hist['allocate|動'] = Array(REVIEW.KEEP + 3).fill(0).concat([1]);
  const b = /** @type {Book} */ (readBackup(data, OPTS).book);
  assert.equal(b.records.hist['tentative|形'], undefined);
  assert.equal(b.records.hist['allocate|動'].length, REVIEW.KEEP);
  assert.equal(b.records.hist['allocate|動'].at(-1), 1);
});

test('読み手の正規化で鍵が変わる語は、追加日・記録・印も新しい鍵へ移す', () => {
  const data = {
    format: 'tango-drill-backup/v1',
    exportedAt: '2026-09-24T12:00:00.000Z',
    words: [{ en: 'budget', pos: 'noun' }],
    added: { 'budget|noun': '2026-09-01' },
    records: { hist: { 'budget|noun': [0, 1] }, self: { 'budget|noun': [0, 1] } },
    starred: ['budget|noun'],
  };
  const r = readBackup(data, OPTS);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.book, {
    words: [{ en: 'budget', pos: '名' }],
    added: { 'budget|名': '2026-09-01' },
    records: { hist: { 'budget|名': [0, 1] }, self: { 'budget|名': [0, 1] } },
    starred: ['budget|名'],
  });
});
