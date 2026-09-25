import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport } from '../../core/importFormat.js';
import { planImport, confirmPlan, applyImport } from '../../core/importPlan.js';

/** @typedef {import('../../core/word.js').Word} Word */

/** @returns {Word[]} */
const book = () => [
  { en: 'allocate', pos: '動', ja: '割り当てる', ex: 'I wrote this sentence myself.', exSrc: 'self' },
  { en: 'itinerary' },
  { en: 'secure', pos: '形', ja: '安全な' },
  { en: 'secure', pos: '動', ja: '確保する' },
];

/**
 * @param {Word[]} existing
 * @param {string} text
 * @param {import('../../core/importPlan.js').PlanOptions} [opts]
 */
const plan = (existing, text, opts) => planImport(existing, parseImport(text), opts);

// --- INV-2: 確認表を経ないと保存用の一覧は作れない ---------------------------------------

test('INV-2: 確定していない確認表・解析結果・手で作った「確定済み」は保存に使えない', () => {
  const existing = book();
  const p = plan(existing, 'tentative | 形 | 仮の');
  assert.throws(() => applyImport(existing, /** @type {any} */ (p)), /INV-2/);
  assert.throws(() => applyImport(existing, /** @type {any} */ (parseImport('tentative'))), /INV-2/);
  assert.throws(() => applyImport(existing, { plan: p, choices: {} }), /INV-2/, '形だけ真似たものを通さない');
  assert.throws(() => applyImport(existing, { ...confirmPlan(p) }), /INV-2/, '確定済みの写しを通さない');
});

test('INV-2 陽性対照: 確定した確認表なら保存用の一覧が返る(拒否が無条件でないこと)', () => {
  const existing = book();
  const r = applyImport(existing, confirmPlan(plan(existing, 'tentative | 形 | 仮の')));
  assert.equal(r.added, 1);
  assert.deepEqual(r.words.at(-1), { en: 'tentative', pos: '形', ja: '仮の' });
  assert.equal(existing.length, 4, '渡した単語帳は変えない');
});

test('INV-2: 確認表は作った時点で凍結され、確定の前にも後にも書き換えられない', () => {
  const existing = book();
  const p = plan(existing, 'tentative | 形 | 仮の');
  assert.throws(() => { p.rows[0].action = 'skipped'; }, TypeError);
  assert.throws(() => { /** @type {any} */ (p.rows[0].word).en = 'x'; }, TypeError);
  const c = confirmPlan(p);
  assert.throws(() => { /** @type {any} */ (c.plan.rows).push({}); }, TypeError);
  assert.equal(applyImport(existing, c).added, 1);
});

test('INV-2: planImport が作っていない確認表は確定できない', () => {
  const existing = book();
  const p = plan(existing, 'tentative | 形 | 仮の');
  const forged = { ...p, rows: [{ ...p.rows[0], word: { en: 'forged' } }] };
  assert.throws(() => confirmPlan(forged), /planImport が作っていない/);
});

test('INV-2: 確認表を作ったあとに単語帳が変わったら保存しない', () => {
  const existing = book();
  const c = confirmPlan(plan(existing, 'tentative'));
  assert.throws(() => applyImport([...existing, { en: 'invoice' }], c), /単語帳が変わりました/);
  assert.throws(() => applyImport(existing.map((w) => ({ ...w, note: 'x' })), c), /単語帳が変わりました/);
});

test('INV-2: 読めなかった入力は確定できない', () => {
  assert.throws(() => confirmPlan(plan(book(), '{ broken')), /確定できません/);
});

// --- 突き合わせの規則 --------------------------------------------------------------

test('既存の語: 空欄だけを埋め、食い違う値は既定では単語帳の値を残す', () => {
  const existing = book();
  const p = plan(existing, 'allocate | 動 | 配分する | AI wrote this. | AI の訳 | 補足', { exSrc: 'ai' });
  const row = p.rows[0];
  assert.equal(row.action, 'merge');
  assert.deepEqual(row.fills, ['note']);
  assert.deepEqual(row.conflicts?.map((x) => x.field), ['ja', 'ex', 'exJa']);
  const w = applyImport(existing, confirmPlan(p)).words[0];
  assert.equal(w.ja, '割り当てる');
  assert.equal(w.ex, 'I wrote this sentence myself.', '自作の例文を黙って消さない');
  assert.equal(w.exSrc, 'self');
  assert.equal(w.exJa, undefined, '別の例文の和訳を、残した例文に付けない');
  assert.equal(w.note, '補足');
});

test('既存の語: 上書きを選んだ行だけ入力の値にし、例文の和訳と出どころも入れ替わる', () => {
  const existing = [{ en: 'allocate', pos: '動', ja: '割り当てる', ex: 'Mine.', exJa: '自分の訳', exSrc: /** @type {const} */ ('self') }];
  const withJa = plan(existing, 'allocate | 動 | 配分する | AI wrote this. | AI の訳', { exSrc: 'ai' });
  const a = applyImport(existing, confirmPlan(withJa, { 1: 'overwrite' })).words[0];
  assert.deepEqual([a.ja, a.ex, a.exJa, a.exSrc], ['配分する', 'AI wrote this.', 'AI の訳', 'ai']);
  const bare = plan(existing, 'allocate | 動 | | Another one.');
  const b = applyImport(existing, confirmPlan(bare, { 1: 'overwrite' })).words[0];
  assert.deepEqual([b.ex, b.exJa, b.exSrc], ['Another one.', undefined, undefined], '古い和訳と出どころを新しい例文に残さない');
});

test('既存の語: 同じ例文なら、和訳だけを埋められる', () => {
  const existing = [{ en: 'allocate', pos: '動', ex: 'Mine.', exSrc: /** @type {const} */ ('self') }];
  const p = plan(existing, 'allocate | 動 | | Mine. | 私の文');
  assert.deepEqual(p.rows[0].fills, ['exJa']);
  const w = applyImport(existing, confirmPlan(p)).words[0];
  assert.deepEqual([w.exJa, w.exSrc], ['私の文', 'self']);
});

test('既存の語: 同じ例文で和訳が食い違えば、上書きを選んだときだけ和訳を入れ替える', () => {
  const existing = [{ en: 'allocate', pos: '動', ex: 'Mine.', exJa: '古い訳' }];
  const p = plan(existing, 'allocate | 動 | | Mine. | 新しい訳');
  assert.deepEqual(p.rows[0].conflicts?.map((x) => x.field), ['exJa']);
  assert.equal(applyImport(existing, confirmPlan(p)).words[0].exJa, '古い訳');
  assert.equal(applyImport(existing, confirmPlan(p, { 1: 'overwrite' })).words[0].exJa, '新しい訳');
});

test('上書きを選んでも品詞は変えない(括弧書きの違いだけが食い違う)', () => {
  const existing = [{ en: 'run', pos: '動(自)', ja: '走る' }];
  const p = plan(existing, 'run | 動 | 経営する');
  assert.equal(p.rows[0].target, 'run|動');
  const w = applyImport(existing, confirmPlan(p, { 1: 'overwrite' })).words[0];
  assert.deepEqual([w.pos, w.ja], ['動(自)', '経営する']);
});

test('見出し語は大文字・小文字を区別して当てる(仮)', () => {
  const p = plan([{ en: 'allocate', pos: '動' }], 'Allocate | 動');
  assert.equal(p.rows[0].action, 'add');
});

test('品詞の無い既存の語: 品詞のある入力で埋め、鍵の付け替えを報告する', () => {
  const existing = book();
  const p = plan(existing, 'itinerary | 名 | 旅程表');
  assert.equal(p.rows[0].action, 'merge');
  assert.equal(p.rows[0].target, 'itinerary|');
  const r = applyImport(existing, confirmPlan(p));
  assert.deepEqual(r.words[1], { en: 'itinerary', pos: '名', ja: '旅程表' });
  assert.deepEqual(r.rekeys, [{ from: 'itinerary|', to: 'itinerary|名' }]);
  assert.equal(r.updated, 1);
});

test('INV-4: 同じ綴りでも品詞が違えば新しい語として足す', () => {
  const existing = [{ en: 'secure', pos: '形', ja: '安全な' }];
  const p = plan(existing, 'secure | 動 | 確保する');
  assert.equal(p.rows[0].action, 'add');
  assert.equal(applyImport(existing, confirmPlan(p)).words.length, 2);
});

test('当て先が決められない語: 既定では取り込まず、選べば当てる・足す', () => {
  const existing = book();
  const p = plan(existing, 'secure | | 守る');
  assert.equal(p.rows[0].action, 'ambiguous');
  assert.deepEqual(p.rows[0].candidates, ['secure|形', 'secure|動']);
  assert.deepEqual(p.rows[0].previews?.map((x) => [x.target, x.conflicts.map((c) => c.field)]), [['secure|形', ['ja']], ['secure|動', ['ja']]]);
  assert.deepEqual(applyImport(existing, confirmPlan(p)).words, existing);
  const toVerb = applyImport(existing, confirmPlan(p, { 1: { target: 'secure|動' } }));
  assert.equal(toVerb.updated, 0, '食い違いを残しただけなので、変わった語は無い');
  assert.equal(toVerb.words[3].ja, '確保する', '食い違う意味は上書きしない');
  const note = plan(existing, 'secure | | | | | 補足');
  assert.equal(applyImport(existing, confirmPlan(note, { 1: { target: 'secure|動' } })).updated, 1);
  assert.equal(applyImport(existing, confirmPlan(p, { 1: 'add' })).words.length, 5);
});

test('INV-4: 当て先の決まらない語が入力に 2 回出たら、2 つ目は重複にする(両方を足して同じ語を 2 つ作らない)', () => {
  const existing = book();
  const p = plan(existing, 'secure | | 守る\nsecure | | 確実にする');
  assert.deepEqual(p.rows.map((r) => r.action), ['ambiguous', 'duplicate']);
  assert.throws(() => confirmPlan(p, { 1: 'add', 2: 'add' }), /選べません/);
  const r = applyImport(existing, confirmPlan(p, { 1: 'add' }));
  assert.equal(r.words.filter((w) => w.en === 'secure' && !w.pos).length, 1);
});

test('当て先の決まらない語で選んだ当て先が、他の行の当て先と重なれば確定しない', () => {
  const existing = book();
  const p = plan(existing, 'secure | 動 | 確保する\nsecure | | 守る');
  assert.deepEqual(p.rows.map((r) => r.action), ['same', 'ambiguous']);
  assert.throws(() => confirmPlan(p, { 2: { target: 'secure|動' } }), /重なります/);
  assert.equal(applyImport(existing, confirmPlan(p, { 2: { target: 'secure|形' } })).updated, 0, '意味が食い違うだけで変わらない');
});

test('更新の数は中身が変わった語だけを数える(食い違いを残しただけの行は 0。画面は 0 件なら保存しない)', () => {
  const existing = book();
  const p = plan(existing, 'allocate | 動 | 配分する');
  assert.equal(p.rows[0].action, 'merge');
  const kept = applyImport(existing, confirmPlan(p));
  assert.deepEqual([kept.added, kept.updated], [0, 0]);
  assert.deepEqual(kept.words, existing);
  // 陽性対照: 上書きを選べば変わり、1 と数える
  const over = applyImport(existing, confirmPlan(p, { 1: 'overwrite' }));
  assert.deepEqual([over.updated, over.words[0].ja], [1, '配分する']);
});

test('入力の中の重複・変わらない語・読めない行は取り込まない', () => {
  const existing = book();
  const p = plan(existing, 'tentative\ntentative\nallocate | 動\n割り当てる | 動\n以下です。');
  assert.deepEqual(p.rows.map((r) => r.action), ['add', 'duplicate', 'same', 'error', 'skipped']);
  assert.deepEqual(p.counts, { add: 1, merge: 0, same: 1, ambiguous: 0, duplicate: 1, error: 1, skipped: 1 });
  const r = applyImport(existing, confirmPlan(p));
  assert.deepEqual([r.added, r.updated, r.words.length], [1, 0, 5]);
});

test('同じ語を品詞あり・なしで続けて入れても 1 つにまとまる', () => {
  const p = plan([{ en: 'itinerary' }], 'itinerary | 名 | 旅程表\nitinerary\nitinerary | 名');
  assert.deepEqual(p.rows.map((r) => r.action), ['merge', 'duplicate', 'duplicate']);
});

test('外した行は取り込まない', () => {
  const existing = book();
  const p = plan(existing, 'tentative\nitinerary | 名');
  const r = applyImport(existing, confirmPlan(p, { 1: 'skip', 2: 'skip' }));
  assert.deepEqual(r.words, existing);
});

test('選べない選択は確定時に拒否する', () => {
  const p = plan(book(), 'tentative\nallocate | 動');
  assert.throws(() => confirmPlan(p, { 1: 'overwrite' }), /選べません/);
  assert.throws(() => confirmPlan(p, { 2: 'skip' }), /選べません/, '変わらない語は外す対象ではない');
  assert.throws(() => confirmPlan(p, { 9: 'skip' }), /確認表にありません/);
});

test('取り込みの既定: タグを足し合わせ、例文のある語にだけ出どころを付ける', () => {
  const existing = [{ en: 'allocate', pos: '動', tags: ['第2週'] }];
  const p = plan(existing, 'allocate | 動\ntentative | 形 | 仮の | We have a tentative plan.', { tags: ['第3週', ' '], exSrc: 'set' });
  assert.deepEqual(p.rows.map((r) => r.action), ['merge', 'add']);
  assert.deepEqual(p.rows[0].fills, ['tags']);
  const r = applyImport(existing, confirmPlan(p));
  assert.deepEqual(r.words[0].tags, ['第2週', '第3週']);
  assert.deepEqual([r.words[1].tags, r.words[1].exSrc], [['第3週'], 'set']);
});
