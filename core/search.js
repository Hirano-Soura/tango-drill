// 単語帳の絞り込み(Docs/23_Screens.md §1)。ブラウザの API に触れない(INV-6)。

import { POS_CODE_OF_NAME, KIND_NAMES, posParts, isPhrase } from './word.js';

/** @typedef {import('./word.js').Word} Word */

/**
 * 絞り込みの文字列を語に分ける。区切りは空白(半角・全角。続いていても 1 つ)。
 * @param {string} query
 * @returns {string[]}
 */
export function searchTokens(query) {
  return query.split(/\s+/).filter(Boolean);
}

/**
 * 語の品詞を、略さない名前(名詞 …)は略号に揃えて分けたもの。かっこ書きは落とす。
 * @param {Word} w
 * @returns {string[]}
 */
function codes(w) {
  return posParts(w).map((p) => POS_CODE_OF_NAME[p] ?? p);
}

/**
 * 1 つの語(トークン)が単語に当たるか。
 * - 見出し語(大文字小文字を区別しない)か意味に含まれる
 * - 略さない品詞の名前(名詞・前置詞 …)なら、その品詞を持つ語と、品詞の名前を含む品詞の語(前置詞句・他動詞 …)
 * - 「〜句」(前置詞句・動詞句 …)なら、その句の品詞を持つ語
 * - 種別の呼び名(KIND_NAMES)なら、「句表現」は句表現(isPhrase)、「単語」は句表現でない語
 * @param {Word} w
 * @param {string} token
 * @returns {boolean}
 */
function matches(w, token) {
  if (w.en.toLowerCase().includes(token.toLowerCase()) || (w.ja ?? '').includes(token)) return true;
  if (token === KIND_NAMES.phrase) return isPhrase(w);
  if (token === KIND_NAMES.word) return !isPhrase(w);
  const code = POS_CODE_OF_NAME[token];
  if (code) return codes(w).some((p) => p === code || p.includes(token));
  if (token.length > 1 && token.endsWith('句')) return codes(w).includes(token);
  return false;
}

/**
 * 絞り込みに当たる語を、元の並びのまま返す。空白で区切った語のすべてに当たる語だけを残す(AND)。
 * @param {Word[]} words
 * @param {string} query
 * @returns {Word[]}
 */
export function filterWords(words, query) {
  const tokens = searchTokens(query);
  return tokens.length ? words.filter((w) => tokens.every((t) => matches(w, t))) : words;
}
