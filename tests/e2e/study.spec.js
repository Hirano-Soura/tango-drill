// 学習タブの出題順・語数の選択と、中断・再開(Docs/23_Screens.md §4、Docs/21_Quiz.md §7)。
import { test, expect } from '@playwright/test';
import { seedBook, storedBook, tab, fits } from './helpers.js';

/** @typedef {import('@playwright/test').Page} Page */

/**
 * 回答数・正答率・最後の回答日時がばらばらの 5 語。
 * - 回答数の少ない順: secure(0) → itinerary(1) → tentative(2) → allocate(3) → budget(4)
 * - 正答率の低い順: itinerary(0%) → budget(25%) → tentative(50%) → allocate(100%) → secure(回答なし)
 * - 最後に解いてから時間がたった順: secure(回答なし) → itinerary(日時なし) → tentative(9/20) → budget(9/25) → allocate(9/29)
 * @returns {import('../../core/book.js').Book}
 */
const BOOK = () => ({
  words: [
    { en: 'allocate', pos: '動', ja: '割り当てる' },
    { en: 'tentative', pos: '形', ja: '仮の' },
    { en: 'itinerary', pos: '名', ja: '旅程' },
    { en: 'secure', pos: '形', ja: '安全な' },
    { en: 'budget', pos: '名', ja: '予算' },
  ],
  added: {
    'allocate|動': '2026-09-01', 'tentative|形': '2026-09-02', 'itinerary|名': '2026-09-03', 'secure|形': '2026-09-04', 'budget|名': '2026-09-05',
  },
  records: {
    hist: { 'allocate|動': [1, 1, 1], 'tentative|形': [0, 1], 'itinerary|名': [0], 'budget|名': [1, 0, 0, 0] },
    self: {},
    last: { 'allocate|動': '2026-09-29T00:00:00.000Z', 'tentative|形': '2026-09-20T00:00:00.000Z', 'budget|名': '2026-09-25T00:00:00.000Z' },
  },
  starred: [],
});

/**
 * カード形式で最後までめくり、出た見出し語を順に返す(カードは記録しないので、単語帳を変えずに並びだけを見られる)。
 * @param {Page} page
 * @param {string} source 出題する語の選択肢の表示名
 * @param {string} count 語数の選択肢の値
 */
async function cardOrder(page, source, count) {
  await page.getByLabel('出題する語').selectOption({ label: source });
  await page.getByLabel('語数').selectOption(count);
  await page.getByLabel('形式').selectOption('card');
  await page.getByRole('button', { name: '始める' }).click();
  const out = [];
  while (!(await page.getByText('枚を見終わりました').count())) {
    out.push(await page.locator('.stem').textContent());
    await page.getByRole('button', { name: '次へ →' }).click();
  }
  await page.getByRole('button', { name: '条件を変える' }).click();
  return out;
}

test('出題順を選ぶと、その順で選んだ語数だけ出る。復習ミックスでは語数を選べない', async ({ page }) => {
  await page.goto('/');
  await seedBook(page, BOOK());
  await tab(page, '学習').click();
  await expect(page.getByLabel('語数')).toBeDisabled();
  expect(await cardOrder(page, '回答数の少ない順', 'all')).toEqual(['secure', 'itinerary', 'tentative', 'allocate', 'budget']);
  expect(await cardOrder(page, '正答率の低い順', '10')).toEqual(['itinerary', 'budget', 'tentative', 'allocate', 'secure']);
  expect(await cardOrder(page, '最後に解いてから時間がたった順', 'all')).toEqual(['secure', 'itinerary', 'tentative', 'budget', 'allocate']);
  expect(await cardOrder(page, '追加日の新しい順', 'all')).toEqual(['budget', 'secure', 'itinerary', 'tentative', 'allocate']);
  expect(await cardOrder(page, '追加日の古い順', 'all')).toEqual(['allocate', 'tentative', 'itinerary', 'secure', 'budget']);
  expect((await cardOrder(page, 'すべての語(シャッフル)', 'all')).sort()).toEqual(['allocate', 'budget', 'itinerary', 'secure', 'tentative']);
  // 語数の選択が効く(陽性対照: 上の「すべて」で 5 語出ている)
  await page.getByLabel('出題する語').selectOption({ label: '正答率の低い順' });
  await page.getByLabel('語数').selectOption('10');
  await page.getByLabel('形式').selectOption('choice');
  await page.getByRole('button', { name: '始める' }).click();
  await expect(page.locator('.stem')).toHaveText('itinerary');
  await expect(page.locator('p.meta').first()).toContainText('1 / 5 ｜ 正答 0 ｜ 第 1 段階 ｜ 正答率 0%(1 回)');
  // 5 語より少ない語数を選べるよう、単語帳を 12 語にして 10 語に切り詰まることを見る
  const big = BOOK();
  for (let i = 0; i < 7; i++) {
    big.words.push({ en: `word${i}`, pos: '名', ja: `語${i}` });
    big.added[`word${i}|名`] = '2026-09-06';
  }
  await seedBook(page, big);
  await tab(page, '学習').click();
  await page.getByLabel('出題する語').selectOption({ label: '回答数の少ない順' });
  await page.getByLabel('語数').selectOption('10');
  await page.getByRole('button', { name: '始める' }).click();
  await expect(page.locator('p.meta').first()).toContainText('1 / 10');
});

test('中断すると、ここまでの結果を出し、別のタブへ移っても続きから再開できる。記録は二重にならない', async ({ page }) => {
  await page.goto('/');
  await seedBook(page, BOOK());
  await tab(page, '学習').click();
  await page.getByLabel('出題する語').selectOption({ label: '回答数の少ない順' });
  await page.getByLabel('語数').selectOption('all');
  await page.getByRole('button', { name: '始める' }).click();
  // 1 問目: 正解してから次へ進む
  await expect(page.locator('.stem')).toHaveText('secure');
  await page.getByRole('button', { name: 'わかる', exact: true }).click();
  await page.getByRole('button', { name: '安全な', exact: true }).click();
  await page.getByRole('button', { name: '次の問題 →' }).click();
  // 2 問目: 「わからない」で記録したところ(第 2 段階)で中断する
  await expect(page.locator('.stem')).toHaveText('itinerary');
  await page.getByRole('button', { name: 'わからない', exact: true }).click();
  await expect(page.locator('.stagebanner')).toContainText('不正解として記録済み');
  await page.getByRole('button', { name: '中断' }).click();
  await expect(page.getByRole('heading', { name: '学習(中断中)' })).toBeVisible();
  await expect(page.locator('.panel')).toContainText('2 / 5 問目で中断しています ｜ ここまでの正答 1 / 2');
  await fits(page, '中断中の画面');
  // 別のタブへ移って戻っても中断したまま
  await tab(page, '記録').click();
  await tab(page, '学習').click();
  await expect(page.getByRole('heading', { name: '学習(中断中)' })).toBeVisible();
  // 再開すると、中断した段階(第 2 段階・記録済み)から続く
  await page.getByRole('button', { name: '続きから再開' }).click();
  await expect(page.locator('.stem')).toHaveText('itinerary');
  await expect(page.locator('.stagebanner')).toContainText('不正解として記録済み');
  await page.getByRole('button', { name: '旅程', exact: true }).click();
  let book = await storedBook(page);
  expect(book.records.hist['secure|形']).toEqual([1]);
  expect(book.records.hist['itinerary|名']).toEqual([0, 0]);
  // 第 1 段階でも中断でき、やめると条件の選択に戻る(記録は残る)
  await page.getByRole('button', { name: '次の問題 →' }).click();
  await page.getByRole('button', { name: '中断' }).click();
  await page.getByRole('button', { name: 'やめて条件を変える' }).click();
  await expect(page.getByRole('button', { name: '始める' })).toBeVisible();
  book = await storedBook(page);
  expect(book.records.hist['itinerary|名']).toEqual([0, 0]);
  expect(Object.keys(book.records.last ?? {}).sort()).toEqual(['allocate|動', 'budget|名', 'itinerary|名', 'secure|形', 'tentative|形']);
});

test('カード形式でも中断・再開でき、中断したカードから続く', async ({ page }) => {
  await page.goto('/');
  await seedBook(page, BOOK());
  await tab(page, '学習').click();
  await page.getByLabel('出題する語').selectOption({ label: '追加日の古い順' });
  await page.getByLabel('形式').selectOption('card');
  await page.getByRole('button', { name: '始める' }).click();
  await page.getByRole('button', { name: '次へ →' }).click();
  await expect(page.locator('.stem')).toHaveText('tentative');
  await page.getByRole('button', { name: '中断' }).click();
  await expect(page.locator('.panel')).toContainText('2 / 5 問目で中断しています');
  await expect(page.locator('.panel')).not.toContainText('正答');
  await page.getByRole('button', { name: '続きから再開' }).click();
  await expect(page.locator('.stem')).toHaveText('tentative');
});
