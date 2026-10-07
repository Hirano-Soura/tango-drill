// AI への依頼文(core/aiPrompt.js)。返答の見本での確認は aiReplies.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiPrompt, requestWords, transPrompt, AI_PROMPT_VERSION } from '../../core/aiPrompt.js';
import { parseImport } from '../../core/importFormat.js';
import { planImport, confirmPlan, applyImport } from '../../core/importPlan.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ai');

/** 固定した全文(prompt_<版>*.txt)を作った語。台帳(replies.json)の見本の語とは切り離しておく(見本を入れ替えても変わらない) */
const PINNED_WORDS = ['allocate', 'itinerary', 'reimburse', 'tentative', 'comply with', 'on behalf of', 'in advance', 'secure', 'estimate', 'be eligible for'];

test('依頼文の文面は版ごとに固定してある(文面を変えたら AI_PROMPT_VERSION を上げ、新しい版の全文を足す)', () => {
  const words = PINNED_WORDS;
  for (const [suffix, examples] of /** @type {const} */ ([['', true], ['_noex', false]])) {
    const file = `prompt_${AI_PROMPT_VERSION}${suffix}.txt`;
    const pinned = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
    assert.equal(aiPrompt(words, { examples }), pinned, `${file} と今の依頼文が違う`);
  }
});

test('依頼する語: 1 行 1 語。空行・重複・英語として読めない行(見出し語と同じ判定)を除き、空白を詰める', () => {
  assert.deepEqual(requestWords('allocate\n\n  on   behalf of \nallocate\n請求書\r\nitinerary\nsecure 守る'), {
    words: ['allocate', 'on behalf of', 'itinerary'],
    ignored: ['請求書', 'secure 守る'],
  });
  assert.deepEqual(requestWords(''), { words: [], ignored: [] });
});

test('依頼文は語の一覧を 1 行ずつ持ち、語が無ければ空', () => {
  const p = aiPrompt(['allocate', 'on behalf of']);
  assert.ok(p.endsWith('【語の一覧】\nallocate\non behalf of'));
  assert.match(p, /見出し語 \| 品詞 \| 意味 \| 例文 \| 例文の和訳 \| 補足/);
  assert.equal(aiPrompt([]), '');
  assert.match(aiPrompt(['allocate'], { examples: false }), /見出し語 \| 品詞 \| 意味 \| \| \| 補足/);
});

test('依頼文の列の並びは簡易形式と同じで、AI が列名の行を書き写しても語として読まない', () => {
  for (const examples of [true, false]) {
    const cols = /** @type {RegExpExecArray} */ (/「(見出し語 \|[^」]*)」/.exec(aiPrompt(['x'], { examples })))[1];
    const r = parseImport(cols);
    assert.equal(r.format, 'simple/v1');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].word, undefined, cols);
    assert.ok(r.rows[0].skipped, cols);
    // 依頼どおりの 1 行は、列の順に読める(例文の無い版は例文の列が空)
    const line = examples ? 'allocate | 動 | 割り当てる | We allocate funds. | 資金を割り当てる。 | allocate A to B' : 'allocate | 動 | 割り当てる | | | allocate A to B';
    const w = parseImport(line).rows[0].word;
    assert.deepEqual(w, examples
      ? { en: 'allocate', pos: '動', ja: '割り当てる', ex: 'We allocate funds.', exJa: '資金を割り当てる。', note: 'allocate A to B' }
      : { en: 'allocate', pos: '動', ja: '割り当てる', note: 'allocate A to B' });
  }
});

test('依頼文 v2 どおりの 1 行は、品詞に添えた自他を trans として読む', () => {
  const w = parseImport('estimate | 名/動(他) | (名)見積もり ／ (動)見積もる | Send us an estimate. | 見積もりを送ってください。 | a rough estimate').rows[0].word;
  assert.deepEqual(w, { en: 'estimate', pos: '名/動', trans: 'vt', ja: '(名)見積もり ／ (動)見積もる', ex: 'Send us an estimate.', exJa: '見積もりを送ってください。', note: 'a rough estimate' });
});

test('自他を補う依頼文: 版ごとに固定し、見出し語と品詞をそのまま並べる。語が無ければ空', () => {
  const words = [{ en: 'allocate', pos: '動' }, { en: 'estimate', pos: '名/動' }, { en: 'secure', pos: '動/形' }, { en: 'expire', pos: '動' }];
  const pinned = readFileSync(join(dir, `trans_${AI_PROMPT_VERSION}.txt`), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
  assert.equal(transPrompt(words), pinned);
  assert.ok(transPrompt(words).endsWith('【語の一覧】\nallocate | 動\nestimate | 名/動\nsecure | 動/形\nexpire | 動'));
  assert.equal(transPrompt([]), '');
});

test('自他を補う依頼文への返答は、確認表で既存の語の自他の空欄だけを埋める(意味・例文は変えない)', () => {
  const book = [
    { en: 'allocate', pos: '動', ja: '割り当てる', ex: 'We allocate funds.', exJa: '資金を割り当てる。', exSrc: /** @type {const} */ ('self') },
    { en: 'estimate', pos: '名/動', ja: '見積もり' },
    { en: 'secure', pos: '動/形', ja: '確保する' },
    { en: 'expire', pos: '動', ja: '期限が切れる' },
  ];
  // AI が見出し語の一覧を書き写し、自他を添えて返した形(コードブロックつき)
  const reply = '```\nallocate | 動(他)\nestimate | 名/動(他)\nsecure | 動/形(他)\nexpire | 動(自)\n```';
  const plan = planImport(book, parseImport(reply));
  assert.deepEqual(plan.rows.map((r) => [r.action, r.fills]), [['merge', ['trans']], ['merge', ['trans']], ['merge', ['trans']], ['merge', ['trans']]]);
  const r = applyImport(book, confirmPlan(plan));
  assert.deepEqual(r.words.map((w) => w.trans), ['vt', 'vt', 'vt', 'vi']);
  assert.deepEqual(r.words.map(({ trans, ...rest }) => rest), book, '自他のほかは変えない');
  assert.equal(r.added, 0);
});
