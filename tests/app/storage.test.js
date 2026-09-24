// 保存層(app/storage.js)。IndexedDB は fake-indexeddb で代える。実際のブラウザでの確認は Docs/50_Tasks.md の T-4。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openStorage } from '../../app/storage.js';
import { backupText, parseBackup, CURRENT_BACKUP_FORMAT } from '../../core/backup.js';
import { countBook, emptyBook } from '../../core/book.js';

/** @typedef {import('../../core/book.js').Book} Book */

const TODAY = '2026-09-25';
const NOW = '2026-09-25T09:00:00.000Z';

/** @returns {Book} */
const sample = () => ({
  words: [{ en: 'allocate', pos: '動', ja: '割り当てる' }, { en: 'itinerary', pos: '名', ja: '旅程' }],
  added: { 'allocate|動': '2026-09-17', 'itinerary|名': '2026-09-24' },
  records: { hist: { 'allocate|動': [1, 0, 1], 'gone|名': [0] }, self: { 'allocate|動': [1, 1, 0] } },
  starred: ['itinerary|名'],
});

/** @returns {Book} */
const other = () => ({
  words: [{ en: 'tentative', pos: '形', ja: '仮の' }],
  added: { 'tentative|形': '2026-09-01' },
  records: { hist: { 'tentative|形': [1] }, self: { 'tentative|形': [1] } },
  starred: [],
});

/** @param {IDBFactory} [factory] */
const open = (factory = new IDBFactory()) => openStorage(factory, { now: () => NOW });

test('何も保存していなければ空の単語帳を読む', async () => {
  const s = await open();
  assert.deepEqual(await s.load(TODAY), { book: emptyBook(), warnings: [] });
  assert.equal(await s.canUndo(), false);
  s.close();
});

test('保存した単語帳を、開き直しても同じ形で読める', async () => {
  const factory = new IDBFactory();
  const a = await open(factory);
  await a.save(sample());
  a.close();
  const b = await open(factory);
  assert.deepEqual(await b.load(TODAY), { book: sample(), warnings: [] });
  b.close();
});

test('保存の陽性対照: 別の IndexedDB(別のブラウザに当たる)には保存が見えない', async () => {
  const a = await open();
  await a.save(sample());
  const b = await open();
  assert.deepEqual((await b.load(TODAY)).book, emptyBook());
  a.close();
  b.close();
});

test('T-4: A で書き出したファイルを B で読み込むと、語数と記録件数が一致する', async () => {
  const a = await open();
  await a.save(sample());
  const text = backupText((await a.load(TODAY)).book, NOW);

  const b = await open();
  await b.save(other());
  const parsed = parseBackup(text, { today: TODAY });
  assert.equal(parsed.fatal, undefined);
  const incoming = /** @type {Book} */ (parsed.book);
  await b.restore(incoming);
  const got = (await b.load(TODAY)).book;
  assert.deepEqual(countBook(got), countBook(sample()));
  assert.deepEqual(countBook(got), { words: 2, answers: 4, recordedWords: 2, starred: 1 });
  assert.deepEqual(got, sample());
  a.close();
  b.close();
});

test('C1: 復元は直前の単語帳を退避し、元に戻すと退避した単語帳に戻って退避は消える', async () => {
  const s = await open();
  await s.save(other());
  await s.restore(sample());
  assert.deepEqual((await s.load(TODAY)).book, sample());
  assert.equal(await s.canUndo(), true);
  await s.undoRestore();
  assert.deepEqual((await s.load(TODAY)).book, other());
  assert.equal(await s.canUndo(), false);
  s.close();
});

test('C1: 空の単語帳に復元してから元に戻すと、空に戻る', async () => {
  const s = await open();
  await s.restore(sample());
  await s.undoRestore();
  assert.deepEqual((await s.load(TODAY)).book, emptyBook());
  s.close();
});

test('C1: 復元のあとに保存しても退避は残り、元に戻すと復元の前に戻る(復元のあとの変更は消える)', async () => {
  const s = await open();
  await s.save(other());
  await s.restore(sample());
  await s.save({ ...sample(), starred: [] });
  assert.equal(await s.canUndo(), true);
  await s.undoRestore();
  assert.deepEqual((await s.load(TODAY)).book, other());
  s.close();
});

test('C1: 2 回続けて復元すると、退避は 2 回目の直前の単語帳になる', async () => {
  const s = await open();
  await s.save(other());
  await s.restore(sample());
  await s.restore(emptyBook());
  await s.undoRestore();
  assert.deepEqual((await s.load(TODAY)).book, sample());
  s.close();
});

test('退避が無いのに元に戻そうとすると、理由を付けて断り、単語帳は変えない', async () => {
  const s = await open();
  await s.save(sample());
  await assert.rejects(s.undoRestore(), /元に戻す単語帳がありません/);
  assert.deepEqual((await s.load(TODAY)).book, sample());
  s.close();
});

test('保存してある中身はバックアップと同じ形(INV-3 の見本と同じ読み手で読む)', async () => {
  const factory = new IDBFactory();
  const s = await open(factory);
  await s.save(sample());
  s.close();
  const raw = await rawGet(factory, 'book');
  assert.equal(/** @type {any} */ (raw).format, CURRENT_BACKUP_FORMAT);
  assert.equal(/** @type {any} */ (raw).exportedAt, NOW);
});

test('保存してある中身が読めなければ、空の単語帳として扱わずに知らせ、中身を上書きしない', async () => {
  const factory = new IDBFactory();
  const s = await open(factory);
  await s.save(sample());
  s.close();
  const broken = { format: 'tango-drill-backup/v9', words: [] };
  await rawPut(factory, 'book', broken);
  const t = await open(factory);
  await assert.rejects(t.load(TODAY), /保存してある単語帳が読めません.*新しい/);
  t.close();
  assert.deepEqual(await rawGet(factory, 'book'), broken);
});

// --- 保存層を通さずに中身を見る・書く(検査用) -----------------------------------------------

/**
 * @param {IDBFactory} factory
 * @returns {Promise<IDBDatabase>}
 */
function rawOpen(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open('tango-drill');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBFactory} factory
 * @param {string} key
 * @returns {Promise<unknown>}
 */
async function rawGet(factory, key) {
  const db = await rawOpen(factory);
  const v = await new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return v;
}

/**
 * @param {IDBFactory} factory
 * @param {string} key
 * @param {unknown} value
 */
async function rawPut(factory, key, value) {
  const db = await rawOpen(factory);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
