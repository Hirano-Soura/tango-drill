// 既存アプリ(toeic-drill の 単語ドリル.html)の単語データと記録から、単語帳の全体(Book)を作る(T-8)。
// ブラウザの API に触れない(INV-6)。ファイルの読み書きは Tools/Migrate/ が行う。
// 規則は Docs/22_Storage.md §6。
// - 語は取り込みと同じ読み手(toeic-drill 版)で正規化する
// - 追加日は単語データの日付(既存アプリの「回」と同じ束ね方になる)。同じ鍵の語が複数の日にあれば最も古い日
// - 記録と印は既存アプリの鍵で引き、読み手の正規化で鍵が変わった語は新しい鍵へ移す
// - 最後にバックアップの読み手(readBackup)に通す(記録の検証・直近 KEEP 件への切り詰めを保存や復元と同じ規則で行う)

import { keyOf } from './word.js';
import { parseImport, LEGACY_FORMAT } from './importFormat.js';
import { readBackup, CURRENT_BACKUP_FORMAT } from './backup.js';
import { REVIEW } from './review.js';

/** @typedef {import('./word.js').Word} Word */
/** @typedef {import('./book.js').Book} Book */

/**
 * 単語データの 1 日分。text はファイルの包みを外した JSON(外すのは Tools/Migrate/legacyFiles.mjs。
 * 包みはブラウザで読み込むための呼び出しなので、core には持ち込まない。INV-6)。
 * @typedef {object} LegacyDay
 * @property {string} name ファイル名(知らせるときに使う)
 * @property {string} date YYYY-MM-DD
 * @property {string} text
 */

/**
 * 既存アプリの localStorage の中身(toeic_vocab_hist / toeic_vocab_self / toeic_vocab_weak)。
 * 鍵は「見出し語|品詞」。鍵の形を変える前の版は見出し語だけを鍵にしていた。
 * @typedef {object} LegacyRecords
 * @property {Record<string, unknown>} [hist]
 * @property {Record<string, unknown>} [self]
 * @property {Record<string, unknown>} [weak] 印。値が真の鍵
 */

/**
 * @typedef {object} MigrateResult
 * @property {Book} [book] problems が 1 つでもあれば作らない
 * @property {string[]} problems 移行を止める不備(読めない日・読めない語・鍵の衝突)
 * @property {string[]} warnings 知らせるだけのこと(読み手の警告・どの語にも当たらない記録など)
 * @property {{ key: string, date: string, name: string }[]} sources 単語データの全項目(重なりを含む)。突き合わせに使う
 * @property {{ from: string, to: string }[]} rekeys 読み手の正規化で鍵が変わった語(既存アプリの鍵 → 新しい鍵)
 * @property {Record<string, string>} keyMap 記録と印の既存アプリの鍵 → 付け替えた先の鍵(変わらないものも含む)
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {readonly LegacyDay[]} days
 * @param {LegacyRecords} [records]
 * @returns {MigrateResult}
 */
export function bookFromLegacy(days, records = {}) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {MigrateResult['sources']} */
  const sources = [];
  /** @type {Word[]} */
  const words = [];
  /** @type {Record<string, string>} */
  const added = {};
  /** 既存アプリの鍵 → 新しい鍵 */
  const oldToNew = new Map();
  /** 見出し語 → 最も古い日の語の新しい鍵(見出し語だけの古い鍵を引くため) */
  const oldestByEn = new Map();

  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const day of sorted) {
    if (!DATE.test(day.date)) {
      problems.push(`${day.name}: 日付 ${day.date} が YYYY-MM-DD ではありません`);
      continue;
    }
    const r = parseImport(day.text);
    if (r.fatal !== undefined || r.format !== LEGACY_FORMAT) {
      problems.push(`${day.name}: ${r.fatal ?? '既存アプリの単語データではありません(' + r.format + ')'}`);
      continue;
    }
    for (const w of r.warnings) warnings.push(`${day.name}: ${w}`);
    for (const row of r.rows) {
      if (!row.word) {
        problems.push(`${day.name} の ${row.ref} 番目: ${row.error ?? row.skipped ?? '読めません'}`);
        continue;
      }
      for (const w of row.warnings) warnings.push(`${day.name} の ${row.ref} 番目: ${w}`);
      const key = keyOf(row.word);
      const oldKey = keyOf(/** @type {Word} */ (JSON.parse(row.raw)));
      sources.push({ key, date: day.date, name: day.name });
      if (oldKey !== key) {
        const prev = oldToNew.get(oldKey);
        if (prev !== undefined && prev !== key) problems.push(`既存アプリの鍵 ${oldKey} が ${prev} と ${key} の 2 つに当たります`);
        else oldToNew.set(oldKey, key);
      }
      if (!oldestByEn.has(row.word.en)) oldestByEn.set(row.word.en, key);
      if (key in added) continue;
      added[key] = day.date;
      words.push(row.word);
    }
  }

  /** @type {MigrateResult['rekeys']} */
  const rekeys = [...oldToNew].map(([from, to]) => ({ from, to }));
  const inBook = new Set(words.map(keyOf));
  /**
   * 既存アプリの鍵を新しい鍵にする。見出し語だけの古い鍵は、その見出し語の最も古い語に当てる(既存アプリの移行と同じ)。
   * @param {string} k
   * @returns {string}
   */
  const mapKey = (k) => oldToNew.get(k) ?? (k.includes('|') ? k : oldestByEn.get(k) ?? k);
  /** @type {Record<string, string>} */
  const keyMap = {};

  /**
   * 鍵 → 値 の表を新しい鍵に付け替える。2 つの鍵が同じ新しい鍵に当たれば止める。
   * @param {string} what
   * @param {Record<string, unknown> | undefined} table
   * @returns {Record<string, unknown>}
   */
  const remap = (what, table) => {
    /** @type {Record<string, unknown>} */
    const out = {};
    /** @type {Record<string, string>} */
    const from = {};
    if (table === undefined) return out;
    if (typeof table !== 'object' || table === null || Array.isArray(table)) {
      problems.push(`${what} が { } ではありません`);
      return out;
    }
    for (const [k, v] of Object.entries(table)) {
      const to = mapKey(k);
      keyMap[k] = to;
      if (to in out) {
        problems.push(`${what}: ${from[to]} と ${k} が同じ語 ${to} に当たります`);
        continue;
      }
      out[to] = v;
      from[to] = k;
      if (!inBook.has(to)) warnings.push(`${what}: ${k} はどの語にも当たりません(${what === '印' ? '印は付けません' : '記録は残します'})`);
    }
    return out;
  };
  const hist = remap('正誤の記録', records.hist);
  const self = remap('自己申告の記録', records.self);
  const weak = remap('印', records.weak);
  const starred = Object.keys(weak).filter((k) => weak[k] && inBook.has(k));

  if (problems.length) return { problems, warnings, sources, rekeys, keyMap };
  const r = readBackup(
    { format: CURRENT_BACKUP_FORMAT, words, added, records: { hist, self }, starred },
    { today: sorted.length ? sorted[sorted.length - 1].date : '1970-01-01' },
  );
  if (r.fatal !== undefined || !r.book) return { problems: [r.fatal ?? '単語帳を作れません'], warnings, sources, rekeys, keyMap };
  return { book: r.book, problems, warnings: [...warnings, ...r.warnings], sources, rekeys, keyMap };
}

/**
 * 移行した単語帳を元の単語データと記録に突き合わせ、欠けているものを返す(空なら欠落なし)。
 * 書き出したファイルを読み直した単語帳に当てる(移行の途中の値ではなく、利用者が読み込むものを見る)。
 * 語: 単語データのどの項目の鍵も単語帳にあり、追加日がその項目の最も古い日であること。
 * 記録: 元の正誤・自己申告の記録のある語はどれも、直近の件(keep 件まで)が同じ並びで残っていること
 * (配列でない・0/1 以外を含むため読み手が捨てた記録も、欠けたものとして返す)。
 * 印: 元の印のうち単語帳にある語のものが、すべて残っていること。
 * @param {Book} book
 * @param {MigrateResult} result bookFromLegacy の結果(sources と keyMap を使う)
 * @param {LegacyRecords} [records]
 * @param {number} [keep] 記録を残す件数
 * @returns {string[]}
 */
export function missingAfterMigration(book, result, records = {}, keep = REVIEW.KEEP) {
  /** @type {string[]} */
  const out = [];
  const have = new Set(book.words.map(keyOf));
  /** @type {Map<string, string>} */
  const oldest = new Map();
  for (const s of result.sources) {
    const d = oldest.get(s.key);
    if (d === undefined || s.date < d) oldest.set(s.key, s.date);
  }
  for (const [key, date] of oldest) {
    if (!have.has(key)) out.push(`語 ${key} がありません`);
    else if (book.added[key] !== date) out.push(`語 ${key} の追加日が ${book.added[key]} です(単語データは ${date})`);
  }
  for (const [name, table, moved] of /** @type {const} */ ([['正誤', records.hist, book.records.hist], ['自己申告', records.self, book.records.self]])) {
    for (const [k, v] of Object.entries(table ?? {})) {
      if (Array.isArray(v) && !v.length) continue;
      // 配列でない・0/1 以外を含む記録は読み手が捨てるので、ここで欠落として知らせる(黙って失わない)
      const got = moved[result.keyMap[k] ?? k];
      const want = Array.isArray(v) ? v.slice(-keep) : v;
      if (!got || JSON.stringify(got) !== JSON.stringify(want)) out.push(`${name}の記録 ${k} が移っていません`);
    }
  }
  const starred = new Set(book.starred);
  for (const [k, v] of Object.entries(records.weak ?? {})) {
    const to = result.keyMap[k] ?? k;
    if (v && have.has(to) && !starred.has(to)) out.push(`印 ${k} が移っていません`);
  }
  return out;
}
