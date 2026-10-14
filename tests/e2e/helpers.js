// 画面の確認(*.spec.js)で共用する部品。
import { expect } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */

/**
 * 保存層から今の単語帳を読む(画面を通さずに保存された中身を確かめる)。
 * @param {Page} page
 */
export async function storedBook(page) {
  return page.evaluate(async () => {
    // ブラウザの中で、配信している保存層をそのまま読み込む(パスはページの URL から見たもの)
    const path = '/app/storage.js';
    const { openStorage } = /** @type {typeof import('../../app/storage.js')} */ (await import(path));
    const s = await openStorage(indexedDB);
    const { book } = await s.load('2000-01-01');
    s.close();
    return book;
  });
}

/**
 * 保存層へ単語帳をそのまま置く(記録の付いた単語帳を画面の操作なしで用意する)。置いたあとは開き直す。
 * @param {Page} page
 * @param {import('../../core/book.js').Book} book
 */
export async function seedBook(page, book) {
  await page.evaluate(async (b) => {
    const path = '/app/storage.js';
    const { openStorage } = /** @type {typeof import('../../app/storage.js')} */ (await import(path));
    const s = await openStorage(indexedDB);
    await s.save(b);
    s.close();
  }, book);
  await page.reload();
}

/**
 * @param {Page} page
 * @param {string} name
 */
export const tab = (page, name) => page.getByRole('tab', { name, exact: true });

/**
 * 横にはみ出していないこと。
 * @param {Page} page
 * @param {string} where
 */
export async function fits(page, where) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, where).toBeLessThanOrEqual(iw);
}

/**
 * 開閉できる欄(details.fold)を開く。欄は既定で閉じている(Docs/23_Screens.md §5)。開いていれば何もしない。
 * @param {Page} page
 * @param {...string} ids
 */
export async function openFold(page, ...ids) {
  for (const id of ids) {
    const d = page.locator(`#${id}`);
    if (!(await d.evaluate((e) => /** @type {HTMLDetailsElement} */ (e).open))) await d.locator(':scope > summary').click();
    await expect(d).toHaveJSProperty('open', true);
  }
}

/**
 * 追加タブの 3 つの欄をすべて開く(ページを開き直すと閉じるので、そのたびに呼ぶ)。
 * @param {Page} page
 */
export const openAddFolds = (page) => openFold(page, 'add-panel', 'ai-panel', 'import-panel');

/**
 * 今のタブに見えている開閉できる欄を、すべて開く(はみ出しを中身まで見るとき)。
 * @param {Page} page
 */
export async function openAllFolds(page) {
  const closed = page.locator('details.fold:not([open]) > summary:visible');
  while (await closed.count()) await closed.first().click();
}
