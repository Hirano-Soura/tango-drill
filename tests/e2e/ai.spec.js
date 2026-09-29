// T-6 の画面側: 語の一覧 → 依頼文 → コピー、AI の返答(見本)を貼る → 確認表 → 確定。
// 返答の見本と台帳は tests/core/fixtures/ai/(どの返答が本物の見本かは台帳の standIn を見る)。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { aiPrompt } from '../../core/aiPrompt.js';
import { storedBook, fits } from './helpers.js';

const replies = JSON.parse(readFileSync('tests/core/fixtures/ai/replies.json', 'utf8'));

test('依頼文を作ってコピーし、AI の返答を貼って確認表から取り込む', async ({ page, context, browserName }, info) => {
  // 例文も頼んだ見本のどれか(台帳の並びに依らない)
  const entry = replies.find((/** @type {{ examples: boolean }} */ e) => e.examples);
  await page.goto('/');
  // 1 語の追加欄に入力中の値は、依頼文を作っても消えない
  await page.getByLabel('見出し語(英語)').fill('typing');
  await page.getByLabel('頼む語(1 行に 1 つ)').fill([...entry.words, '請求書', entry.words[0]].join('\n'));
  await page.getByRole('button', { name: '依頼文を作る' }).click();
  await expect(page.locator('#ai-msg')).toHaveText(`${entry.words.length} 語の依頼文を作りました(英語でない行を除きました: 請求書)`);
  await expect(page.getByLabel('AI への依頼文')).toHaveValue(aiPrompt(entry.words));
  await expect(page.getByLabel('見出し語(英語)')).toHaveValue('typing');
  if (info.project.name === 'phone') await fits(page, '依頼文');

  // コピー(クリップボードを読めるブラウザで中身まで確かめる)
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '依頼文をコピー' }).click();
  await expect(page.locator('#ai-msg')).toHaveText('コピーしました。AI に貼ってください');
  // Windows のクリップボードは改行を CRLF にして返す(Docs/52_Pitfalls.md P-11)
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(aiPrompt(entry.words));

  // 依頼文を作っても単語帳は変わらない。返答を貼って確認表を経て初めて入る
  expect((await storedBook(page)).words).toEqual([]);
  await page.getByLabel('貼り付ける内容').fill(readFileSync(`tests/core/fixtures/ai/${entry.file}`, 'utf8'));
  await page.getByLabel('例文の出どころ').selectOption('ai');
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(page.locator('#plan li.prow .act')).toHaveText(entry.words.map(() => '足す'));
  await page.getByRole('button', { name: '確定して取り込む' }).click();
  await expect(page.locator('#toast')).toContainText(`取り込みました(追加 ${entry.words.length} 語・更新 0 語)`);
  const book = await storedBook(page);
  expect(book.words.map((/** @type {{ en: string }} */ w) => w.en)).toEqual(entry.words);
  expect(book.words.every((/** @type {{ exSrc?: string }} */ w) => w.exSrc === 'ai')).toBe(true);
});

test('頼む語が無ければ依頼文を作らない', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('頼む語(1 行に 1 つ)').fill('請求書\n\n');
  await page.getByRole('button', { name: '依頼文を作る' }).click();
  await expect(page.locator('#ai-msg')).toHaveText('頼む語を 1 行に 1 つ書いてください');
  await expect(page.getByLabel('AI への依頼文')).toHaveCount(0);
});
