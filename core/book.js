// 単語帳の全体(語・追加日・記録・印)と、それに対する純粋な操作。ブラウザの API に触れない(INV-6)。
// 保存層(app/storage.js)とバックアップ(core/backup.js)はこの形を読み書きする。規則は Docs/22_Storage.md。

import { keyOf } from './word.js';
import { emptyRecords } from './review.js';
import { applyImport, planImport, confirmPlan } from './importPlan.js';
import { parseImport, readItem, CURRENT_JSON_FORMAT } from './importFormat.js';

/** @typedef {import('./word.js').Word} Word */
/** @typedef {import('./review.js').Records} Records */
/** @typedef {import('./review.js').Session} Session */
/** @typedef {import('./importPlan.js').ConfirmedPlan} ConfirmedPlan */

/**
 * 単語帳の全体。語以外の項目は語の鍵(INV-4)で引く。
 * - added: 語を追加した日(YYYY-MM-DD)。回は追加した日で束ねる(Docs/21_Quiz.md §5)。単語帳のどの語も持つ
 * - records: 正誤と自己申告。単語帳から消した語の記録も残りうる(同じ鍵の語を足し直すと、また付く)
 * - starred: 利用者が印を付けた語の鍵
 * @typedef {object} Book
 * @property {Word[]} words
 * @property {Record<string, string>} added
 * @property {Records} records
 * @property {string[]} starred
 */

/**
 * 鍵の付け替え。from の鍵で持っていた追加日・記録・印を to の鍵へ移す。
 * @typedef {object} Rekey
 * @property {string} from
 * @property {string} to
 */

/** @returns {Book} */
export function emptyBook() {
  return { words: [], added: {}, records: emptyRecords(), starred: [] };
}

/**
 * 語の鍵が変わったとき(取り込みで品詞が埋まった等)に、鍵で引く項目を新しい鍵へ移した Book を返す。
 * 語そのもの(words)は呼ぶ側が既に新しい形にしてある前提で、ここでは触らない。渡した Book は変えない。
 * to の鍵に消した語の記録が残っていた場合、from に記録があればそれで置き換える(今ある語の記録を優先する)。
 * 正誤(hist)と自己申告(self)は 1 組で置き換える。from に記録が無ければ、残っていた記録がそのまま付く
 * (同じ鍵の語を足し直したときと同じ)。
 * @param {Book} book
 * @param {readonly Rekey[]} rekeys
 * @returns {Book}
 */
export function moveKeys(book, rekeys) {
  const added = { ...book.added };
  const hist = { ...book.records.hist };
  const self = { ...book.records.self };
  let starred = [...book.starred];
  for (const { from, to } of rekeys) {
    if (from === to) continue;
    if (from in added) {
      added[to] = added[from];
      delete added[from];
    }
    // 正誤と自己申告は 1 組で移す(片方だけ置き換えると、末尾から対にしたときの対応が崩れる)
    if (from in hist || from in self) {
      for (const m of [hist, self]) {
        if (from in m) m[to] = m[from];
        else delete m[to];
        delete m[from];
      }
    }
    if (starred.includes(from)) starred = [...new Set(starred.map((k) => (k === from ? to : k)))];
  }
  return { words: book.words, added, records: { hist, self }, starred };
}

/**
 * 回の一覧(B1: 語を追加した日で束ねる。Docs/21_Quiz.md §5)。回の中の語は単語帳の並び順。
 * 追加日の無い語はどの回にも入れない(Book の定義では起きない)。
 * @param {Book} book
 * @returns {Session[]}
 */
export function sessionsOf(book) {
  /** @type {Map<string, Word[]>} */
  const byDate = new Map();
  for (const w of book.words) {
    const d = book.added[keyOf(w)];
    if (d === undefined) continue;
    const list = byDate.get(d);
    if (list) list.push(w);
    else byDate.set(d, [w]);
  }
  return [...byDate.keys()].sort().map((date) => ({ date, items: /** @type {Word[]} */ (byDate.get(date)) }));
}

/**
 * 確定した確認表(INV-2)を単語帳の全体に当てる。新しく足した語には today を追加日として付け、
 * 品詞が埋まって鍵が変わった語は追加日・記録・印を新しい鍵へ移す(T-4.1)。渡した Book は変えない。
 * @param {Book} book
 * @param {ConfirmedPlan} confirmedPlan
 * @param {string} today YYYY-MM-DD
 * @returns {{ book: Book, added: number, updated: number }}
 */
export function importIntoBook(book, confirmedPlan, today) {
  const r = applyImport(book.words, confirmedPlan);
  const moved = moveKeys({ ...book, words: r.words }, r.rekeys);
  for (const k of r.addedKeys) moved.added[k] = today;
  return { book: moved, added: r.added, updated: r.updated };
}

/**
 * 画面の入力欄から来る 1 語。空欄は空文字で来てよい(項目が無いのと同じに扱う)。
 * @typedef {object} WordInput
 * @property {string} en
 * @property {string} [pos]
 * @property {string} [trans]
 * @property {string} [ja]
 * @property {string} [ex]
 * @property {string} [exJa]
 * @property {string} [note]
 * @property {string[]} [tags]
 */

/**
 * @typedef {{ ok: true, book: Book, key: string, warnings: string[] } | { ok: false, error: string }} EditResult
 */

/**
 * 追加画面で 1 語を足す。取り込みと同じ読み手・確認表を通す(INV-2・INV-4)。
 * 手で入れた 1 語は入力欄そのものが確認に当たるので、確認表の行が「足す」のときだけ確定して保存する。
 * 既にある語に当たる(空欄を埋める・同じ・当て先が決まらない)ときは足さずに、単語帳からの編集へ案内する。
 * 例文があれば出どころは自作(self)にする。
 * @param {Book} book
 * @param {WordInput} input
 * @param {string} today YYYY-MM-DD
 * @returns {EditResult}
 */
export function addOneWord(book, input, today) {
  const text = JSON.stringify({ format: CURRENT_JSON_FORMAT, words: [clean(input)] });
  const plan = planImport(book.words, parseImport(text), { exSrc: 'self' });
  const row = plan.rows[0];
  if (plan.fatal !== undefined || !row) return { ok: false, error: plan.fatal ?? '入力が読めません' };
  if (row.action === 'error') return { ok: false, error: row.message ?? '入力が読めません' };
  if (row.action !== 'add' || !row.word) {
    const at = row.target ?? row.candidates?.join(' / ') ?? '';
    return { ok: false, error: `既に単語帳にある語(${at})に当たります。単語帳から編集してください` };
  }
  const r = importIntoBook(book, confirmPlan(plan), today);
  return { ok: true, book: r.book, key: keyOf(row.word), warnings: row.warnings };
}

/**
 * 単語帳の 1 語を書き換える。取り込みと同じ読み手で正規化する(品詞の別名・例文の無い和訳の扱いなど)。
 * - 例文を消すと、和訳と出どころも消す(3 つは一組。Docs/20_ImportFormat.md §4)
 * - 例文を書き換えると、出どころは自作(self)にする。変えなければ元の出どころを残す
 * - 見出し語か品詞を変えて鍵が変わるときは、追加日・記録・印を新しい鍵へ移す。
 *   新しい鍵の語が既にあれば書き換えない(INV-4)
 * @param {Book} book
 * @param {string} key 書き換える語の鍵
 * @param {WordInput} input
 * @returns {EditResult}
 */
export function editWord(book, key, input) {
  const i = book.words.findIndex((w) => keyOf(w) === key);
  if (i < 0) return { ok: false, error: `${key} は単語帳にありません` };
  const old = book.words[i];
  /** @type {Record<string, unknown>} */
  const item = clean(input);
  /** @type {string[]} */
  const notes = [];
  if (!item.ex) {
    // 例文を消したときの和訳は黙って消す。例文の無いまま和訳を書き足したときは知らせる
    if (item.exJa && item.exJa !== old.exJa) notes.push('例文の無い和訳(exJa)は無視しました');
    delete item.exJa;
  } else {
    item.exSrc = item.ex === old.ex && old.exSrc ? old.exSrc : 'self';
  }
  if (old.kind === 'phrase') item.kind = 'phrase';
  const row = readItem(item, 1);
  if (!row.word) return { ok: false, error: row.error ?? row.skipped ?? '入力が読めません' };
  const next = row.word;
  const to = keyOf(next);
  if (to !== key && book.words.some((w) => keyOf(w) === to)) {
    return { ok: false, error: `${to} は既に単語帳にあります(同じ見出し語と品詞の語は 1 つだけ。INV-4)` };
  }
  const words = book.words.slice();
  words[i] = next;
  return { ok: true, book: moveKeys({ ...book, words }, [{ from: key, to }]), key: to, warnings: [...notes, ...row.warnings] };
}

/**
 * 語を単語帳から消す。追加日と印も消し、記録は残す(同じ鍵の語を足し直すと、また付く。§1)。
 * @param {Book} book
 * @param {string} key
 * @returns {Book}
 */
export function deleteWord(book, key) {
  const added = { ...book.added };
  delete added[key];
  return {
    words: book.words.filter((w) => keyOf(w) !== key),
    added,
    records: book.records,
    starred: book.starred.filter((k) => k !== key),
  };
}

/**
 * 印を付け外しする。
 * @param {Book} book
 * @param {string} key
 * @returns {Book}
 */
export function toggleStar(book, key) {
  const starred = book.starred.includes(key) ? book.starred.filter((k) => k !== key) : [...book.starred, key];
  return { ...book, starred };
}

/**
 * 入力欄の値から空欄を落とす(空文字は項目が無いのと同じ)。
 * @param {WordInput} input
 * @returns {Record<string, unknown>}
 */
function clean(input) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) ? v.length > 0 : v != null) out[k] = v;
  }
  return out;
}

/**
 * 復元の前に見せる件数(C1)。answers が「記録件数」で、正誤の記録の総数(消した語の記録も含む)。
 * @param {Book} book
 * @returns {{ words: number, answers: number, recordedWords: number, starred: number }}
 */
export function countBook(book) {
  const lists = Object.values(book.records.hist);
  return {
    words: book.words.length,
    answers: lists.reduce((n, a) => n + a.length, 0),
    recordedWords: lists.filter((a) => a.length).length,
    starred: book.starred.length,
  };
}

/**
 * 単語帳の中で鍵が重なる語(INV-4)。重なりが無ければ空。
 * @param {readonly Word[]} words
 * @returns {string[]}
 */
export function duplicateKeys(words) {
  const seen = new Set();
  const dup = new Set();
  for (const w of words) {
    const k = keyOf(w);
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}
