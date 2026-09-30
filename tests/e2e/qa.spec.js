// Q&A タブ: よくある質問と改善アンケートの欄が追加タブと同じに開閉でき、アンケートは新しいタブで開くリンクであること。
// アンケートを実際には開かない(外部へつながない)。リンクの行き先と開き方だけを見る。
import { test, expect } from '@playwright/test';
import { SURVEY_URL } from '../../app/links.js';
import { VERSION } from '../../core/version.js';
import { tab, fits } from './helpers.js';

test('Q&A タブ: 質問を開ける・欄の開閉がタブを移っても残る・アンケートは新しいタブで開くリンク', async ({ page }) => {
  await page.goto('/');
  await tab(page, 'Q&A').click();
  await expect(tab(page, 'Q&A')).toHaveAttribute('aria-selected', 'true');

  // 2 つの欄は既定で開いている(追加タブの欄と同じ)
  const qaPanel = page.locator('#qa-panel');
  const survey = page.locator('#survey-panel');
  await expect(qaPanel).toHaveAttribute('open', '');
  await expect(survey).toHaveAttribute('open', '');

  // 質問は閉じていて、押すと答えが出る
  const q = page.locator('details.qa', { hasText: '別の端末に移したい' });
  await expect(q.locator('p')).toBeHidden();
  await q.locator('summary').click();
  await expect(q.locator('p')).toContainText('書き出す');

  // アンケート: 新しいタブで開き、開いた先から元のページを触らせない
  const link = page.getByRole('link', { name: 'アンケートを開く' });
  await expect(link).toHaveAttribute('href', SURVEY_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  // 不具合の報告に添えられるよう、アプリのバージョンを出す(設定タブと同じ core/version.js の値)
  await expect(page.locator('#qa-version')).toContainText(VERSION);

  // 閉じた欄はタブを移って戻っても閉じたまま
  await qaPanel.locator('summary').first().click();
  await expect(qaPanel).not.toHaveAttribute('open', '');
  await tab(page, '設定').click();
  await tab(page, 'Q&A').click();
  await expect(page.locator('#qa-panel')).not.toHaveAttribute('open', '');
  await expect(page.locator('#survey-panel')).toHaveAttribute('open', '');

  await page.locator('#qa-panel summary').first().click();
  await page.locator('details.qa summary').first().click();
  await fits(page, 'Q&A タブ(質問を開いたところ)');
});
