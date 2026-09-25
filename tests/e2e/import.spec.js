// T-5.1: 取り込みは 貼り付け → 確認表 → 確定 の順を経ないと単語帳を変えない(INV-2 の画面側)。
// 確認表の規則そのもの(行の種類・重ね方)は tests/core/importPlan.test.js が見る。ここでは画面が必ずそれを通すことを見る。
import { test, expect } from '@playwright/test';
import { storedBook, fits } from './helpers.js';
import { SIMPLE_EXAMPLE } from '../../core/importFormat.js';

/** @typedef {import('@playwright/test').Page} Page */

/**
 * 追加タブの 1 語の欄で足す。
 * @param {Page} page
 * @param {string} en
 * @param {string} pos
 * @param {string} ja
 */
async function addByForm(page, en, pos, ja) {
  await page.getByLabel('見出し語(英語)').fill(en);
  await page.getByLabel('品詞').fill(pos);
  await page.getByLabel('意味').fill(ja);
  await page.getByRole('button', { name: '追加する' }).click();
  await expect(page.locator('#add-msg')).toContainText(`「${en}」を追加しました`);
}

/**
 * 確認表の行(見出し語で探す)。
 * @param {Page} page
 * @param {string} en
 */
const planRow = (page, en) => page.locator('#plan li.prow', { has: page.locator('.en', { hasText: en }) });

/** @param {Page} page */
const words = async (page) => (await storedBook(page)).words;

test('貼り付け → 確認表 → 選択 → 確定 の順を経て初めて単語帳が変わり、元に戻せる(INV-2)', async ({ page }) => {
  await page.goto('/');
  await addByForm(page, 'allocate', '動', '割り当てる');
  const before = [{ en: 'allocate', pos: '動', ja: '割り当てる' }];

  await page.getByLabel('貼り付ける内容').fill([
    'Averyveryverylongwordwithoutanyspacesthatcouldoverflowthelayoutonphones の一覧です。',
    '| 見出し語 | 品詞 | 意味 |',
    '|---|---|---|',
    '| allocate | 動 | 配分する |',
    '| reimburse | 動 | 払い戻す |',
    '| itinerary | 名 | <b>旅程</b> |',
  ].join('\n'));
  // 貼り付けただけでは変わらない
  expect(await words(page)).toEqual(before);

  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(page.locator('#plan li.prow')).toHaveCount(5);
  await expect(page.locator('#plan li.prow .act')).toHaveText(['語ではない行', '語ではない行', '既存の語に重ねる', '足す', '足す']);
  await expect(planRow(page, 'allocate')).toContainText('単語帳「割り当てる」 ／ 入力「配分する」');
  // 確認表の中でも入力は HTML として解釈しない
  await expect(page.locator('#plan b')).toHaveCount(0);
  await expect(planRow(page, 'itinerary')).toContainText('<b>旅程</b>');
  await fits(page, '確認表');
  // 確認表を作っただけでは変わらない
  expect(await words(page)).toEqual(before);

  // 行ごとに選ぶ: reimburse は外す、allocate は食い違いも上書きする。選んだだけでは変わらない
  await planRow(page, 'reimburse').locator('select').selectOption('skip');
  await planRow(page, 'allocate').locator('select').selectOption('overwrite');
  expect(await words(page)).toEqual(before);

  await page.getByRole('button', { name: '確定して取り込む' }).click();
  await expect(page.locator('#toast')).toContainText('取り込みました(追加 1 語・更新 1 語)');
  await expect(page.locator('#plan')).toHaveCount(0);
  const book = await storedBook(page);
  expect(book.words).toEqual([{ en: 'allocate', pos: '動', ja: '配分する' }, { en: 'itinerary', pos: '名', ja: '<b>旅程</b>' }]);
  expect(Object.keys(book.added).sort()).toEqual(['allocate|動', 'itinerary|名']);

  // 元に戻すと取り込む前の単語帳に戻る
  await page.locator('#toast').getByRole('button', { name: '元に戻す' }).click();
  await expect(page.locator('#toast')).toContainText('元に戻しました');
  expect(await words(page)).toEqual(before);
});

test('確認表を作ったあとに単語帳が変わったら確定させない。作り直せば取り込める', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('貼り付ける内容').fill('itinerary | 名 | 旅程');
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(planRow(page, 'itinerary')).toContainText('足す');

  // 確認表を出したまま、1 語の欄で別の語を足す
  await addByForm(page, 'tentative', '形', '仮の');
  await page.getByRole('button', { name: '確定して取り込む' }).click();
  await expect(page.locator('#import-msg.err')).toContainText('単語帳が変わりました');
  expect((await words(page)).map((w) => w.en)).toEqual(['tentative']);

  // 陽性対照: 同じ内容で確認表を作り直すと取り込める(上の「変わらない」が操作の失敗で素通りしていないこと)
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await page.getByRole('button', { name: '確定して取り込む' }).click();
  await expect(page.locator('#toast')).toContainText('取り込みました(追加 1 語・更新 0 語)');
  expect((await words(page)).map((w) => w.en)).toEqual(['tentative', 'itinerary']);
});

test('やめると単語帳は変わらない。ファイルからも同じ確認表を通す', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('ファイルから読む').setInputFiles('tests/core/fixtures/import/tango-drill_v1.json');
  await expect(page.getByLabel('貼り付ける内容')).toHaveValue(/"format": "tango-drill\/v1"/);
  expect(await words(page)).toEqual([]);

  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(page.locator('#plan li.prow')).toHaveCount(4);
  await page.getByRole('button', { name: 'やめる' }).click();
  await expect(page.locator('#plan')).toHaveCount(0);
  await expect(page.locator('#import-msg')).toContainText('取り込みをやめました');
  expect(await words(page)).toEqual([]);

  // 内容を変えると、作ってあった確認表は捨てる(古い確認表で確定させない)
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await page.getByLabel('貼り付ける内容').fill('reimburse | 動 | 払い戻す');
  await page.getByLabel('全部の語に付けるタグ(読点・カンマ区切り)').fill('第4週');
  await expect(page.locator('#plan')).toHaveCount(0);
  await expect(page.locator('#import-msg')).toContainText('作り直してください');

  // 作り直して確定すると、タグの既定も付いて入る
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(planRow(page, 'reimburse')).toContainText('#第4週');
  await page.getByRole('button', { name: '確定して取り込む' }).click();
  expect(await words(page)).toEqual([{ en: 'reimburse', pos: '動', ja: '払い戻す', tags: ['第4週'] }]);
});

test('当て先の決まらない行は、既定では取り込まず、選んだ語にだけ当てる', async ({ page }) => {
  await page.goto('/');
  await addByForm(page, 'secure', '形', '安全な');
  await addByForm(page, 'secure', '動', '確保する');
  const before = await words(page);

  await page.getByLabel('貼り付ける内容').fill('secure | | | | | 補足メモ');
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(planRow(page, 'secure').locator('.act')).toHaveText('当て先を選ぶ');
  await page.getByRole('button', { name: '確定して取り込む' }).click();
  await expect(page.locator('#import-msg')).toContainText('取り込む語がありませんでした');
  expect(await words(page)).toEqual(before);

  await page.getByRole('button', { name: '確認表を作る' }).click();
  await planRow(page, 'secure').locator('select').selectOption({ label: 'secure(動) に当てる' });
  await page.getByRole('button', { name: '確定して取り込む' }).click();
  await expect(page.locator('#toast')).toContainText('取り込みました(追加 0 語・更新 1 語)');
  expect(await words(page)).toEqual([
    { en: 'secure', pos: '形', ja: '安全な' },
    { en: 'secure', pos: '動', ja: '確保する', note: '補足メモ' },
  ]);
});

test('空の貼り付け欄には例を灰色で見せ(値は空)、「例を入れる」で入れた例はそのまま取り込める。入力があるときは例で消さない', async ({ page }) => {
  await page.goto('/');
  const box = page.getByLabel('貼り付ける内容');
  const btn = page.getByRole('button', { name: '例を入れる' });
  // 例は placeholder(値ではない)。そのまま「確認表を作る」を押すと、空の入力として断る
  await expect(box).toHaveAttribute('placeholder', SIMPLE_EXAMPLE);
  await expect(box).toHaveValue('');
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(page.locator('#plan')).toContainText('入力が空です');

  await btn.click();
  await expect(box).toHaveValue(SIMPLE_EXAMPLE);
  await expect(btn).toBeDisabled();
  await page.getByRole('button', { name: '確認表を作る' }).click();
  await expect(page.locator('#plan li.prow .act')).toHaveText(['足す', '足す', '足す']);
  await fits(page, '例の確認表');

  // 入力があるあいだは押せない。空にすると押せる
  await box.fill('reimburse | 動 | 払い戻す');
  await expect(btn).toBeDisabled();
  await box.fill('');
  await expect(btn).toBeEnabled();
  expect(await words(page)).toEqual([]);
});
