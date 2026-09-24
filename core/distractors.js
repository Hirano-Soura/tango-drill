// 4 択の誤答の選定。ブラウザの API に触れない(INV-6)。
// 登録語が少なくても 4 択を成り立たせるため、誤答専用の内蔵語彙で不足分を補う。
// 内蔵語彙は誤答にだけ使い、問題には出さない(INV-5)。規則は Docs/21_Quiz.md §1・§2・§4。
// 出自: toeic-drill の 単語ドリル.html(quizOptions)。

import { keyOf, normPos, posParts, sensesOverlap } from './word.js';
import { shuffle } from './random.js';

/** @typedef {import('./word.js').Word} Word */

/** 4 択に要る誤答の数 */
export const DISTRACTOR_COUNT = 3;

/** 4 択に要る自分の語の数(正解 1 + 誤答 3)。これ未満では自分の語だけで 4 択を作れない */
export const CHOICE_MIN_OWN = DISTRACTOR_COUNT + 1;

/** (仮)これ以上あれば自分の語だけで誤答を作り、内蔵語彙を使わない。Docs/21_Quiz.md §3 */
export const OWN_ONLY_MIN = 10;

/**
 * 登録語数の段。
 * - empty: 0 語。出題できない
 * - few: 1〜3 語。自分の語だけでは 4 択を作れない
 * - some: 4〜(仮)9 語。自分の語を優先し、足りなければ内蔵語彙で補う
 * - enough: (仮)10 語以上。自分の語だけ
 * @typedef {'empty' | 'few' | 'some' | 'enough'} Tier
 */

/**
 * 誤答を探すときの条件の緩め方。上から順に試し、3 つ揃った段で止まる。
 * - pos: 品詞が 1 つでも重なり、単語か句表現かが同じ
 * - kind: 単語か句表現かが同じ(品詞の一致を緩める)
 * - any: 種別も問わない
 * - senses: 語義の重なりも許す(訳語がまったく同じ語だけは外す)。正解が一意に決まらなくなりうる最後の手段
 * @typedef {'pos' | 'kind' | 'any' | 'senses'} Level
 */

/** @type {readonly Level[]} */
export const LEVELS = Object.freeze(['pos', 'kind', 'any', 'senses']);

/**
 * @typedef {object} Option
 * @property {Word} word
 * @property {boolean} correct 正解の選択肢か
 * @property {'own' | 'builtin'} source 自分の語か内蔵語彙か(正解は常に own)
 */

/**
 * @typedef {object} ChoiceOk
 * @property {true} ok
 * @property {Tier} tier
 * @property {Option[]} options 正解を含む 4 つ。並びは混ぜてある
 * @property {Level} level 誤答を揃えるのに使った、いちばん緩い条件
 */

/**
 * 4 択を作れない理由。
 * - noMeaning: 出題する語に意味(ja)が無い
 * - needBuiltin: 自分の語が 4 語未満で、内蔵語彙を使わない設定(カードなど誤答の要らない形式だけにする)
 * - notEnoughCandidates: 条件をすべて緩めても誤答が 3 つ揃わない
 * @typedef {object} ChoiceNg
 * @property {false} ok
 * @property {Tier} tier
 * @property {'noMeaning' | 'needBuiltin' | 'notEnoughCandidates'} reason
 */

/**
 * @typedef {object} ChoiceOptions
 * @property {readonly Word[]} [builtin] 誤答専用の内蔵語彙
 * @property {boolean} [useBuiltin] 内蔵語彙を使うか(既定: 使う)
 * @property {() => number} [rng] 0 以上 1 未満を返す乱数(既定: Math.random)。テストで固定するために渡す
 */

/** @param {Word} w */
const hasMeaning = (w) => String(w.ja || '').trim() !== '';

/**
 * 句表現か。取り込みは品詞に「句」を含む語に kind を付けるが、付いていない入力でも同じに扱う。
 * @param {Word} w
 */
const isPhrase = (w) => w.kind === 'phrase' || normPos(w).includes('句');

/**
 * 4 択に使える自分の語の数。意味(ja)の無い語は問題にも誤答にも使えないので数えない。
 * @param {readonly Word[]} own
 * @returns {number}
 */
export function usableCount(own) {
  return own.filter(hasMeaning).length;
}

/**
 * 語数の段。
 * @param {number} n 4 択に使える自分の語の数(usableCount)
 * @returns {Tier}
 */
export function tierOf(n) {
  if (n <= 0) return 'empty';
  if (n < CHOICE_MIN_OWN) return 'few';
  if (n < OWN_ONLY_MIN) return 'some';
  return 'enough';
}

/**
 * 段と設定から、出題できる形式を決める(Docs/21_Quiz.md §1 の表)。
 * @param {readonly Word[]} own 自分の単語帳
 * @param {{ builtin?: readonly Word[], useBuiltin?: boolean }} [opts]
 * @returns {{ tier: Tier, card: boolean, choice: boolean }}
 */
export function quizModes(own, opts = {}) {
  const tier = tierOf(usableCount(own));
  const builtin = opts.useBuiltin === false ? [] : opts.builtin || [];
  return {
    tier,
    card: tier !== 'empty',
    choice: tier === 'some' || tier === 'enough' || (tier === 'few' && builtin.length > 0),
  };
}

/**
 * 出題集合のうち、自分の単語帳に無い語(INV-5 の違反)を返す。空なら違反は無い。
 * 自分の語と同じ鍵(INV-4)の語が内蔵語彙にもあるのは違反ではない(利用者が登録した語なので)。
 * @param {readonly Word[]} questions
 * @param {readonly Word[]} own
 * @returns {Word[]}
 */
export function notOwnQuestions(questions, own) {
  const keys = new Set(own.map(keyOf));
  return questions.filter((q) => !keys.has(keyOf(q)));
}

/**
 * 条件の段ごとに、候補が誤答として使えるかを判定する。
 * @param {Level} level
 * @param {Word} target
 */
function fitsLevel(level, target) {
  const tParts = new Set(posParts(target).filter(Boolean));
  const tPhrase = isPhrase(target);
  return (/** @type {Word} */ c) => {
    if (level === 'pos') {
      return isPhrase(c) === tPhrase && posParts(c).some((p) => p && tParts.has(p));
    }
    if (level === 'kind') return isPhrase(c) === tPhrase;
    return true;
  };
}

/**
 * 1 問ぶんの 4 択を作る。出題する語は自分の単語帳の語でなければならない(INV-5)。
 *
 * 誤答の選び方(Docs/21_Quiz.md §1・§2):
 * - 段 few は内蔵語彙だけ、some は自分の語 → 内蔵語彙の順、enough は自分の語だけから選ぶ
 * - 条件は LEVELS の順に緩め、同じ条件の中では自分の語を先に使う
 * - 正解と同じ綴りの語・訳語が同じ語・既に選んだ語と鍵が同じ語は使わない
 * - senses 未満の段では、正解とも既に選んだ誤答とも語義が重ならない語だけを使う
 *
 * @param {Word} target 出題する語
 * @param {readonly Word[]} own 自分の単語帳
 * @param {ChoiceOptions} [opts]
 * @returns {ChoiceOk | ChoiceNg}
 */
export function buildChoices(target, own, opts = {}) {
  const ownKeys = new Set(own.map(keyOf));
  if (!ownKeys.has(keyOf(target))) {
    throw new Error('INV-5: 自分の単語帳に無い語は出題できない: ' + keyOf(target));
  }
  const rng = opts.rng || Math.random;
  const builtin = opts.useBuiltin === false ? [] : opts.builtin || [];
  const tier = tierOf(usableCount(own));
  if (!hasMeaning(target)) return { ok: false, tier, reason: 'noMeaning' };

  /** @type {{ source: 'own' | 'builtin', words: readonly Word[] }[]} */
  let sources;
  if (tier === 'few') {
    if (!builtin.length) return { ok: false, tier, reason: 'needBuiltin' };
    sources = [{ source: 'builtin', words: builtin }];
  } else if (tier === 'some') {
    sources = [{ source: 'own', words: own }, { source: 'builtin', words: builtin }];
  } else {
    sources = [{ source: 'own', words: own }];
  }

  const targetKey = keyOf(target);
  /** @type {Option[]} */
  const picked = [];
  const usedKeys = new Set([targetKey]);
  const usedJa = new Set([String(target.ja).trim()]);
  /** @type {Level} */
  let level = LEVELS[0];

  for (const lv of LEVELS) {
    if (picked.length >= DISTRACTOR_COUNT) break;
    level = lv;
    const fits = fitsLevel(lv, target);
    for (const { source, words } of sources) {
      for (const c of shuffle(words, rng)) {
        if (picked.length >= DISTRACTOR_COUNT) break;
        if (!hasMeaning(c) || c.en === target.en || usedKeys.has(keyOf(c))) continue;
        const ja = String(c.ja).trim();
        if (usedJa.has(ja) || !fits(c)) continue;
        if (lv !== 'senses') {
          if (sensesOverlap(c.ja, target.ja)) continue;
          if (picked.some((p) => sensesOverlap(c.ja, p.word.ja))) continue;
        }
        picked.push({ word: c, correct: false, source });
        usedKeys.add(keyOf(c));
        usedJa.add(ja);
      }
    }
  }

  if (picked.length < DISTRACTOR_COUNT) return { ok: false, tier, reason: 'notEnoughCandidates' };
  const options = shuffle([{ word: target, correct: true, source: /** @type {const} */ ('own') }, ...picked], rng);
  return { ok: true, tier, options, level };
}
