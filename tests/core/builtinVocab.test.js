import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_VOCAB } from '../../core/builtinVocab.js';
import { buildChoices } from '../../core/distractors.js';
import { keyOf } from '../../core/word.js';

/** Docs/21_Quiz.md §4 の項目 */
const FIELDS = ['en', 'pos', 'ja', 'kind'];

test('T-2.1: 内蔵語彙は 495 語(toeic-drill の単語データを鍵で重複を除いた数)', () => {
  assert.equal(BUILTIN_VOCAB.length, 495);
  assert.equal(new Set(BUILTIN_VOCAB.map(keyOf)).size, 495, '鍵の重複が無い');
});

/**
 * 項目の検査。問題のある語ごとに 1 行を返す。
 * @param {readonly Record<string, unknown>[]} words
 * @returns {string[]}
 */
function fieldProblems(words) {
  const out = [];
  for (const w of words) {
    const extra = Object.keys(w).filter((k) => !FIELDS.includes(k));
    if (extra.length) out.push(`${w.en}: 余計な項目 ${extra.join(' ')}`);
    if (!(w.en && w.pos && w.ja)) out.push(`${w.en}: 欠けている項目がある`);
    if (w.kind !== undefined && w.kind !== 'phrase') out.push(`${w.en}: kind が phrase でない`);
  }
  return out;
}

test('T-2.1: どの語も §4 の項目だけを持ち、見出し語・品詞・意味がある', () => {
  assert.deepEqual(fieldProblems(BUILTIN_VOCAB), []);
});

test('T-2.1 陽性対照: 同じ検査が、余計な項目・欠けた項目・使えない kind を見つけられる', () => {
  const planted = [
    ...BUILTIN_VOCAB,
    { en: 'x', pos: '名', ja: '甲', ex: 'An example.' },
    { en: 'y', pos: '名' },
    { en: 'z', pos: '名', ja: '乙', kind: 'word' },
  ];
  assert.deepEqual(fieldProblems(planted), ['x: 余計な項目 ex', 'y: 欠けている項目がある', 'z: kind が phrase でない']);
});

test('内蔵語彙は書き換えられない', () => {
  assert.throws(() => { /** @type {any} */ (BUILTIN_VOCAB).push({ en: 'x' }); }, TypeError);
  assert.throws(() => { /** @type {any} */ (BUILTIN_VOCAB[0]).ja = 'x'; }, TypeError);
});

test('1 語だけの単語帳でも、内蔵語彙のどの語と同じ語を登録しても 4 択が作れ、品詞の揃う誤答が選ばれる', () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const levels = /** @type {Record<string, number>} */ ({});
  for (const w of BUILTIN_VOCAB) {
    const mine = { ...w };
    const r = buildChoices(mine, [mine], { builtin: BUILTIN_VOCAB, rng });
    if (!r.ok) assert.fail(`${w.en}: ${r.reason}`);
    assert.ok(r.options.filter((o) => !o.correct).every((o) => o.source === 'builtin'));
    levels[r.level] = (levels[r.level] || 0) + 1;
  }
  assert.equal(levels.pos, BUILTIN_VOCAB.length, JSON.stringify(levels));
});
