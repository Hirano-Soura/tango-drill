// バックアップ形式(A1: 封筒型)の書き出しと読み込み。ブラウザの API に触れない(INV-6)。
// 語の部分は取り込み形式 tango-drill/v1 の語と同じ形・同じ読み手で読み、追加日・記録・印は語の鍵で引く欄に置く。
// 保存層(app/storage.js)も同じ形で IndexedDB に置き、同じ読み手で読む。仕様は Docs/22_Storage.md。
// 版を足す・変えるときの手順は取り込み形式と同じ(Docs/20_ImportFormat.md §1。INV-3)。

import { keyOf } from './word.js';
import { readItem, BACKUP_FORMAT_PREFIX } from './importFormat.js';
import { REVIEW, emptyRecords } from './review.js';
import { moveKeys, duplicateKeys } from './book.js';

/** @typedef {import('./word.js').Word} Word */
/** @typedef {import('./book.js').Book} Book */
/** @typedef {import('./book.js').Rekey} Rekey */

/** 書き出すときに使うバックアップの版 */
export const CURRENT_BACKUP_FORMAT = BACKUP_FORMAT_PREFIX + 'v1';

/**
 * @typedef {object} ReadOptions
 * @property {string} today 追加日の無い語に付ける日(YYYY-MM-DD)
 */

/**
 * バックアップの読み込み結果。fatal があれば book は無い。
 * 1 語でも読めなければ fatal にする(部分的に読めたもので単語帳を置き換えない)。
 * @typedef {object} BackupResult
 * @property {string} format
 * @property {Book} [book]
 * @property {string} [exportedAt] 書き出した日時(ISO 8601)。無い・読めないときは undefined
 * @property {string[]} warnings
 * @property {string} [fatal]
 */

/** バックアップの版ごとの読み手。過去の版の読み手を消さない(INV-3) */
const READERS = /** @type {Record<string, (data: Record<string, unknown>, opts: ReadOptions) => BackupResult>} */ ({
  'tango-drill-backup/v1': readV1,
});

/** 読めるバックアップの版のすべて(INV-3 のテストがこの一覧と見本を突き合わせる) */
export const READABLE_BACKUP_FORMATS = Object.freeze(Object.keys(READERS));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOP_KEYS = ['format', 'exportedAt', 'words', 'added', 'records', 'starred'];

/**
 * 単語帳をバックアップの形(JSON にできるオブジェクト)にする。渡した Book は変えない。
 * 追加日は単語帳にある語の分だけを書く。記録は消した語の分も書く。
 * @param {Book} book
 * @param {string} exportedAt 書き出した日時(ISO 8601)
 * @returns {Record<string, unknown>}
 */
export function toBackup(book, exportedAt) {
  const keys = new Set(book.words.map(keyOf));
  /** @type {Record<string, string>} */
  const added = {};
  for (const k of keys) if (book.added[k] !== undefined) added[k] = book.added[k];
  return {
    format: CURRENT_BACKUP_FORMAT,
    exportedAt,
    words: book.words.map((w) => (w.tags ? { ...w, tags: [...w.tags] } : { ...w })),
    added,
    records: {
      hist: copyLists(book.records.hist),
      self: copyLists(book.records.self),
    },
    starred: book.starred.filter((k) => keys.has(k)),
  };
}

/**
 * バックアップのファイルの中身(文字列)。
 * @param {Book} book
 * @param {string} exportedAt
 * @returns {string}
 */
export function backupText(book, exportedAt) {
  return JSON.stringify(toBackup(book, exportedAt), null, 2) + '\n';
}

/**
 * バックアップのファイルの中身を読む。保存はしない。
 * @param {string} text
 * @param {ReadOptions} opts
 * @returns {BackupResult}
 */
export function parseBackup(text, opts) {
  const src = String(text ?? '').replace(/^\ufeff/, '');
  if (!src.trim()) return fatal('json', 'ファイルが空です');
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(src);
  } catch (e) {
    return fatal('json', 'JSON として読めません: ' + (e instanceof Error ? e.message : String(e)));
  }
  return readBackup(data, opts);
}

/**
 * JSON として読み終えたバックアップを読む(保存層は IndexedDB から取り出したオブジェクトをこれで読む)。
 * @param {unknown} data
 * @param {ReadOptions} opts
 * @returns {BackupResult}
 */
export function readBackup(data, opts) {
  if (!isObject(data)) return fatal('json', 'JSON の最上位が { } ではありません');
  const fmt = data.format;
  if (fmt === undefined || (typeof fmt === 'string' && !fmt.startsWith(BACKUP_FORMAT_PREFIX))) {
    const name = typeof fmt === 'string' ? fmt : 'format 欄なし';
    return fatal(name, `バックアップのファイルではありません(${name})。語の取り込みファイルなら、取り込みから読み込んでください`);
  }
  if (typeof fmt !== 'string') return fatal('json', 'format が文字列ではありません');
  const reader = READERS[fmt];
  if (reader) return reader(data, opts);
  const m = /^tango-drill-backup\/v(\d+)$/.exec(fmt);
  const newest = Math.max(...READABLE_BACKUP_FORMATS.map((k) => Number(k.split('/v')[1])));
  if (m && Number(m[1]) > newest) {
    return fatal(fmt, `この版(${fmt})はこのアプリより新しいため読めません。アプリを更新してください`);
  }
  return fatal(fmt, `不明な形式です: ${fmt}`);
}

/**
 * tango-drill-backup/v1。項目は Docs/22_Storage.md §2。
 * @param {Record<string, unknown>} data
 * @param {ReadOptions} opts
 * @returns {BackupResult}
 */
function readV1(data, opts) {
  const format = 'tango-drill-backup/v1';
  const warnings = Object.keys(data).filter((k) => !TOP_KEYS.includes(k)).map((k) => `未知の項目 ${k} を無視しました`);

  let exportedAt;
  if (typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt))) exportedAt = data.exportedAt;
  else warnings.push('書き出した日時(exportedAt)が読めません');

  // 語: 1 語でも読めなければ全体を読まない
  if (!Array.isArray(data.words)) return fatal(format, 'words が配列ではありません');
  /** @type {Word[]} */
  const words = [];
  /** 読み手の正規化で鍵が変わった語(書き出した版と今の版で正規化の規則が違うとき) */
  /** @type {Rekey[]} */
  const rekeys = [];
  for (const [i, item] of data.words.entries()) {
    const row = readItem(item, i + 1);
    if (!row.word) return fatal(format, `${i + 1} 番の語が読めません: ${row.error ?? row.skipped}`);
    for (const w of row.warnings) warnings.push(`${i + 1} 番の語: ${w}`);
    const before = isObject(item) ? rawKey(item) : '';
    const after = keyOf(row.word);
    if (before !== after) rekeys.push({ from: before, to: after });
    words.push(row.word);
  }
  const dup = duplicateKeys(words);
  if (dup.length) return fatal(format, `同じ語が 2 回以上あります(INV-4): ${dup.join(', ')}`);

  const keys = new Set(words.map(keyOf));
  const added = readAdded(data.added, warnings);
  const records = readRecords(data.records, warnings);
  const starred = readStarred(data.starred, warnings);

  let book = moveKeys({ words, added, records, starred }, rekeys);
  // 単語帳に無い語の追加日・印は捨てる(記録は残す。Book の定義)
  const strayAdded = Object.keys(book.added).filter((k) => !keys.has(k));
  if (strayAdded.length) {
    warnings.push(`単語帳に無い語の追加日 ${strayAdded.length} 件を無視しました`);
    for (const k of strayAdded) delete book.added[k];
  }
  const strayStar = book.starred.filter((k) => !keys.has(k));
  if (strayStar.length) {
    warnings.push(`単語帳に無い語の印 ${strayStar.length} 件を無視しました`);
    book = { ...book, starred: book.starred.filter((k) => keys.has(k)) };
  }
  const undated = words.map(keyOf).filter((k) => book.added[k] === undefined);
  if (undated.length) {
    warnings.push(`追加日の無い語 ${undated.length} 語を ${opts.today} に追加したものとしました`);
    for (const k of undated) book.added[k] = opts.today;
  }
  return { format, book, exportedAt, warnings };
}

/**
 * 読み手で正規化する前の語の鍵。
 * @param {Record<string, unknown>} item
 * @returns {string}
 */
function rawKey(item) {
  return keyOf({
    en: typeof item.en === 'string' ? item.en : '',
    pos: typeof item.pos === 'string' ? item.pos : undefined,
  });
}

/**
 * @param {unknown} v
 * @param {string[]} warnings
 * @returns {Record<string, string>}
 */
function readAdded(v, warnings) {
  /** @type {Record<string, string>} */
  const out = {};
  if (v === undefined) return out;
  if (!isObject(v)) {
    warnings.push('added が { } ではないため無視しました');
    return out;
  }
  let bad = 0;
  for (const [k, d] of Object.entries(v)) {
    if (typeof d === 'string' && DATE.test(d)) out[k] = d;
    else bad++;
  }
  if (bad) warnings.push(`日付として読めない追加日 ${bad} 件を無視しました`);
  return out;
}

/**
 * @param {unknown} v
 * @param {string[]} warnings
 * @returns {import('./review.js').Records}
 */
function readRecords(v, warnings) {
  if (v === undefined) return emptyRecords();
  if (!isObject(v)) {
    warnings.push('records が { } ではないため無視しました');
    return emptyRecords();
  }
  return { hist: readLists(v.hist, 'hist', warnings), self: readLists(v.self, 'self', warnings) };
}

/**
 * 鍵ごとの 0 / 1 の配列。読めない鍵の分だけ捨て、直近 KEEP 件に切り詰める。
 * @param {unknown} v
 * @param {string} name
 * @param {string[]} warnings
 * @returns {Record<string, number[]>}
 */
function readLists(v, name, warnings) {
  /** @type {Record<string, number[]>} */
  const out = {};
  if (v === undefined) return out;
  if (!isObject(v)) {
    warnings.push(`records.${name} が { } ではないため無視しました`);
    return out;
  }
  let bad = 0;
  for (const [k, a] of Object.entries(v)) {
    if (Array.isArray(a) && a.every((x) => x === 0 || x === 1)) out[k] = a.slice(-REVIEW.KEEP);
    else bad++;
  }
  if (bad) warnings.push(`records.${name} の読めない記録 ${bad} 語分を無視しました`);
  return out;
}

/**
 * @param {unknown} v
 * @param {string[]} warnings
 * @returns {string[]}
 */
function readStarred(v, warnings) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    warnings.push('starred が配列ではないため無視しました');
    return [];
  }
  const out = v.filter((k) => typeof k === 'string');
  if (out.length !== v.length) warnings.push(`文字列ではない印 ${v.length - out.length} 件を無視しました`);
  return [...new Set(out)];
}

/**
 * @param {Readonly<Record<string, readonly number[]>>} lists
 * @returns {Record<string, number[]>}
 */
function copyLists(lists) {
  /** @type {Record<string, number[]>} */
  const out = {};
  for (const [k, a] of Object.entries(lists)) out[k] = [...a];
  return out;
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {string} format
 * @param {string} message
 * @returns {BackupResult}
 */
function fatal(format, message) {
  return { format, warnings: [], fatal: message };
}
