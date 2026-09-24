// 単語帳の全体(語・追加日・記録・印)と、それに対する純粋な操作。ブラウザの API に触れない(INV-6)。
// 保存層(app/storage.js)とバックアップ(core/backup.js)はこの形を読み書きする。規則は Docs/22_Storage.md。

import { keyOf } from './word.js';
import { emptyRecords } from './review.js';

/** @typedef {import('./word.js').Word} Word */
/** @typedef {import('./review.js').Records} Records */

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
 * from に記録が無ければ、残っていた記録がそのまま付く(同じ鍵の語を足し直したときと同じ)。
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
    for (const m of [added, hist, self]) {
      if (!(from in m)) continue;
      m[to] = /** @type {any} */ (m)[from];
      delete m[from];
    }
    if (starred.includes(from)) starred = [...new Set(starred.map((k) => (k === from ? to : k)))];
  }
  return { words: book.words, added, records: { hist, self }, starred };
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
