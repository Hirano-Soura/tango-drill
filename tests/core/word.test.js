import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, normPos, posParts, jaSenses, sensesOverlap, isPhrase, isVerb, needsTrans, TRANS_VALUES, TRANS_LABEL } from '../../core/word.js';

test('isPhrase: kind が phrase か、品詞に「句」を含む語', () => {
  assert.equal(isPhrase({ kind: 'phrase' }), true);
  assert.equal(isPhrase({ pos: '動詞句' }), true);
  assert.equal(isPhrase({ pos: '名(句で使う)' }), false, '括弧書きの補足は見ない');
  assert.equal(isPhrase({ pos: '名' }), false);
});

test('INV-4: 同じ綴りでも品詞が違えば別の語', () => {
  const a = { en: 'secure', pos: '形', ja: '安全な' };
  const b = { en: 'secure', pos: '動', ja: '確保する' };
  assert.notEqual(keyOf(a), keyOf(b));
});

test('INV-4: 品詞の括弧書きの補足は同一性に影響しない', () => {
  assert.equal(keyOf({ en: 'run', pos: '動(自)' }), keyOf({ en: 'run', pos: '動' }));
  assert.equal(keyOf({ en: 'run', pos: '動（自）' }), keyOf({ en: 'run', pos: '動' }));
});

test('normPos: 品詞が空でも落ちない', () => {
  assert.equal(normPos({}), '');
});

test('posParts: 区切り記号で分解する', () => {
  assert.deepEqual(posParts({ pos: '動/名' }), ['動', '名']);
  assert.deepEqual(posParts({ pos: '形・副' }), ['形', '副']);
  assert.deepEqual(posParts({ pos: '', kind: 'phrase' }), ['句']);
  assert.deepEqual(posParts({}), ['']);
});

test('isVerb / needsTrans: 品詞を分けた中に「動」がある語だけが自他を持つ(動詞句は含めない)', () => {
  assert.equal(isVerb({ pos: '動' }), true);
  assert.equal(isVerb({ pos: '名/動' }), true);
  assert.equal(isVerb({ pos: '動詞句' }), false);
  assert.equal(isVerb({ pos: '名' }), false);
  assert.equal(isVerb({}), false);
  assert.equal(needsTrans({ pos: '動' }), true);
  assert.equal(needsTrans({ pos: '動', trans: 'vt' }), false);
  assert.equal(needsTrans({ pos: '名' }), false);
  assert.equal(needsTrans({ pos: '動詞句' }), false);
});

test('自他の値ごとに、短い印と説明がある(旧版と同じ 他 / 自 / 他自)', () => {
  assert.deepEqual(TRANS_VALUES.map((t) => TRANS_LABEL[t].mark), ['他', '自', '他自']);
  for (const t of TRANS_VALUES) assert.ok(TRANS_LABEL[t].title, t);
});

test('jaSenses: 括弧・プレースホルダ・助詞を落とす', () => {
  assert.deepEqual([...jaSenses('（利息などが）発生する')], ['発生する']);
  assert.deepEqual([...jaSenses('〜に対処する、A を処理する')].sort(), ['処理する', '対処する'].sort());
});

test('sensesOverlap: 語義が重なる語を検出する', () => {
  assert.equal(sensesOverlap('〜に対処する', 'を対処する'), true);
  assert.equal(sensesOverlap('請求書', '旅程表'), false);
  assert.equal(sensesOverlap(undefined, '請求書'), false);
});
