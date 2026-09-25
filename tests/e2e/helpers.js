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
