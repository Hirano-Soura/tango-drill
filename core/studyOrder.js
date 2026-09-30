// 復習ミックス以外の出題順(すべての語・回答数・最後の回答・追加日・正答率)と、出す語数の切り詰め。
// ブラウザの API に触れない(INV-6)。規則は Docs/21_Quiz.md §7。

import { keyOf, isPhrase } from './word.js';
import { shuffle } from './random.js';
import { answerCount, statOf } from './review.js';

/** @typedef {import('./word.js').Word} Word */
/** @typedef {import('./random.js').Rng} Rng */
/** @typedef {import('./book.js').Book} Book */

/**
 * 出題順の種類。
 * - shuffle: すべての語をシャッフル
 * - few: 回答数の少ない順
 * - stale: 最後に回答してから時間がたった順(回答の無い語 → 日時の無い古い記録の語 → 最後の回答の古い順)
 * - newest / oldest: 追加日の新しい順 / 古い順
 * - lowAcc: 正答率の低い順(回答の無い語は最後)
 * @typedef {'shuffle' | 'few' | 'stale' | 'newest' | 'oldest' | 'lowAcc'} StudyOrder
 */
/** @type {readonly StudyOrder[]} */
export const STUDY_ORDERS = Object.freeze(['shuffle', 'few', 'stale', 'newest', 'oldest', 'lowAcc']);

/**
 * @typedef {object} OrderOptions
 * @property {StudyOrder} order
 * @property {'all' | 'word' | 'phrase'} [kind] 出題する種別(既定: all)
 * @property {number} [count] 出す語数の上限(省略するとすべて)
 * @property {Rng} [rng] 同順位の語を散らす乱数(既定は Math.random)
 */

/**
 * 単語帳の語を出題順に並べ、種別で絞ってから count 語に切り詰める。単語帳の語だけを返す(INV-5)。
 * 同順位の語は、追加日の順(newest / oldest)なら単語帳の並びで決め、それ以外は乱数で散らす。
 * @param {Book} book
 * @param {OrderOptions} opts
 * @returns {Word[]}
 */
export function studyOrder(book, opts) {
  const rng = opts.rng || Math.random;
  const kind = opts.kind || 'all';
  const words = book.words.filter((w) => kind === 'all' || isPhrase(w) === (kind === 'phrase'));
  const rec = book.records;
  /** @type {Word[]} */
  let out;
  if (opts.order === 'newest' || opts.order === 'oldest') {
    const sign = opts.order === 'newest' ? -1 : 1;
    const idx = new Map(words.map((w, i) => [w, i]));
    const date = (/** @type {Word} */ w) => book.added[keyOf(w)] || '';
    out = words.slice().sort((a, b) => {
      const da = date(a), db = date(b);
      if (da !== db) return sign * (da < db ? -1 : 1);
      return sign * (/** @type {number} */ (idx.get(a)) - /** @type {number} */ (idx.get(b)));
    });
  } else {
    // 先に混ぜてから安定な並べ替えをかけ、同順位の語を散らす
    const mixed = shuffle(words, rng);
    if (opts.order === 'few') {
      out = mixed.sort((a, b) => answerCount(rec, keyOf(a)) - answerCount(rec, keyOf(b)));
    } else if (opts.order === 'stale') {
      out = mixed.sort((a, b) => compareStale(staleRank(book, a), staleRank(book, b)));
    } else if (opts.order === 'lowAcc') {
      out = mixed.sort((a, b) => {
        const sa = statOf(a, rec), sb = statOf(b, rec);
        if (sa.acc === null || sb.acc === null) return (sa.acc === null ? 1 : 0) - (sb.acc === null ? 1 : 0);
        if (sa.acc !== sb.acc) return sa.acc - sb.acc;
        return sb.wrong - sa.wrong;
      });
    } else {
      out = mixed;
    }
  }
  return opts.count === undefined ? out : out.slice(0, Math.max(0, opts.count));
}

/**
 * 最後の回答の古さの順位。段(0: 回答なし / 1: 回答はあるが日時の無い古い記録 / 2: 日時あり)と日時。
 * @param {Book} book
 * @param {Word} w
 * @returns {[number, string]}
 */
function staleRank(book, w) {
  const k = keyOf(w);
  if (!answerCount(book.records, k)) return [0, ''];
  const at = book.records.last?.[k];
  return at === undefined ? [1, ''] : [2, at];
}

/**
 * @param {[number, string]} a
 * @param {[number, string]} b
 */
function compareStale(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}
