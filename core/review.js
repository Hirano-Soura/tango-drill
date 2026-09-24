// 復習ミックスの出題順と、正誤の記録・集計。ブラウザの API に触れない(INV-6)。
// 出自: toeic-drill の 単語ドリル.html(qAgo / qMiss / qFew / buildQuiz / answerPairs / statOf / statsCsv)。
// 同じ入力・同じ乱数なら既存アプリと同じ出題集合・同じ並びになることを比較テストで確かめている。
// 規則は Docs/21_Quiz.md §5・§6。

import { keyOf, isPhrase } from './word.js';
import { shuffle } from './random.js';

/** @typedef {import('./word.js').Word} Word */
/** @typedef {import('./random.js').Rng} Rng */

/**
 * 復習ミックスの定数(既存アプリと同じ値)。
 * - N1 / N2: 「n 回前」の群に使う回数
 * - M / P: 直近 M 回の回答のうち P 回以上間違えた語を「よく間違える」とする
 * - FEW: 「回答数が少ない」群の上限
 * - KEEP: 語ごとに残す記録の件数
 */
export const REVIEW = Object.freeze({ N1: 1, N2: 3, M: 5, P: 2, FEW: 10, KEEP: 10 });

/**
 * 群と出題順。群の中は混ぜる。few だけは回答数の少ない順を保つ(途中でやめても、最も測れていない語から消化できる)。
 * @typedef {'today' | 'd1' | 'd3' | 'miss' | 'few'} Group
 */
/** @type {readonly Group[]} */
export const GROUP_ORDER = Object.freeze(['today', 'd1', 'd3', 'miss', 'few']);

/**
 * 回。日付(YYYY-MM-DD)と語の組。単語帳で何を 1 回とするかは Docs/50_Tasks.md の未決定事項。
 * @typedef {object} Session
 * @property {string} date
 * @property {readonly Word[]} items
 */

/**
 * 正誤の記録。語の鍵(INV-4)ごとに、古い順の配列で直近 KEEP 件まで持つ。
 * hist は 1 = 正解 / 0 = 誤答、self は第 1 段階の自己申告で 1 = わかる / 0 = わからない。
 * self は hist と同時に積むが、自己申告を導入する前の記録には対応する self が無い(hist の方が長くなりうる)。
 * @typedef {object} Records
 * @property {Readonly<Record<string, readonly number[]>>} hist
 * @property {Readonly<Record<string, readonly number[]>>} self
 */

/**
 * @typedef {object} Question
 * @property {Word} word
 * @property {Group} group
 */

/**
 * @typedef {object} MixOptions
 * @property {string} today 今日の日付(YYYY-MM-DD)
 * @property {Rng} [rng] 既定は Math.random
 * @property {'all' | 'word' | 'phrase'} [kind] 出題する種別(既定: all)
 */

/** @returns {Records} */
export function emptyRecords() {
  return { hist: {}, self: {} };
}

/**
 * 1 回分の正誤と自己申告を記録した新しい Records を返す。渡した Records は変えない。
 * 正誤と自己申告は必ずこの関数で同時に積む(片方だけ積むと対応が崩れる)。
 * @param {Records} records
 * @param {string} key 語の鍵(keyOf)
 * @param {boolean} ok 正解したか
 * @param {boolean} self 第 1 段階で「わかる」と申告したか
 * @returns {Records}
 */
export function recordAnswer(records, key, ok, self) {
  const push = (/** @type {readonly number[] | undefined} */ a, /** @type {number} */ v) => [...(a || []), v].slice(-REVIEW.KEEP);
  return {
    hist: { ...records.hist, [key]: push(records.hist[key], ok ? 1 : 0) },
    self: { ...records.self, [key]: push(records.self[key], self ? 1 : 0) },
  };
}

/**
 * 語の総回答回数(記録の件数)。
 * @param {Records} records
 * @param {string} key
 */
export function answerCount(records, key) {
  return (records.hist[key] || []).length;
}

/**
 * 直近 M 回の回答のうち P 回以上間違えたか。
 * @param {Records} records
 * @param {string} key
 */
export function missOften(records, key) {
  return (records.hist[key] || []).slice(-REVIEW.M).filter((x) => x === 0).length >= REVIEW.P;
}

/**
 * 語のある回だけを日付の昇順で返す。
 * @param {readonly Session[]} sessions
 * @returns {Session[]}
 */
export function sessionsAsc(sessions) {
  return byDate(sessions).filter((s) => s.items.length);
}

/**
 * @param {readonly Session[]} sessions
 * @returns {Session[]}
 */
function byDate(sessions) {
  return sessions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 基準の回(今日以前で最も新しい回)の位置。無ければ -1。
 * 明日の分が既にあっても、それを「今日」として扱わない。
 * @param {readonly Session[]} sessions
 * @param {string} today
 */
export function baseIndex(sessions, today) {
  let i = -1;
  sessionsAsc(sessions).forEach((s, k) => { if (s.date <= today) i = k; });
  return i;
}

/**
 * n 回前の回の語。0 は基準の回そのもの。回で数えるので、学習しなかった日があっても前の回を拾える。
 * @param {readonly Session[]} sessions
 * @param {string} today
 * @param {number} n
 * @returns {Word[]}
 */
export function sessionAgo(sessions, today, n) {
  const ss = sessionsAsc(sessions);
  const i = baseIndex(sessions, today) - n;
  return i >= 0 && i < ss.length ? ss[i].items.slice() : [];
}

/**
 * 基準の回の日付。回が無ければ null。画面はこれが今日なら「今日」、違えば「直近(M/D)」と出す。
 * @param {readonly Session[]} sessions
 * @param {string} today
 * @returns {string | null}
 */
export function baseDate(sessions, today) {
  const i = baseIndex(sessions, today);
  return i < 0 ? null : sessionsAsc(sessions)[i].date;
}

/**
 * 復習ミックスの出題集合と出題順(Docs/21_Quiz.md §5)。
 * 群を GROUP_ORDER の順に並べ、先の群に入った語(鍵で比べる)は後の群に入れない。
 * @param {readonly Session[]} sessions
 * @param {Records} records
 * @param {MixOptions} opts
 * @returns {Question[]}
 */
export function reviewMix(sessions, records, opts) {
  const rng = opts.rng || Math.random;
  const kind = opts.kind || 'all';
  const filterKind = (/** @type {Word[]} */ a) =>
    kind === 'all' ? a : a.filter((w) => isPhrase(w) === (kind === 'phrase'));
  const all = byDate(sessions).flatMap((s) => s.items);
  const ago = (/** @type {number} */ n) => sessionAgo(sessions, opts.today, n);
  const miss = all.filter((w) => missOften(records, keyOf(w)));

  const covered = new Set([ago(0), ago(REVIEW.N1), ago(REVIEW.N2), miss].flat().map(keyOf));
  // 既存アプリと同じく、few の候補を先に混ぜてから回答数で並べる(同数の語を散らすため)。乱数を引く順序も揃えてある
  const few = shuffle(all, rng)
    .filter((w) => !covered.has(keyOf(w)))
    .sort((a, b) => answerCount(records, keyOf(a)) - answerCount(records, keyOf(b)))
    .slice(0, REVIEW.FEW);

  /** @type {Record<Group, Word[]>} */
  const groups = {
    today: filterKind(ago(0)),
    d1: filterKind(ago(REVIEW.N1)),
    d3: filterKind(ago(REVIEW.N2)),
    miss: filterKind(miss),
    few: filterKind(few),
  };
  const seen = new Set();
  /** @type {Question[]} */
  const out = [];
  for (const g of GROUP_ORDER) {
    const list = g === 'few' ? groups[g] : shuffle(groups[g], rng);
    for (const w of list) {
      const k = keyOf(w);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ word: w, group: g });
    }
  }
  return out;
}

// --- 集計 ------------------------------------------------------------------------------------

/**
 * @typedef {object} AnswerPair
 * @property {boolean} ok
 * @property {boolean | null} self 自己申告。導入前の記録なら null
 */

/**
 * 正誤と自己申告を 1 回ずつ対にする。自己申告の無い古い記録があるので、末尾から揃える
 * (先頭から揃えると、古い正誤に新しい自己申告が結び付いて「思い違い」の数が狂う)。
 * @param {Records} records
 * @param {string} key
 * @returns {AnswerPair[]}
 */
export function answerPairs(records, key) {
  const h = records.hist[key] || [];
  const sf = records.self[key] || [];
  const off = h.length - sf.length;
  return h.map((x, i) => {
    const j = i - off;
    return { ok: x === 1, self: j >= 0 && j < sf.length ? sf[j] === 1 : null };
  });
}

/**
 * 語ごとの集計。思い違い(mis)は「わかる」と申告して外した回数。
 * @typedef {object} Stat
 * @property {Word} w
 * @property {string} key
 * @property {AnswerPair[]} pairs
 * @property {number} n 回答数
 * @property {number} correct
 * @property {number} wrong
 * @property {number} mis 思い違い
 * @property {number} said 「わかる」と申告した回数
 * @property {number} unknown 「わからない」と申告した回数
 * @property {number | null} acc 正答率(回答が無ければ null)
 * @property {number | null} misRate 思い違い率 = mis / said(申告が無ければ null)
 * @property {boolean} starred 利用者が印を付けた語
 * @property {boolean} often よく間違える語(missOften)
 */

/**
 * @param {Word} w
 * @param {Records} records
 * @param {ReadonlySet<string>} [starred] 印を付けた語の鍵
 * @returns {Stat}
 */
export function statOf(w, records, starred = new Set()) {
  const key = keyOf(w);
  const pairs = answerPairs(records, key);
  let correct = 0, wrong = 0, mis = 0, said = 0, unknown = 0;
  for (const p of pairs) {
    if (p.ok) correct++; else wrong++;
    if (p.self === true) { said++; if (!p.ok) mis++; }
    else if (p.self === false) unknown++;
  }
  const n = pairs.length;
  return {
    w, key, pairs, n, correct, wrong, mis, said, unknown,
    acc: n ? correct / n : null,
    misRate: said ? mis / said : null,
    starred: starred.has(key),
    often: missOften(records, key),
  };
}

/**
 * 語ごとの集計の一覧。同じ鍵の語は最初の 1 つだけ。
 * @param {readonly Word[]} words
 * @param {Records} records
 * @param {ReadonlySet<string>} [starred]
 * @returns {Stat[]}
 */
export function allStats(words, records, starred) {
  const seen = new Set();
  /** @type {Stat[]} */
  const out = [];
  for (const w of words) {
    const k = keyOf(w);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(statOf(w, records, starred));
  }
  return out;
}

/**
 * 語が最初に出た回の日付。鍵 → 日付。
 * @param {readonly Session[]} sessions
 * @returns {Map<string, string>}
 */
export function firstDates(sessions) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const s of byDate(sessions)) {
    for (const w of s.items) {
      const k = keyOf(w);
      if (!m.has(k)) m.set(k, s.date);
    }
  }
  return m;
}

/**
 * 並び替えの種類。
 * - mis: 思い違い率の高い順(申告の無い語は最後)。同率なら思い違いの回数の多い順
 * - wrong: 誤答の多い順。同数なら誤答率の高い順
 * - few: 回答の少ない順
 * - date: 最初に出た日の新しい順
 * @typedef {'mis' | 'wrong' | 'few' | 'date'} StatSort
 */

/**
 * 並べ替えた写しを返す。同順位の並びは元の順を保つ。
 * @param {readonly Stat[]} stats
 * @param {StatSort} by
 * @param {Map<string, string>} [dates] firstDates の結果(date のときに使う)
 * @returns {Stat[]}
 */
export function sortStats(stats, by, dates = new Map()) {
  return stats.slice().sort((a, b) => {
    if (by === 'mis') {
      const am = a.misRate == null ? -1 : a.misRate;
      const bm = b.misRate == null ? -1 : b.misRate;
      if (bm !== am) return bm - am;
      return b.mis - a.mis;
    }
    if (by === 'wrong') {
      if (b.wrong !== a.wrong) return b.wrong - a.wrong;
      return (b.acc == null ? 0 : 1 - b.acc) - (a.acc == null ? 0 : 1 - a.acc);
    }
    if (by === 'few') return a.n - b.n;
    const ad = dates.get(a.key) || '';
    const bd = dates.get(b.key) || '';
    return ad < bd ? 1 : ad > bd ? -1 : 0;
  });
}

/** 正誤の CSV の列(既存アプリと同じ) */
export const CSV_COLUMNS = Object.freeze([
  'en', 'pos', 'trans', 'ja', 'kind', 'key', 'firstDate',
  'answers', 'correct', 'wrong', 'accuracy', 'misbelief', 'saidKnown', 'misbeliefRate', 'unknown',
  'history', 'self', 'starred', 'oftenWrong',
]);

/**
 * CSV の 1 セル。区切り・引用符・改行を含むなら引用符で囲む。
 * @param {unknown} v
 */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** @param {number | null} x */
const round3 = (x) => (x == null ? '' : Math.round(x * 1000) / 1000);

/**
 * 正誤の CSV(改行は CRLF)。Excel 向けの BOM は付けない(ファイルに書き出す画面側で付ける)。
 * @param {readonly Stat[]} stats
 * @param {Map<string, string>} [dates] firstDates の結果
 * @returns {string}
 */
export function statsCsv(stats, dates = new Map()) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const x of stats) {
    const w = x.w;
    lines.push([
      w.en, w.pos || '', w.trans || '', w.ja || '', w.kind || '', x.key, dates.get(x.key) || '',
      x.n, x.correct, x.wrong, round3(x.acc),
      x.mis, x.said, round3(x.misRate), x.unknown,
      x.pairs.map((p) => (p.ok ? 1 : 0)).join(' '),
      x.pairs.map((p) => (p.self == null ? '-' : p.self ? 1 : 0)).join(' '),
      x.starred ? 1 : 0, x.often ? 1 : 0,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}
