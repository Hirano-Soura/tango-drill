// 単語帳の絞り込み(Docs/23_Screens.md §1)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterWords, searchTokens } from '../../core/search.js';
import { POS_NAMES } from '../../core/word.js';
import { normalizePos } from '../../core/importFormat.js';

/** @typedef {import('../../core/word.js').Word} Word */

/** @type {Word[]} */
const WORDS = [
  { en: 'apple', pos: '名', ja: 'リンゴ' },
  { en: 'allocate', pos: '動', trans: 'vt', ja: '割り当てる' },
  { en: 'secure', pos: '形/動', ja: '安全な；確保する' },
  { en: 'name', pos: '名/動', ja: '名前；名付ける' },
  { en: 'despite', pos: '前', ja: '～にもかかわらず' },
  { en: 'in accordance with', pos: '前置詞句', ja: '～に従って', kind: 'phrase' },
  { en: 'no later than', pos: '前置詞句/副詞句', ja: '遅くとも～までに', kind: 'phrase' },
  { en: 'deal with', pos: '動詞句', ja: '～に対処する', kind: 'phrase' },
  { en: 'as a rule', ja: '概して', kind: 'phrase' },
  { en: 'appoint', pos: '他動詞', ja: '任命する' },
  { en: 'it', pos: '代名詞', ja: 'それ' },
  { en: 'quickly', pos: '副', ja: '速く' },
  { en: 'available', pos: '形(叙述)', ja: '利用できる' },
];

/** @param {string} q */
const ens = (q) => filterWords(WORDS, q).map((w) => w.en);

test('空の絞り込みはすべての語を元の並びで返す', () => {
  assert.deepEqual(ens(''), WORDS.map((w) => w.en));
  assert.deepEqual(ens('   '), WORDS.map((w) => w.en));
});

test('見出し語(大文字小文字を区別しない)と意味の部分一致', () => {
  assert.deepEqual(ens('APP'), ['apple', 'appoint']);
  assert.deepEqual(ens('リンゴ'), ['apple']);
  assert.deepEqual(ens('対処'), ['deal with']);
  assert.deepEqual(ens('zzz'), []);
});

test('空白で区切ると AND。半角・全角の空白と連続した空白を区切りにする', () => {
  assert.deepEqual(searchTokens(' a  b　c '), ['a', 'b', 'c']);
  assert.deepEqual(ens('with'), ['in accordance with', 'deal with']);
  assert.deepEqual(ens('with 従'), ['in accordance with']);
  assert.deepEqual(ens('with　従'), ['in accordance with']);
  assert.deepEqual(ens('with 従 zzz'), []);
  // 見出し語の空白をまたぐ語は 2 語に分かれる(それぞれ見出し語に含まれれば当たる)
  assert.deepEqual(ens('deal with'), ['deal with']);
});

test('品詞の名前で、その品詞を持つ語が並ぶ(複数の品詞を持つ語も当たる)', () => {
  assert.deepEqual(ens('名詞'), ['apple', 'name']);
  assert.deepEqual(ens('副詞'), ['no later than', 'quickly']);
  assert.deepEqual(ens('形容詞'), ['secure', 'available']);
  // 品詞のかっこ書きは落として見る
  assert.deepEqual(ens('代名詞'), ['it']);
});

test('品詞の名前は、その品詞の句にも当たる(前置詞 → 前置詞と前置詞句)', () => {
  assert.deepEqual(ens('前置詞'), ['despite', 'in accordance with', 'no later than']);
  // 動詞: 略号の「動」・略さない「他動詞」・動詞句
  assert.deepEqual(ens('動詞'), ['allocate', 'secure', 'name', 'deal with', 'appoint']);
});

test('品詞の名前は、表に無い略さない品詞でも名前を含めば当たる(自動詞・助動詞・固有名詞)', () => {
  /** @type {Word[]} */
  const more = [{ en: 'occur', pos: '自動詞' }, { en: 'can', pos: '助動詞' }, { en: 'Tokyo', pos: '固有名詞' }, { en: 'it', pos: '代名詞' }];
  assert.deepEqual(filterWords(more, '動詞').map((w) => w.en), ['occur', 'can']);
  assert.deepEqual(filterWords(more, '名詞').map((w) => w.en), ['Tokyo']);
});

test('「名詞」は「代名詞」に当たらない(略号に揃えてから比べる)', () => {
  assert.equal(ens('名詞').includes('it'), false);
});

test('句の名前(前置詞句・動詞句 など)はその句だけに当たる', () => {
  assert.deepEqual(ens('前置詞句'), ['in accordance with', 'no later than']);
  assert.deepEqual(ens('動詞句'), ['deal with']);
  assert.deepEqual(ens('副詞句'), ['no later than']);
});

test('「句表現」で句表現が並ぶ(品詞の無い句表現も)', () => {
  assert.deepEqual(ens('句表現'), ['in accordance with', 'no later than', 'deal with', 'as a rule']);
});

test('「単語」で句表現でない語が並ぶ', () => {
  assert.deepEqual(ens('単語'), ['apple', 'allocate', 'secure', 'name', 'despite', 'appoint', 'it', 'quickly', 'available']);
  assert.deepEqual(ens('単語 前置詞'), ['despite']);
});

test('品詞・句表現と、見出し語・意味を AND で組める', () => {
  assert.deepEqual(ens('句表現 with'), ['in accordance with', 'deal with']);
  assert.deepEqual(ens('前置詞 従'), ['in accordance with']);
  assert.deepEqual(ens('名詞 名前'), ['name']);
  assert.deepEqual(ens('動詞 句表現'), ['deal with']);
});

test('略号 1 字や英語の別名では品詞として絞り込まない(見出し語・意味の一致だけ)', () => {
  // 「名」は意味の「名前」に当たるだけで、名詞の apple は出ない
  assert.deepEqual(ens('名'), ['name']);
  // 「noun」は品詞として読まない
  assert.deepEqual(ens('noun'), []);
});

test('品詞の名前の表は、取り込みの別名の正規化と同じ略号に揃う(SSOT)', () => {
  for (const [code, name] of Object.entries(POS_NAMES)) assert.equal(normalizePos(name), code);
});
