// T-5: 追加 → 学習 → 記録 → 編集 → 削除 → 元に戻す を画面で通す。
// 編集で例文を消すと和訳と出どころも消えること(Docs/20_ImportFormat.md §4)は、保存された中身で確かめる。
import { test, expect } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */

/**
 * 保存層から今の単語帳を読む(画面を通さずに保存された中身を確かめる)。
 * @param {Page} page
 */
async function storedBook(page) {
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
 * @param {Page} page
 * @param {string} name
 */
const tab = (page, name) => page.getByRole('tab', { name, exact: true });

test('追加 → 学習 → 記録 → 編集 → 削除 → 元に戻す', async ({ page }) => {
  await page.goto('/');
  // 空の単語帳は追加タブから始まる
  await expect(tab(page, '追加')).toHaveAttribute('aria-selected', 'true');

  // 追加
  await page.getByLabel('見出し語(英語)').fill('allocate');
  await page.getByLabel('品詞').fill('動');
  await page.getByLabel('意味').fill('割り当てる');
  await page.getByLabel('例文', { exact: true }).fill('They allocated funds to each team.');
  await page.getByLabel('例文の和訳').fill('彼らは各チームに資金を割り当てた。');
  await page.getByRole('button', { name: '追加する' }).click();
  await expect(page.locator('#content .msg')).toContainText('「allocate」を追加しました');
  await expect(page.getByLabel('見出し語(英語)')).toHaveValue('');

  // 学習: 1 語でも内蔵語彙で 4 択になる(Docs/21_Quiz.md §1 の few)
  await tab(page, '学習').click();
  await page.getByRole('button', { name: '始める' }).click();
  await expect(page.locator('.stem')).toHaveText('allocate');
  await page.getByRole('button', { name: 'わかる', exact: true }).click();
  await expect(page.locator('button.choice')).toHaveCount(5);
  await page.getByRole('button', { name: '割り当てる', exact: true }).click();
  await expect(page.locator('.fb')).toContainText('正解');

  // 記録
  await tab(page, '記録').click();
  await expect(page.locator('.sumbox', { hasText: '回答数' }).locator('b')).toHaveText('1');
  await expect(page.locator('.sumbox', { hasText: '正答率' }).locator('b')).toHaveText('100%');
  await expect(page.locator('tbody tr')).toHaveCount(1);

  // 編集: 例文を消すと、和訳と出どころも消える
  let book = await storedBook(page);
  expect(book.words[0]).toMatchObject({ ex: 'They allocated funds to each team.', exJa: '彼らは各チームに資金を割り当てた。', exSrc: 'self' });
  await tab(page, '単語帳').click();
  const row = page.locator('li.word', { hasText: 'allocate' });
  await row.getByRole('button', { name: '編集' }).click();
  await page.locator('#edit-form').getByLabel('例文', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.locator('#edit-panel')).toHaveCount(0);
  book = await storedBook(page);
  expect(book.words).toEqual([{ en: 'allocate', pos: '動', ja: '割り当てる' }]);
  await expect(row).not.toContainText('彼らは');

  // 削除 → 元に戻す(記録も付いたまま戻る)
  await row.getByRole('button', { name: '削除' }).click();
  await expect(page.locator('li.word')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('「allocate」を削除しました');
  await page.locator('#toast').getByRole('button', { name: '元に戻す' }).click();
  await expect(page.locator('li.word', { hasText: 'allocate' })).toHaveCount(1);
  book = await storedBook(page);
  expect(book.words.map((/** @type {{ en: string }} */ w) => w.en)).toEqual(['allocate']);
  expect(book.records.hist['allocate|動']).toEqual([1]);

  // 開き直しても残る(語があるので学習タブから始まる)
  await page.reload();
  await expect(tab(page, '学習')).toHaveAttribute('aria-selected', 'true');
  await tab(page, '単語帳').click();
  await expect(page.locator('li.word', { hasText: 'allocate' })).toHaveCount(1);
});

test('「わからない」のあとに選んだものは記録に入らない(1 問で 1 件)', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('見出し語(英語)').fill('itinerary');
  await page.getByLabel('意味').fill('旅程');
  await page.getByRole('button', { name: '追加する' }).click();
  await tab(page, '学習').click();
  await page.getByRole('button', { name: '始める' }).click();
  await page.getByRole('button', { name: 'わからない', exact: true }).click();
  await expect(page.locator('.stagebanner')).toContainText('不正解として記録済み');
  await page.getByRole('button', { name: '旅程', exact: true }).click();
  await expect(page.locator('.fb')).toContainText('わからないと申告');
  // 2 段階クイズには前へ戻るボタンを出さない(解き直して二重に記録しない)
  await expect(page.getByRole('button', { name: '← 前へ' })).toHaveCount(0);
  const book = await storedBook(page);
  expect(book.records).toEqual({ hist: { 'itinerary|': [0] }, self: { 'itinerary|': [0] } });
  await page.getByRole('button', { name: '次の問題 →' }).click();
  await expect(page.locator('.stem')).toHaveText('結果: 0 / 1');
});

test('4 択を作れない問題はカードで出し、記録せず、前へ戻るボタンも出さない', async ({ page }) => {
  await page.goto('/');
  for (const [en, ja] of [['itinerary', '旅程'], ['tentative', '']]) {
    await page.getByLabel('見出し語(英語)').fill(en);
    await page.getByLabel('意味').fill(ja);
    await page.getByRole('button', { name: '追加する' }).click();
    await expect(page.locator('#content .msg')).toContainText(`「${en}」を追加しました`);
  }
  await tab(page, '学習').click();
  await page.getByRole('button', { name: '始める' }).click();
  let sawCard = false;
  for (let i = 0; i < 2; i++) {
    if (await page.locator('.stagebanner', { hasText: '4 択を作れません' }).count()) {
      sawCard = true;
      await expect(page.locator('.stem')).toHaveText('tentative');
      await expect(page.getByRole('button', { name: '← 前へ' })).toHaveCount(0);
      await page.getByRole('button', { name: '次へ →' }).click();
    } else {
      await page.getByRole('button', { name: 'わかる', exact: true }).click();
      await page.getByRole('button', { name: '旅程', exact: true }).click();
      await page.getByRole('button', { name: '次の問題 →' }).click();
    }
  }
  expect(sawCard, '意味の無い語がカードで出ていない').toBe(true);
  await expect(page.locator('.stem')).toHaveText('結果: 1 / 1');
  const book = await storedBook(page);
  expect(book.records.hist).toEqual({ 'itinerary|': [1] });
  // 陽性対照: カード形式では前へ戻るボタンが出る(上の「0 個」がボタン名の違いで素通りしていないこと)
  await page.getByRole('button', { name: '条件を変える' }).click();
  await page.getByLabel('形式').selectOption('card');
  await page.getByRole('button', { name: '始める' }).click();
  await expect(page.getByRole('button', { name: '← 前へ' })).toHaveCount(1);
});

test('スマホ幅でも、どのタブも横にはみ出さない', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'スマホ幅だけで確かめる');
  await page.goto('/');
  await page.getByLabel('見出し語(英語)').fill('on behalf of the organizing committee of the annual conference');
  await page.getByLabel('意味').fill('年次会議の組織委員会を代表して、とても長い訳語がここに入る場合');
  await page.getByLabel('例文', { exact: true }).fill('Averyveryverylongwordwithoutanyspacesthatcouldoverflowthelayoutonphones.');
  await page.getByRole('button', { name: '追加する' }).click();
  const fits = async (/** @type {string} */ where) => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, where).toBeLessThanOrEqual(iw);
  };
  for (const name of ['学習', '単語帳', '追加', '記録', '設定']) {
    await tab(page, name).click();
    await fits(`${name} タブ`);
  }
  // 各タブの最初の画面以外: クイズの 2 段階・記録の表・単語帳の編集欄
  await tab(page, '学習').click();
  await page.getByRole('button', { name: '始める' }).click();
  await fits('第 1 段階');
  await page.getByRole('button', { name: 'わかる', exact: true }).click();
  await fits('第 2 段階');
  await page.locator('button.choice').first().click();
  await fits('判定のあと');
  await tab(page, '記録').click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await fits('記録の表');
  await tab(page, '単語帳').click();
  await page.getByRole('button', { name: '編集' }).click();
  await fits('編集欄');
});

test('既にある語を追加しようとすると、足さずに編集へ案内する(INV-4)', async ({ page }) => {
  await page.goto('/');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('見出し語(英語)').fill('secure');
    await page.getByLabel('品詞').fill('形');
    await page.getByLabel('意味').fill('安全な');
    await page.getByRole('button', { name: '追加する' }).click();
  }
  await expect(page.locator('#content .msg.err')).toContainText('単語帳から編集');
  const book = await storedBook(page);
  expect(book.words).toHaveLength(1);
});

test('利用者の入力は HTML として解釈しない', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('見出し語(英語)').fill('<img src=x onerror=alert(1)>tag');
  await page.getByLabel('意味').fill('<b>太字</b>');
  await page.getByRole('button', { name: '追加する' }).click();
  await tab(page, '単語帳').click();
  await expect(page.locator('li.word img')).toHaveCount(0);
  await expect(page.locator('li.word b')).toHaveCount(0);
  await expect(page.locator('ul.words')).toContainText('<b>太字</b>');
});
