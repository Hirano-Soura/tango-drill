import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf } from '../../core/word.js';
import {
  buildChoices, quizModes, tierOf, usableCount, notOwnQuestions,
  CHOICE_MIN_OWN, OWN_ONLY_MIN, DISTRACTOR_COUNT,
} from '../../core/distractors.js';

/** @typedef {import('../../core/word.js').Word} Word */
/** @typedef {import('../../core/distractors.js').ChoiceOk} ChoiceOk */

/**
 * 種を固定した乱数(mulberry32)。同じ種なら同じ並びになる。
 * @param {number} seed
 */
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

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

/** 誤答専用の内蔵語彙の見本(名詞 4・動詞 3・句 3) */
/** @type {Word[]} */
const BUILTIN = [
  { en: 'invoice', pos: '名', ja: '請求書' },
  { en: 'itinerary', pos: '名', ja: '旅程表' },
  { en: 'warranty', pos: '名', ja: '保証' },
  { en: 'inquiry', pos: '名', ja: '問い合わせ' },
  { en: 'reimburse', pos: '動', ja: '払い戻す' },
  { en: 'postpone', pos: '動', ja: '延期する' },
  { en: 'allocate', pos: '動', ja: '割り当てる' },
  { en: 'deal with A', pos: '動詞句', kind: 'phrase', ja: 'A に対処する' },
  { en: 'in charge of A', pos: '形容詞句', kind: 'phrase', ja: 'A を担当して' },
  { en: 'on behalf of A', pos: '前置詞句', kind: 'phrase', ja: 'A の代わりに' },
];

/** 自分の語の見本。名詞 */
/** @type {Word[]} */
const OWN_NOUNS = [
  { en: 'budget', pos: '名', ja: '予算' },
  { en: 'merger', pos: '名', ja: '合併' },
  { en: 'venue', pos: '名', ja: '会場' },
  { en: 'receipt', pos: '名', ja: '領収書' },
  { en: 'deadline', pos: '名', ja: '締め切り' },
  { en: 'shipment', pos: '名', ja: '発送品' },
];

/** 自分の語の見本。動詞 */
/** @type {Word[]} */
const OWN_VERBS = [
  { en: 'expand', pos: '動', ja: '拡大する' },
  { en: 'negotiate', pos: '動', ja: '交渉する' },
  { en: 'submit', pos: '動', ja: '提出する' },
  { en: 'confirm', pos: '動', ja: '確かめる' },
  { en: 'hire', pos: '動', ja: '雇う' },
  { en: 'renovate', pos: '動', ja: '改装する' },
  { en: 'launch', pos: '動', ja: '売り出す' },
  { en: 'attend', pos: '動', ja: '出席する' },
  { en: 'recommend', pos: '動', ja: '勧める' },
];

/**
 * @param {Word} target
 * @param {Word[]} own
 * @param {import('../../core/distractors.js').ChoiceOptions} [opts]
 * @returns {ChoiceOk}
 */
function okChoices(target, own, opts) {
  const r = buildChoices(target, own, opts);
  if (!r.ok) assert.fail('4 択が作れなかった: ' + r.reason);
  return r;
}

/** @param {ChoiceOk} r */
const distractorsOf = (r) => r.options.filter((o) => !o.correct);

/**
 * 4 択の形の不変条件: 4 つ・正解はちょうど 1 つで出題した語・誤答はすべて別の鍵で訳語も別。
 * @param {ChoiceOk} r
 * @param {Word} target
 */
function assertWellFormed(r, target) {
  assert.equal(r.options.length, DISTRACTOR_COUNT + 1);
  const correct = r.options.filter((o) => o.correct);
  assert.equal(correct.length, 1);
  assert.equal(correct[0].word, target);
  assert.equal(correct[0].source, 'own');
  assert.equal(new Set(r.options.map((o) => keyOf(o.word))).size, 4, '鍵の重なる選択肢が無い');
  assert.equal(new Set(r.options.map((o) => o.word.ja)).size, 4, '同じ訳語の選択肢が無い');
  for (const d of distractorsOf(r)) assert.notEqual(d.word.en, target.en, '同じ綴りの語を誤答にしない');
}

// --- 語数の段 -----------------------------------------------------------------------------

test('tierOf: 段の境界は 0 / 1〜3 / 4〜(仮)9 / (仮)10 以上', () => {
  assert.equal(CHOICE_MIN_OWN, 4);
  assert.equal(OWN_ONLY_MIN, 10);
  assert.equal(tierOf(0), 'empty');
  assert.equal(tierOf(1), 'few');
  assert.equal(tierOf(CHOICE_MIN_OWN - 1), 'few');
  assert.equal(tierOf(CHOICE_MIN_OWN), 'some');
  assert.equal(tierOf(OWN_ONLY_MIN - 1), 'some');
  assert.equal(tierOf(OWN_ONLY_MIN), 'enough');
  assert.equal(tierOf(500), 'enough');
});

test('usableCount: 意味の無い語は 4 択に使えないので数えない', () => {
  assert.equal(usableCount([{ en: 'a', ja: '甲' }, { en: 'b' }, { en: 'c', ja: '  ' }]), 1);
});

test('quizModes: Docs/21_Quiz.md §1 の表(語数の段 × 内蔵語彙の有無)', () => {
  const own = (/** @type {number} */ n) => [...OWN_NOUNS, ...OWN_VERBS].slice(0, n);
  const rows = [
    // [語数, 内蔵語彙を使う, card, choice]
    [0, true, false, false],
    [0, false, false, false],
    [1, true, true, true],
    [3, true, true, true],
    [1, false, true, false],
    [3, false, true, false],
    [4, true, true, true],
    [9, true, true, true],
    [4, false, true, true],
    [9, false, true, true],
    [10, true, true, true],
    [10, false, true, true],
  ];
  for (const [n, use, card, choice] of rows) {
    const m = quizModes(own(/** @type {number} */ (n)), { builtin: BUILTIN, useBuiltin: /** @type {boolean} */ (use) });
    assert.deepEqual({ card: m.card, choice: m.choice }, { card, choice }, `語数 ${n}・内蔵語彙 ${use}`);
  }
  assert.equal(quizModes(own(2), {}).choice, false, '内蔵語彙が空なら、使う設定でも 1〜3 語では 4 択にしない');
  assert.equal(quizModes([{ en: 'itinerary' }]).tier, 'empty', '意味の無い語だけなら出題できない');
});

// --- 段ごとの誤答の出どころ -------------------------------------------------------------------

test('段 empty: 意味の無い語は 4 択にできない', () => {
  const target = { en: 'itinerary' };
  const r = buildChoices(target, [target], { builtin: BUILTIN, rng: rngOf(1) });
  assert.deepEqual(r, { ok: false, tier: 'empty', reason: 'noMeaning' });
});

test('段 few + 内蔵語彙あり: 誤答はすべて内蔵語彙から、品詞を揃えて選ぶ', () => {
  for (const n of [1, 2, 3]) {
    const own = OWN_NOUNS.slice(0, n);
    for (const seed of SEEDS) {
      const r = okChoices(own[0], own, { builtin: BUILTIN, rng: rngOf(seed) });
      assert.equal(r.tier, 'few');
      assertWellFormed(r, own[0]);
      assert.equal(r.level, 'pos');
      for (const d of distractorsOf(r)) {
        assert.equal(d.source, 'builtin', `語数 ${n}`);
        assert.equal(d.word.pos, '名');
      }
    }
  }
});

test('段 few + 内蔵語彙なし: 4 択にしない(カードなど誤答の要らない形式だけ)', () => {
  const own = OWN_NOUNS.slice(0, 3);
  assert.deepEqual(buildChoices(own[0], own, { rng: rngOf(1) }), { ok: false, tier: 'few', reason: 'needBuiltin' });
  assert.deepEqual(
    buildChoices(own[0], own, { builtin: BUILTIN, useBuiltin: false, rng: rngOf(1) }),
    { ok: false, tier: 'few', reason: 'needBuiltin' },
    '内蔵語彙を切る設定は、渡された内蔵語彙より優先する',
  );
});

test('段 some + 内蔵語彙あり: 品詞の揃う自分の語が足りていれば自分の語だけ', () => {
  const own = OWN_NOUNS.slice(0, 5);
  for (const seed of SEEDS) {
    const r = okChoices(own[0], own, { builtin: BUILTIN, rng: rngOf(seed) });
    assert.equal(r.tier, 'some');
    assertWellFormed(r, own[0]);
    assert.ok(distractorsOf(r).every((d) => d.source === 'own'));
  }
});

test('段 some + 内蔵語彙あり: 品詞の揃う自分の語が足りない分だけ内蔵語彙で補う', () => {
  // 名詞 2(出題する語を含む)+ 動詞 3: 品詞の揃う自分の語は 1 つだけ
  const own = [...OWN_NOUNS.slice(0, 2), ...OWN_VERBS.slice(0, 3)];
  for (const seed of SEEDS) {
    const r = okChoices(own[0], own, { builtin: BUILTIN, rng: rngOf(seed) });
    assert.equal(r.tier, 'some');
    assertWellFormed(r, own[0]);
    assert.equal(r.level, 'pos', '内蔵語彙で補えば品詞の一致を緩めずに済む');
    const ds = distractorsOf(r);
    assert.deepEqual(ds.map((d) => d.source).sort(), ['builtin', 'builtin', 'own']);
    assert.equal(ds.find((d) => d.source === 'own')?.word, own[1]);
    assert.ok(ds.every((d) => d.word.pos === '名'));
  }
});

test('段 some + 内蔵語彙なし: 品詞の一致を緩めて自分の語だけで作る', () => {
  const own = [OWN_NOUNS[0], ...OWN_VERBS.slice(0, 3)];
  for (const seed of SEEDS) {
    const r = okChoices(own[0], own, { rng: rngOf(seed) });
    assert.equal(r.tier, 'some');
    assertWellFormed(r, own[0]);
    assert.equal(r.level, 'kind');
    assert.ok(distractorsOf(r).every((d) => d.source === 'own'));
  }
});

test('段 enough: 内蔵語彙を渡しても使わない。品詞が足りなければ自分の語の中で緩める', () => {
  // 名詞 1(出題する語)+ 動詞 9 = 10 語
  const own = [OWN_NOUNS[0], ...OWN_VERBS];
  assert.equal(own.length, OWN_ONLY_MIN);
  for (const opts of [{ builtin: BUILTIN }, { builtin: BUILTIN, useBuiltin: false }, {}]) {
    for (const seed of SEEDS) {
      const r = okChoices(own[0], own, { ...opts, rng: rngOf(seed) });
      assert.equal(r.tier, 'enough');
      assertWellFormed(r, own[0]);
      assert.equal(r.level, 'kind');
      assert.ok(distractorsOf(r).every((d) => d.source === 'own'));
    }
  }
});

test('段 enough: 品詞の揃う自分の語が足りていれば品詞を揃える', () => {
  const own = [...OWN_NOUNS, ...OWN_VERBS.slice(0, 4)];
  for (const seed of SEEDS) {
    const r = okChoices(own[0], own, { builtin: BUILTIN, rng: rngOf(seed) });
    assert.equal(r.level, 'pos');
    assert.ok(distractorsOf(r).every((d) => d.word.pos === '名'));
  }
});

// --- 誤答にしない語 -------------------------------------------------------------------------

test('語義が重なる語・同じ綴りの語・意味の無い語は誤答にしない', () => {
  const target = { en: 'handle', pos: '動', ja: '〜を処理する' };
  const own = [
    target,
    { en: 'process', pos: '動', ja: 'を処理する、加工する' }, // 語義が重なる
    { en: 'handle', pos: '名', ja: '取っ手' }, // 同じ綴り
    { en: 'arrange', pos: '動' }, // 意味が無い
    ...OWN_VERBS.slice(0, 3),
  ];
  for (const seed of SEEDS) {
    const r = okChoices(target, own, { rng: rngOf(seed) });
    const ens = distractorsOf(r).map((d) => d.word.en).sort();
    assert.deepEqual(ens, OWN_VERBS.slice(0, 3).map((w) => w.en).sort());
  }
});

test('同じ綴りの語は、品詞も種別も揃っていても誤答にしない', () => {
  const target = { en: 'handle', pos: '動', ja: '処理する' };
  const own = [
    target,
    { en: 'handle', pos: '動/名', ja: '扱う、取っ手' }, // 品詞が重なる(pos の条件を満たす)
    OWN_VERBS[0],
    OWN_VERBS[1],
  ];
  for (const seed of SEEDS) {
    const r = buildChoices(target, own, { rng: rngOf(seed) });
    assert.deepEqual(r, { ok: false, tier: 'some', reason: 'notEnoughCandidates' }, '同じ綴りの語を数に入れない');
  }
  const r = okChoices(target, [...own, OWN_VERBS[2]], { rng: rngOf(1) });
  assert.ok(distractorsOf(r).every((d) => d.word.en !== 'handle'));
});

test('既に選んだ誤答と鍵が同じ語は使わない(自分の語と内蔵語彙に訳語の違う同じ語があるとき)', () => {
  const own = [OWN_NOUNS[0], { en: 'invoice', pos: '名', ja: '請求書' }, OWN_VERBS[0], OWN_VERBS[1]];
  const builtin = [{ en: 'invoice', pos: '名', ja: '送り状' }, { en: 'warranty', pos: '名', ja: '保証' }];
  for (const seed of SEEDS) {
    const r = okChoices(own[0], own, { builtin, rng: rngOf(seed) });
    const invoices = distractorsOf(r).filter((d) => d.word.en === 'invoice');
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].source, 'own', '同じ条件の中では自分の語が先');
  }
});

test('品詞は 1 つでも重なれば揃っているとみなす(名/動 と 動)', () => {
  const target = { en: 'estimate', pos: '名/動', ja: '見積もり' };
  const own = [target, ...OWN_VERBS.slice(0, 3), { en: 'rapid', pos: '形', ja: '速い' }];
  for (const seed of SEEDS) {
    const r = okChoices(target, own, { rng: rngOf(seed) });
    assert.equal(r.level, 'pos');
    assert.ok(distractorsOf(r).every((d) => d.word.pos === '動'));
  }
});

test('kind が無くても、品詞に「句」を含む語は句表現として扱う', () => {
  // 品詞の揃う語は無い。種別(句表現)で揃えるなら、自分の動詞より内蔵語彙の句表現を選ぶはず
  const target = { en: 'look into A', pos: '動詞句', ja: 'A を調べる' };
  const own = [target, ...OWN_VERBS.slice(0, 3)];
  const phrases = BUILTIN.filter((w) => w.kind === 'phrase' && w.pos !== '動詞句');
  const builtin = [...phrases, { en: 'in possession of A', pos: '形容詞句/副詞句', kind: 'phrase', ja: 'A を所持して' }];
  for (const seed of SEEDS) {
    const r = okChoices(target, own, { builtin, rng: rngOf(seed) });
    assert.equal(r.level, 'kind');
    assert.ok(distractorsOf(r).every((d) => d.source === 'builtin' && d.word.kind === 'phrase'));
  }
});

test('品詞の無い語は pos の条件に当たらず、単語どうしから選ぶ', () => {
  const target = { en: 'itinerary', ja: '旅程表' };
  const own = [target, ...OWN_NOUNS.slice(0, 3)];
  const r = okChoices(target, own, { builtin: BUILTIN, rng: rngOf(1) });
  assert.equal(r.level, 'kind');
  assert.ok(distractorsOf(r).every((d) => d.source === 'own'));
});

test('誤答どうしも語義が重ならない(内蔵語彙に同じ意味の語が複数あっても 1 つだけ)', () => {
  const own = [OWN_NOUNS[0], OWN_NOUNS[1], OWN_VERBS[0], OWN_VERBS[1]];
  const builtin = [
    { en: 'bill', pos: '名', ja: '請求書' },
    { en: 'invoice', pos: '名', ja: '請求書' },
    { en: 'statement', pos: '名', ja: '請求書、明細書' },
    { en: 'venue', pos: '名', ja: '開催地' },
  ];
  for (const seed of SEEDS) {
    const r = okChoices(own[0], own, { builtin, rng: rngOf(seed) });
    const ds = distractorsOf(r);
    const billLike = ds.filter((d) => ['bill', 'invoice', 'statement'].includes(d.word.en));
    assert.equal(billLike.length, 1, '「請求書」の語は 1 つだけ');
    assert.equal(r.level, 'pos');
  }
});

test('句表現には句表現の誤答を選ぶ', () => {
  const target = { en: 'take over A', pos: '動詞句', kind: 'phrase', ja: 'A を引き継ぐ' };
  for (const seed of SEEDS) {
    const r = okChoices(target, [target], { builtin: BUILTIN, rng: rngOf(seed) });
    assert.ok(distractorsOf(r).every((d) => d.word.kind === 'phrase'));
    assert.equal(r.level, 'kind', '品詞(動詞句)の一致するものは 1 つだけなので、句表現どうしまで緩める');
  }
});

test('条件をすべて緩めても揃わなければ作らない。訳語がまったく同じ語は最後まで使わない', () => {
  const target = { en: 'bill', pos: '名', ja: '請求書' };
  const own = [
    target,
    { en: 'invoice', pos: '名', ja: '請求書' },
    { en: 'statement', pos: '名', ja: '請求書' },
    { en: 'check', pos: '名', ja: '請求書' },
  ];
  assert.deepEqual(buildChoices(target, own, { rng: rngOf(1) }), { ok: false, tier: 'some', reason: 'notEnoughCandidates' });
});

test('語義の重なりを許すのは最後の手段(senses)。訳語が同じでなければ 4 択を作る', () => {
  const target = { en: 'handle', pos: '動', ja: '処理する' };
  const own = [
    target,
    { en: 'process', pos: '動', ja: '処理する、加工する' },
    { en: 'treat', pos: '動', ja: '扱う、処理する' },
    { en: 'deal', pos: '動', ja: '処理する、配る' },
  ];
  const r = okChoices(target, own, { rng: rngOf(1) });
  assert.equal(r.level, 'senses');
  assertWellFormed(r, target);
});

test('同じ種の乱数なら同じ選択肢・同じ並びになる(再描画で並びが変わらないように呼び出し側が種を持てる)', () => {
  const own = [...OWN_NOUNS, ...OWN_VERBS];
  const a = okChoices(own[0], own, { builtin: BUILTIN, rng: rngOf(7) });
  const b = okChoices(own[0], own, { builtin: BUILTIN, rng: rngOf(7) });
  assert.deepEqual(a.options.map((o) => o.word.en), b.options.map((o) => o.word.en));
});

test('乱数を渡さなくても動く(既定は Math.random)', () => {
  const own = OWN_NOUNS.slice(0, 5);
  assertWellFormed(okChoices(own[0], own, { builtin: BUILTIN }), own[0]);
});

// --- INV-5: 内蔵語彙は誤答にだけ使い、問題には出さない -----------------------------------------------

test('INV-5: 自分の単語帳に無い語(内蔵語彙の語)を出題しようとすると拒否する', () => {
  const own = OWN_NOUNS.slice(0, 5);
  assert.throws(() => buildChoices(BUILTIN[0], own, { builtin: BUILTIN }), /INV-5/);
});

test('INV-5: 自分の語なら拒否しない(拒否が無条件でないこと)', () => {
  const own = OWN_NOUNS.slice(0, 5);
  assert.doesNotThrow(() => buildChoices(own[0], own, { builtin: BUILTIN }));
  // 利用者が内蔵語彙と同じ語を登録したなら、それは自分の語として出題できる
  const mine = { en: 'invoice', pos: '名', ja: '請求書' };
  assert.doesNotThrow(() => buildChoices(mine, [...own, mine], { builtin: BUILTIN }));
});

test('INV-5: notOwnQuestions は自分の語だけの出題集合から何も返さない', () => {
  const own = [...OWN_NOUNS, ...OWN_VERBS];
  assert.deepEqual(notOwnQuestions(own, own), []);
  const mine = { en: 'invoice', pos: '名', ja: '請求書' };
  assert.deepEqual(notOwnQuestions([mine], [...own, mine]), [], '内蔵語彙と同じ鍵でも、登録した語なら違反ではない');
});

test('INV-5 陽性対照: 出題集合に内蔵語彙を 1 件混ぜると検出する', () => {
  const own = [...OWN_NOUNS, ...OWN_VERBS];
  const questions = [...own.slice(0, 5), BUILTIN[4], ...own.slice(5)];
  assert.deepEqual(notOwnQuestions(questions, own), [BUILTIN[4]]);
});

test('INV-5: どの段・どの種でも、正解の選択肢は出題した自分の語で、内蔵語彙は誤答にしか現れない', () => {
  const pool = [...OWN_NOUNS, ...OWN_VERBS];
  let builtinSeen = 0;
  for (const n of [1, 3, 4, 9, 10, 15]) {
    const own = pool.slice(0, n);
    for (const seed of SEEDS) {
      for (const target of own) {
        const r = buildChoices(target, own, { builtin: BUILTIN, rng: rngOf(seed) });
        if (!r.ok) continue;
        for (const o of r.options) {
          if (o.source === 'builtin') {
            builtinSeen++;
            assert.equal(o.correct, false);
          }
        }
        assert.deepEqual(notOwnQuestions(r.options.filter((o) => o.correct).map((o) => o.word), own), []);
      }
    }
  }
  assert.ok(builtinSeen > 0, '内蔵語彙が選ばれる場合を実際に通ったこと(UV-1)');
});
