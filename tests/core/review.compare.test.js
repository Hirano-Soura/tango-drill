// T-3: 既存アプリ(toeic-drill)と同じ入力で同じ出題集合・同じ集計が出ることの比較テスト。
// 既存アプリの実装は tests/core/fixtures/legacy/toeicDrillReview.js(Tools/Legacy/extract_review.mjs が
// 元の HTML から行をそのまま抜き出したもの)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLegacy } from './fixtures/legacy/toeicDrillReview.js';
import { keyOf } from '../../core/word.js';
import {
  reviewMix, recordAnswer, allStats, statsCsv, sortStats, firstDates, emptyRecords,
} from '../../core/review.js';

/** @typedef {import('../../core/word.js').Word} Word */
/** @typedef {import('../../core/review.js').Records} Records */

/** @param {number} seed */
function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 語の元。同じ綴りで品詞の違う語(secure)を含む */
const WORDS = [
  ['invoice', '名', '請求書'], ['itinerary', '名', '旅程表'], ['reimburse', '動', '払い戻す'],
  ['warranty', '名', '保証'], ['inquiry', '名', '問い合わせ'], ['estimate', '名/動', '見積もり'],
  ['secure', '形', '安全な'], ['secure', '動', '確保する'], ['postpone', '動', '延期する'],
  ['allocate', '動', '割り当てる'], ['tentative', '形', '仮の'], ['venue', '名', '会場'],
  ['budget', '名', '予算'], ['merger', '名', '合併'], ['expand', '動', '拡大する'],
  ['negotiate', '動', '交渉する'], ['submit', '動', '提出する'], ['receipt', '名', '領収書'],
];
const PHRASES = [
  ['deal with A', '動詞句', 'A に対処する'], ['in charge of A', '形容詞句', 'A を担当して'],
  ['on behalf of A', '前置詞句', 'A の代わりに'], ['take over A', '動詞句', 'A を引き継ぐ'],
  ['look into A', '動詞句', 'A を調べる'], ['carry out A', '動詞句', 'A を実行する'],
];

/**
 * 乱数で作った入力一式。回の間の空き・明日の回・語の無い回・回をまたいだ同じ語・自己申告の短い記録を含みうる。
 * @param {number} seed
 */
function scenario(seed) {
  const r = rngOf(seed * 7919);
  const int = (/** @type {number} */ n) => Math.floor(r() * n);
  const pick = (/** @type {string[][]} */ src) => {
    const [en, pos, ja] = src[int(src.length)];
    return { en, pos, ja };
  };
  const nDays = int(9);
  /** @type {{ date: string, words: object[], phrases: object[] }[]} */
  const days = [];
  let day = 1 + int(3);
  for (let i = 0; i < nDays; i++) {
    const date = `2026-07-${String(day).padStart(2, '0')}`;
    const words = Array.from({ length: int(6) }, () => pick(WORDS));
    const phrases = Array.from({ length: int(3) }, () => pick(PHRASES));
    days.push({ date, words, phrases });
    day += 1 + int(3);
  }
  // 最後の回の前後に今日を置く(明日の回がある場合を含める)
  const last = days.length ? Number(days[days.length - 1].date.slice(-2)) : 5;
  const today = `2026-07-${String(Math.max(1, last - int(3))).padStart(2, '0')}`;

  /** @type {Record<string, number[]>} */ const hist = {};
  /** @type {Record<string, number[]>} */ const self = {};
  /** @type {Record<string, number>} */ const weak = {};
  const all = [...WORDS.map(([en, pos]) => en + '|' + pos), ...PHRASES.map(([en, pos]) => en + '|' + pos)];
  for (const k of all) {
    const n = int(4) === 0 ? 0 : int(11);
    if (n) hist[k] = Array.from({ length: n }, () => (r() < 0.6 ? 1 : 0));
    if (n) self[k] = hist[k].slice(int(3) === 0 ? int(n + 1) : 0).map(() => (r() < 0.7 ? 1 : 0));
    if (int(6) === 0) weak[k] = 1;
  }
  const kind = /** @type {const} */ (['all', 'all', 'word', 'phrase'])[int(4)];
  return { days, today, hist, self, weak, kind };
}

/** @param {ReturnType<typeof scenario>} s @param {number} seed */
function legacyOf(s, seed) {
  return makeLegacy({
    days: JSON.parse(JSON.stringify(s.days)),
    storage: {
      toeic_vocab_hist: JSON.stringify(s.hist),
      toeic_vocab_self: JSON.stringify(s.self),
      toeic_vocab_weak: JSON.stringify(s.weak),
    },
    today: s.today,
    random: rngOf(seed),
    kind: s.kind,
  });
}

/**
 * 既存アプリが組み立てた回の一覧を、そのまま新しい実装の入力にする(同じ入力であることを保証する)。
 * @param {ReturnType<typeof makeLegacy>} legacy
 */
const sessionsOf = (legacy) =>
  legacy.daysData().map((/** @type {{ date: string, items: Word[] }} */ d) => ({ date: d.date, items: d.items }));

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

test('T-3: 復習ミックスの出題集合と出題順が既存アプリと一致する(同じ入力・同じ乱数)', () => {
  const seen = { today: 0, d1: 0, d3: 0, miss: 0, few: 0, future: 0, gap: 0, shortSelf: 0, empty: 0 };
  for (const seed of SEEDS) {
    const s = scenario(seed);
    const legacy = legacyOf(s, seed);
    const sessions = sessionsOf(legacy);
    const expected = legacy.buildQuiz().map((/** @type {any} */ w) => [keyOf(w), w.quizGroup]);
    const actual = reviewMix(sessions, { hist: s.hist, self: s.self }, { today: s.today, rng: rngOf(seed), kind: s.kind })
      .map((q) => [keyOf(q.word), q.group]);
    assert.deepEqual(actual, expected, `seed ${seed}`);

    for (const [, g] of expected) seen[/** @type {keyof typeof seen} */ (g)]++;
    if (s.days.some((d) => d.date > s.today)) seen.future++;
    if (sessions.some((d) => !d.items.length)) seen.empty++;
    if (Object.keys(s.self).some((k) => s.self[k].length < s.hist[k].length)) seen.shortSelf++;
    if (sessions.length >= 2) seen.gap++;
  }
  // 比較が各群・各場面を実際に通ったこと(UV-1)
  for (const [k, n] of Object.entries(seen)) assert.ok(n > 0, `${k} を通った入力が無い`);
});

test('T-3: 語ごとの集計・CSV・並べ替えが既存アプリと一致する', () => {
  for (const seed of SEEDS) {
    const s = scenario(seed);
    const legacy = legacyOf(s, seed);
    const sessions = sessionsOf(legacy);
    const records = { hist: s.hist, self: s.self };
    const starred = new Set(Object.keys(s.weak));
    const words = sessions.flatMap((d) => d.items);
    const stats = allStats(words, records, starred);
    const old = legacy.allStats();

    const pick = (/** @type {any} */ x, /** @type {boolean} */ star) => ({
      key: x.key, pairs: x.pairs, n: x.n, correct: x.correct, wrong: x.wrong, mis: x.mis, said: x.said,
      unknown: x.unknown, acc: x.acc, misRate: x.misRate, starred: star, often: x.often,
    });
    assert.deepEqual(stats.map((x) => pick(x, x.starred)), old.map((/** @type {any} */ x) => pick(x, x.weak)), `seed ${seed}`);
    assert.equal(statsCsv(stats, firstDates(sessions)), legacy.statsCsv(), `CSV seed ${seed}`);
    for (const by of /** @type {const} */ (['mis', 'wrong', 'few', 'date'])) {
      assert.deepEqual(
        sortStats(stats, by, firstDates(sessions)).map((x) => x.key),
        legacy.sortRows(old.slice(), by).map((/** @type {any} */ x) => x.key),
        `sort ${by} seed ${seed}`,
      );
    }
  }
});

test('T-3: 正誤と自己申告の記録の積み方(直近 10 件)が既存アプリと一致する', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const s = scenario(seed);
    const legacy = legacyOf(s, seed);
    /** @type {Records} */
    let records = { hist: s.hist, self: s.self };
    const r = rngOf(seed + 1);
    const keys = Object.keys(s.hist).concat(['new|名']);
    for (let i = 0; i < 40; i++) {
      const k = keys[Math.floor(r() * keys.length)];
      const ok = r() < 0.5, self = r() < 0.5;
      legacy.recordAnswer(k, ok, self);
      records = recordAnswer(records, k, ok, self);
    }
    assert.deepEqual(records.hist, JSON.parse(legacy.storage.toeic_vocab_hist), `hist seed ${seed}`);
    assert.deepEqual(records.self, JSON.parse(legacy.storage.toeic_vocab_self), `self seed ${seed}`);
  }
});

test('T-3 陽性対照: 記録が違う入力では比較が食い違う(比較が結果を実際に見ていること)', () => {
  let differs = 0;
  for (const seed of SEEDS.slice(0, 100)) {
    const s = scenario(seed);
    const legacy = legacyOf(s, seed);
    const expected = legacy.buildQuiz().map((/** @type {any} */ w) => keyOf(w));
    // 記録を空にした入力(「よく間違える」「回答数が少ない」が変わる)を新しい実装に渡す
    const actual = reviewMix(sessionsOf(legacy), emptyRecords(), { today: s.today, rng: rngOf(seed), kind: s.kind })
      .map((q) => keyOf(q.word));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) differs++;
  }
  assert.ok(differs > 0);
});
