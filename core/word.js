// 語そのものに関する純粋関数。ブラウザの API に触れない(INV-6)。
// 出自: toeic-drill の 単語ドリル.html(normPos / keyOf / posParts / jaSenses / sensesOverlap)。

/**
 * 1 語のデータ。項目名は toeic-drill の単語データと同じ。
 * @typedef {object} Word
 * @property {string} en 見出し語
 * @property {string} [pos] 品詞("名" "動" "形" … 複数は "動/名"、句は "動詞句" 等)
 * @property {string} [trans] 動詞の自他("vt" / "vi" / "vt/vi")
 * @property {string} [ja] 日本語の意味
 * @property {string} [ex] 英語の例文
 * @property {string} [exJa] 例文の和訳
 * @property {string} [note] 補足
 * @property {string} [kind] 句表現なら "phrase"
 */

/** 括弧書きの補足(全角・半角)を落とす */
const PAREN = /[（(][^）)]*[）)]/g;

/**
 * 品詞から括弧書きの補足を落として正規化する。
 * @param {Pick<Word, 'pos'>} w
 * @returns {string}
 */
export function normPos(w) {
  return String(w.pos || '').replace(PAREN, '').trim();
}

/**
 * 語の同一性の鍵(INV-4)。同じ綴りで品詞の違う語(secure 形/動)を別の語として扱う。
 * 表示・履歴・重複除去のすべてをこの鍵で揃える。
 * @param {Pick<Word, 'en' | 'pos'>} w
 * @returns {string}
 */
export function keyOf(w) {
  return w.en + '|' + normPos(w);
}

/**
 * 品詞を配列に分解する。"動/名" → ["動", "名"]。空なら句表現は "句"、それ以外は ""。
 * @param {Pick<Word, 'pos' | 'kind'>} w
 * @returns {string[]}
 */
export function posParts(w) {
  const raw = String(w.pos || '').replace(PAREN, '');
  const parts = raw.split(/[\/・,、|]/).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : [w.kind === 'phrase' ? '句' : ''];
}

/**
 * 訳語を「語義の集合」に分解する。
 * 誤答候補を選ぶ前に、語義が重なる語を外すために使う。助詞まで落として意図的に過剰に寄せる
 * (紛らわしい語を誤答に出してしまう方が害が大きい)。
 * @param {string | undefined} ja
 * @returns {Set<string>}
 */
export function jaSenses(ja) {
  const body = String(ja || '').replace(PAREN, '');
  const out = new Set();
  for (const p of body.split(/[、;；,，／]|\s\/\s/)) {
    const t = p
      .replace(/[〜～]/g, '')
      .replace(/\bA\b|\bB\b/g, '')
      .replace(/[をにがはへとのも\s]/g, '')
      .trim();
    if (t) out.add(t);
  }
  return out;
}

/**
 * 2 つの訳語の語義が 1 つでも重なるか。
 * @param {string | undefined} jaA
 * @param {string | undefined} jaB
 * @returns {boolean}
 */
export function sensesOverlap(jaA, jaB) {
  const b = jaSenses(jaB);
  for (const s of jaSenses(jaA)) {
    if (b.has(s)) return true;
  }
  return false;
}
