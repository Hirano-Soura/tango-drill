// T-5.2: バックアップの書き出し・読み込み(設定タブ)。復元は確認表を通さず、件数を見せて確かめてから置き換え、元に戻せる。
// 形式と読み込みの規則そのものは tests/core/backup.test.js、保存・復元・元に戻すは tests/app/storage.test.js が見る。
// ここでは画面が「ファイル → 件数の確認 → 置き換え」の順を守ることと、ファイルが別の端末(別の IndexedDB)へ渡ることを見る。
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { storedBook, seedBook, tab, fits } from './helpers.js';

/** @typedef {import('../../core/book.js').Book} Book */
/** @typedef {import('@playwright/test').Page} Page */

/** 書き出す側の単語帳。消した語(tentative)の記録を持つ(記録件数は消した語の分も数える) */
/** @type {Book} */
const SOURCE = {
  words: [
    { en: 'allocate', pos: '動', ja: '割り当てる' },
    { en: 'itinerary', pos: '名', ja: '<b>旅程</b>' },
    { en: 'reimburse', pos: '動', ja: '払い戻す' },
  ],
  added: { 'allocate|動': '2026-09-20', 'itinerary|名': '2026-09-21', 'reimburse|動': '2026-09-21' },
  records: {
    hist: { 'allocate|動': [1, 0, 1], 'tentative|形': [0, 1] },
    self: { 'allocate|動': [1, 1, 1], 'tentative|形': [0, 0] },
  },
  starred: ['itinerary|名'],
};

/** 読み込む側に元からある単語帳 */
/** @type {Book} */
const OTHER = {
  words: [{ en: 'tentative', pos: '形', ja: '仮の' }],
  added: { 'tentative|形': '2026-09-25' },
  records: { hist: {}, self: {} },
  starred: [],
};

/**
 * 確認の表の 1 行(項目名 → [読み込むファイル, 今の単語帳])。
 * @param {Page} page
 * @param {string} name
 */
const confirmRow = (page, name) => page.locator('#restore-confirm tbody tr', { has: page.locator('th', { hasText: name }) }).locator('td');

test('書き出したファイルを別の端末で読み込むと、確認に出る件数が書き出し元と一致し、確認してから置き換わる。元に戻せる', async ({ page, browser }, testInfo) => {
  // 書き出す端末(別のコンテキストは別の IndexedDB を持つ)
  const srcCtx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const src = await srcCtx.newPage();
  await src.goto('/');
  await seedBook(src, SOURCE);
  await tab(src, '設定').click();
  const [dl] = await Promise.all([src.waitForEvent('download'), src.getByRole('button', { name: '書き出す' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^tango-drill_backup_\d{4}-\d{2}-\d{2}\.json$/);
  await expect(src.locator('#backup-msg')).toContainText('書き出しました(語数 3・記録件数 5・印 1)');
  const saved = testInfo.outputPath('backup.json');
  await dl.saveAs(saved);
  // 書き出したファイルの中身と名前をそのまま渡す(保存先のパスは試験名を含み、パスのままでは選べないことがあった)
  const file = { name: dl.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(saved) };
  expect(JSON.parse(file.buffer.toString('utf8')).format).toBe('tango-drill-backup/v1');
  const source = await storedBook(src);
  await srcCtx.close();

  // 読み込む端末。陽性対照: 書き出した端末とは別の IndexedDB である(元の単語帳が見える)
  await page.goto('/');
  await seedBook(page, OTHER);
  expect(await storedBook(page)).toEqual(OTHER);
  await tab(page, '設定').click();

  // ファイルを選ぶと件数の確認が出る。この時点では単語帳は変わらない
  await page.getByLabel('バックアップを読み込む').setInputFiles(file);
  await expect(page.locator('#restore-confirm')).toContainText('tango-drill_backup_');
  await expect(confirmRow(page, '語数')).toHaveText(['3', '1']);
  await expect(confirmRow(page, '記録件数')).toHaveText(['5', '0']);
  await expect(confirmRow(page, '記録のある語')).toHaveText(['2', '0']);
  await expect(confirmRow(page, '印')).toHaveText(['1', '0']);
  await fits(page, '読み込む前の確認');
  expect(await storedBook(page)).toEqual(OTHER);

  // やめると変わらない
  await page.getByRole('button', { name: 'やめる' }).click();
  await expect(page.locator('#restore-confirm')).toHaveCount(0);
  await expect(page.locator('#backup-msg')).toContainText('読み込みをやめました');
  expect(await storedBook(page)).toEqual(OTHER);

  // 置き換えると書き出し元と同じ単語帳になり、開き直しても残る
  await page.getByLabel('バックアップを読み込む').setInputFiles(file);
  await page.getByRole('button', { name: '置き換える' }).click();
  await expect(page.locator('#backup-msg')).toContainText('バックアップで置き換えました(語数 3・記録件数 5・印 1)');
  expect(await storedBook(page)).toEqual(source);
  await page.reload();
  await tab(page, '単語帳').click();
  await expect(page.locator('.word .en')).toHaveText(['allocate', 'itinerary', 'reimburse']);
  expect(await storedBook(page)).toEqual(source);

  // 元に戻すは開き直しても残り(次の復元まで)、戻すと読み込む前の単語帳になる
  await tab(page, '設定').click();
  await page.getByRole('button', { name: '読み込む前の単語帳に戻す' }).click();
  await expect(page.locator('#backup-msg')).toContainText('読み込む前の単語帳に戻しました');
  expect(await storedBook(page)).toEqual(OTHER);
  await expect(page.getByRole('button', { name: '読み込む前の単語帳に戻す' })).toHaveCount(0);
});

test('バックアップではないファイル・壊れたファイルは確認を出さずに断り、単語帳を変えない。警告とファイル名は HTML として解釈しない', async ({ page }) => {
  await page.goto('/');
  await seedBook(page, OTHER);
  await tab(page, '設定').click();
  const input = page.getByLabel('バックアップを読み込む');

  // 語の取り込みのファイルは取り込みへ案内する
  await input.setInputFiles('tests/core/fixtures/import/tango-drill_v1.json');
  await expect(page.locator('#backup-msg.err')).toContainText('取り込みから読み込んでください');
  await expect(page.locator('#restore-confirm')).toHaveCount(0);

  // 途中で切れたファイル
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"format": "tango-drill-backup/v1", "words": [') });
  await expect(page.locator('#backup-msg.err')).toContainText('「broken.json」は読み込めません');
  await expect(page.locator('#restore-confirm')).toHaveCount(0);
  expect(await storedBook(page)).toEqual(OTHER);

  // 読めるが警告のあるファイル: 警告を確認に出す。ファイル名も警告も要素にならない
  const warned = { format: 'tango-drill-backup/v1', '<i>x</i>': 1, words: [{ en: 'allocate', pos: '動', ja: '割り当てる' }] };
  await input.setInputFiles({ name: '<b>b</b>.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(warned)) });
  await expect(page.locator('#restore-confirm .warns')).toContainText('未知の項目 <i>x</i> を無視しました');
  await expect(page.locator('#restore-confirm')).toContainText('<b>b</b>.json');
  await expect(page.locator('#restore-confirm i, #restore-confirm b')).toHaveCount(0);
  await expect(page.locator('#restore-confirm .meta')).toContainText('書き出した日時 不明');
  expect(await storedBook(page)).toEqual(OTHER);
});
