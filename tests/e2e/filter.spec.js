// 単語帳タブの絞り込み欄: 日本語入力(IME)の変換中に欄が作り直されず、変換した語で絞り込めること。
// 打つたびにタブ全体を描き直すと欄が差し替わり、変換が 1 文字ごとに切れる(「rいngお」になる)。
import { test, expect } from '@playwright/test';
import { tab } from './helpers.js';

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} en
 * @param {string} ja
 * @param {string} [pos]
 */
async function addWord(page, en, ja, pos = '名') {
  await page.getByLabel('見出し語(英語)').fill(en);
  await page.getByLabel('品詞').fill(pos);
  await page.getByLabel('意味').fill(ja);
  await page.getByRole('button', { name: '追加する' }).click();
  await expect(page.locator('#add-msg')).toContainText(`「${en}」を追加しました`);
}

test('絞り込み欄は変換中に作り直されず、変換した語で絞り込める', async ({ page }) => {
  await page.goto('/');
  await addWord(page, 'apple', 'リンゴ');
  await addWord(page, 'orange', 'オレンジ');
  await tab(page, '単語帳').click();
  await expect(page.locator('li.word')).toHaveCount(2);

  const q = page.locator('#q');
  await q.click();
  await q.evaluate((el) => { /** @type {any} */ (el).__mark = true; });

  // 変換中の文字を 1 文字ずつ伸ばしてから確定する(Chromium の IME を CDP で模す)
  const cdp = await page.context().newCDPSession(page);
  for (const text of ['r', 'り', 'りn', 'りん', 'りんg', 'りんご', 'リンゴ']) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  }
  await cdp.send('Input.insertText', { text: 'リンゴ' });

  // 同じ欄のまま(差し替わっていない)
  expect(await q.evaluate((el) => /** @type {any} */ (el).__mark === true)).toBe(true);
  await expect(q).toHaveValue('リンゴ');
  await expect(q).toBeFocused();
  await expect(page.locator('li.word')).toHaveCount(1);
  await expect(page.locator('li.word')).toContainText('apple');

  // 英字の絞り込みと、当たらないときの表示
  await q.fill('ora');
  await expect(page.locator('li.word')).toHaveCount(1);
  await expect(page.locator('li.word')).toContainText('orange');
  await q.fill('zzz');
  await expect(page.locator('li.word')).toHaveCount(0);
  await expect(page.locator('.empty')).toContainText('絞り込みに当たる語がありません');
  await q.fill('');
  await expect(page.locator('li.word')).toHaveCount(2);

  // 絞り込んだまま印を付けても、欄の文字と絞り込みは残る
  await q.fill('app');
  await page.locator('li.word').getByRole('button', { name: '印' }).click();
  await expect(page.locator('li.word .star.on')).toHaveCount(1);
  await expect(page.locator('#q')).toHaveValue('app');
  await expect(page.locator('li.word')).toHaveCount(1);
});

test('品詞の名前・「句表現」・空白区切りの AND で絞り込める(規則の細部は tests/core/search.test.js)', async ({ page }) => {
  await page.goto('/');
  await addWord(page, 'apple', 'リンゴ');
  await addWord(page, 'despite', '～にもかかわらず', '前');
  await addWord(page, 'in accordance with', '～に従って', '前置詞句');
  await addWord(page, 'deal with', '～に対処する', '動詞句');
  await tab(page, '単語帳').click();
  await expect(page.locator('li.word')).toHaveCount(4);

  const q = page.locator('#q');
  /** @param {string} text @param {string[]} expected */
  const shows = async (text, expected) => {
    await q.fill(text);
    await expect(page.locator('li.word .en'), text).toHaveText(expected);
  };
  await shows('名詞', ['apple']);
  await shows('前置詞', ['despite', 'in accordance with']);
  await shows('句表現', ['in accordance with', 'deal with']);
  await shows('with 従', ['in accordance with']);
  await shows('句表現　前置詞', ['in accordance with']);
  await shows('動詞 リンゴ', []);
});
