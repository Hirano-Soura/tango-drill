// 動詞の自他(T-5.7)の画面側: 通知タブの赤い点と既読、自他の印の表示、既存の語に自他を補う流れ
// (通知 → 自他を補う依頼文 → 返答を貼る → 確認表 → 確定)。規則は Docs/25_Notices.md・Docs/20_ImportFormat.md §6。
import { test, expect } from '@playwright/test';
import { transPrompt } from '../../core/aiPrompt.js';
import { emptyBook } from '../../core/book.js';
import { storedBook, seedBook, tab, fits } from './helpers.js';

/**
 * 自他の無い動詞 2 語・自他のある動詞 1 語・名詞 1 語の単語帳
 * @returns {import('../../core/book.js').Book}
 */
const BOOK = () => ({
  ...emptyBook(),
  words: [
    { en: 'reimburse', pos: '動', ja: '払い戻す', ex: 'We reimburse costs.', exJa: '費用を払い戻す。', exSrc: /** @type {const} */ ('self') },
    { en: 'estimate', pos: '名/動', ja: '(名)見積もり ／ (動)見積もる' },
    { en: 'expire', pos: '動', trans: 'vi', ja: '期限が切れる' },
    { en: 'itinerary', pos: '名', ja: '旅程' },
  ],
  added: { 'reimburse|動': '2026-10-01', 'estimate|名/動': '2026-10-01', 'expire|動': '2026-10-01', 'itinerary|名': '2026-10-01' },
});

test('通知タブ: 読んでいない重要なお知らせがあればボタンに赤い点。開くと消え、開き直しても出ない', async ({ page }, info) => {
  await page.goto('/');
  const notice = tab(page, '通知');
  // 名前は「通知」のまま、点は説明で知らせる
  await expect(notice.locator('.dot')).toBeVisible();
  await expect(notice).toHaveAttribute('aria-describedby', 'notice-unread');
  await notice.click();
  await expect(notice).toHaveAttribute('aria-selected', 'true');
  await expect(notice.locator('.dot')).toHaveCount(0);
  // 開いたときに読んでいなかったものには「新着」、重要なものには「重要」
  const trans = page.locator('#notice-2026-10-07-trans');
  await expect(trans).toContainText('新着');
  await expect(trans).toContainText('重要');
  await expect(trans.locator('#trans-count')).toHaveText('今の単語帳には、自他の無い動詞はありません。');
  if (info.project.name === 'phone') await fits(page, '通知タブ');
  // 別のタブへ移って戻ると「新着」は消える。開き直しても点は出ない(端末に覚えている)
  await tab(page, '設定').click();
  await notice.click();
  await expect(trans).not.toContainText('新着');
  await page.reload();
  await expect(tab(page, '通知').locator('.dot')).toHaveCount(0);
});

test('自他の印: 単語帳・学習で品詞の横に「他」「自」「他自」を出し、意味のラベルを小さな印にする', async ({ page }) => {
  await page.goto('/');
  await seedBook(page, { ...BOOK(), words: [...BOOK().words, { en: 'board', pos: '動', trans: 'vt/vi', ja: '搭乗する' }] });
  await tab(page, '単語帳').click();
  const row = (/** @type {string} */ en) => page.locator('li.word', { has: page.locator('.en', { hasText: new RegExp(`^${en}$`) }) });
  await expect(row('expire').locator('.tr.vi')).toHaveText('自');
  await expect(row('expire').locator('.tr')).toHaveAttribute('title', /自動詞/);
  await expect(row('board').locator('.tr.both')).toHaveText('他自');
  await expect(row('reimburse').locator('.tr')).toHaveCount(0);
  await expect(row('estimate').locator('.ja .jl')).toHaveText(['名', '動']);
  // 編集欄で自他を選ぶと保存され、印が出る
  await row('reimburse').getByRole('button', { name: '編集' }).click();
  await page.locator('#edit-form').getByLabel('自他').selectOption({ label: '他動詞(vt)' });
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(row('reimburse').locator('.tr.vt')).toHaveText('他');
  expect((await storedBook(page)).words.find((/** @type {{ en: string }} */ w) => w.en === 'reimburse')?.trans).toBe('vt');
  // 学習(カード)でも品詞の横に出る
  await tab(page, '学習').click();
  await page.getByLabel('出題する語').selectOption({ label: '追加日の古い順' });
  await page.getByLabel('語数').selectOption('all');
  await page.getByLabel('形式').selectOption('card');
  await page.getByRole('button', { name: '始める' }).click();
  await expect(page.locator('.q.card .pos .tr')).toHaveText('他');
});

test('既存の語に自他を補う: 通知から依頼文を作り、返答を貼ると確認表を経て自他だけが埋まる', async ({ page }, info) => {
  await page.goto('/');
  await seedBook(page, BOOK());
  await tab(page, '通知').click();
  await expect(page.locator('#trans-count')).toHaveText('今の単語帳に、自他の無い動詞が 2 語あります。');
  await page.getByRole('button', { name: '自他を補う依頼文を作る' }).click();

  // 追加タブの「AI に頼む」に、自他の無い動詞だけの依頼文が出る(AI へは何も送らない)
  await expect(tab(page, '追加')).toHaveAttribute('aria-selected', 'true');
  const want = transPrompt([{ en: 'reimburse', pos: '動' }, { en: 'estimate', pos: '名/動' }]);
  await expect(page.getByLabel('AI への依頼文(自他を補う)')).toHaveValue(want);
  if (info.project.name === 'phone') await fits(page, '自他を補う依頼文');
  // 依頼文を作っても単語帳は変わらない
  expect((await storedBook(page)).words).toEqual(BOOK().words);

  // AI の返答(見出し語と品詞を書き写して自他を添えたもの)を貼る → 確認表 → 確定
  await page.getByLabel('貼り付ける内容').fill('```\nreimburse | 動(他)\nestimate | 名/動(他)\n```');
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(page.locator('#plan li.prow .act')).toHaveText(['既存の語に重ねる', '既存の語に重ねる']);
  await expect(page.locator('#plan')).toContainText('埋める項目: 自他');
  expect((await storedBook(page)).words).toEqual(BOOK().words);
  await page.getByRole('button', { name: '確定して取り込む' }).click();
  await expect(page.locator('#toast')).toContainText('取り込みました(追加 0 語・更新 2 語)');

  // 自他だけが埋まり、意味・例文・出どころは変わらない
  const words = (await storedBook(page)).words;
  expect(words.map((/** @type {{ trans?: string }} */ w) => w.trans)).toEqual(['vt', 'vt', 'vi', undefined]);
  expect(words.map(({ trans, ...rest }) => rest)).toEqual(BOOK().words.map(({ trans, ...rest }) => rest));
  // 自他の無い動詞が無くなれば、補う案内も消える
  await expect(page.locator('#ai-trans-note')).toHaveCount(0);
  await tab(page, '通知').click();
  await expect(page.locator('#trans-count')).toHaveText('今の単語帳には、自他の無い動詞はありません。');
});
