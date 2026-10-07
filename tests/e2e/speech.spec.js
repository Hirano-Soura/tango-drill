// 読み上げ(Docs/24_Speech.md、Docs/23_Screens.md §4)。音声合成は偽物に差し替え、読ませた文と音声を記録して確かめる。
// 実際の声の聞こえ方は見ない(端末とブラウザで変わるため。Docs/24_Speech.md §5 の実機の確認)。
import { test, expect } from '@playwright/test';
import { seedBook, tab, fits } from './helpers.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{ text: string, voice: string | undefined, lang: string, rate: number }} Spoken */

/** 実際の Windows の Edge に近い一覧: 端末内の英語 2 つ・日本語 1 つと、インターネット経由の英語 2 つ */
const EDGE_LIKE = [
  { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false },
  { name: 'Microsoft Haruka - Japanese (Japan)', lang: 'ja-JP', localService: true },
  { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true },
  { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
  { name: 'Google US English', lang: 'en-US', localService: false },
];

/**
 * 音声合成を偽物に差し替える。voices が null なら音声合成を持たないブラウザにする。
 * late なら、一覧は window.__deliver() を呼ぶまで空で、呼ぶと voiceschanged を出す(一覧があとから届くブラウザ)。
 * 読ませた文は window.__spoken に、止める(cancel)と読む(speak)の順は window.__log に残す。
 * @param {Page} page
 * @param {{ name: string, lang: string, localService: boolean }[] | null} voices
 * @param {{ late?: boolean }} [opts]
 */
async function fakeSpeech(page, voices, opts = {}) {
  await page.addInitScript(([list, late]) => {
    const w = /** @type {any} */ (window);
    if (list === null) {
      Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true });
      return;
    }
    const voiceObjs = list.map((v) => ({ ...v, voiceURI: v.name, default: false }));
    let delivered = !late;
    w.__spoken = [];
    w.__log = [];
    const synth = new EventTarget();
    Object.assign(synth, {
      getVoices: () => (delivered ? voiceObjs : []),
      speak: (/** @type {any} */ u) => {
        w.__spoken.push({ text: u.text, voice: u.voice?.name, lang: u.lang, rate: u.rate });
        w.__log.push('speak');
      },
      cancel: () => w.__log.push('cancel'),
    });
    w.__deliver = () => {
      delivered = true;
      synth.dispatchEvent(new Event('voiceschanged'));
    };
    class Utterance {
      /** @param {string} text */
      constructor(text) { this.text = text; this.voice = null; this.lang = ''; this.rate = 1; }
    }
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
  }, /** @type {const} */ ([voices, !!opts.late]));
}

/** @param {Page} page @returns {Promise<string | undefined>} 最後の音声合成の操作 */
const lastOp = (page) => page.evaluate(() => /** @type {any} */ (window).__log.at(-1));

/** @param {Page} page @returns {Promise<Spoken[]>} */
const spoken = (page) => page.evaluate(() => /** @type {any} */ (window).__spoken);

/** @returns {import('../../core/book.js').Book} */
const BOOK = () => ({
  words: [
    { en: 'be aware of A', pos: '句', ja: '～に気づいている', ex: 'Please be aware of the new policy.', exJa: '新しい方針に注意してください。' },
    { en: 'allocate', pos: '動', ja: '割り当てる' },
    { en: 'tentative', pos: '形', ja: '仮の' },
    { en: 'itinerary', pos: '名', ja: '旅程' },
  ],
  added: { 'be aware of A|句': '2026-09-01', 'allocate|動': '2026-09-02', 'tentative|形': '2026-09-03', 'itinerary|名': '2026-09-04' },
  records: { hist: {}, self: {}, last: {} },
  starred: [],
});

/**
 * 追加日の古い順(先頭が be aware of A)で始める。
 * @param {Page} page
 * @param {'choice' | 'card'} format
 */
async function startOldest(page, format) {
  await tab(page, '学習').click();
  await page.getByLabel('出題する語').selectOption({ label: '追加日の古い順' });
  await page.getByLabel('形式').selectOption(format);
  await page.getByRole('button', { name: '始める' }).click();
  await expect(page.locator('.stem')).toHaveText('be aware of A');
}

test('設定: 音声の一覧は端末内の英語の音声だけ。インターネット経由の音声は出さず、出さない理由を添える(INV-1)', async ({ page }) => {
  await fakeSpeech(page, EDGE_LIKE);
  await page.goto('/');
  await tab(page, '設定').click();
  const opts = await page.getByLabel('音声', { exact: true }).locator('option').allTextContents();
  expect(opts).toEqual([
    '自動(Microsoft Zira - English (United States))',
    'Microsoft Zira - English (United States)(en-US)',
    'Microsoft David - English (United States)(en-US)',
  ]);
  await expect(page.locator('#speech-note')).toContainText('インターネット経由の英語の音声(2 個)');
  await page.getByRole('button', { name: '試し聞き' }).click();
  expect((await spoken(page)).map((s) => s.voice)).toEqual(['Microsoft Zira - English (United States)']);
  // 音声と速さを選ぶと保存され、試しに読む
  await page.getByLabel('音声', { exact: true }).selectOption({ label: 'Microsoft David - English (United States)(en-US)' });
  await page.getByLabel('速さ').selectOption({ label: 'ゆっくり' });
  await expect.poll(async () => (await spoken(page)).length).toBe(3);
  const last = (await spoken(page)).at(-1);
  expect(last).toMatchObject({ voice: 'Microsoft David - English (United States)', rate: 0.7, lang: 'en-US' });
  await page.reload();
  await tab(page, '設定').click();
  await expect(page.getByLabel('速さ')).toHaveValue('0.7');
  await expect(page.getByLabel('音声', { exact: true })).toHaveValue('Microsoft David - English (United States)');
  await fits(page, '設定タブ(読み上げ)');
});

test('学習: 「発音」で見出し語を読む(句表現の目印は読まない)。自動読み上げは切っていれば読まず、入れると 1 問に 1 度だけ読む', async ({ page }) => {
  await fakeSpeech(page, EDGE_LIKE);
  await page.goto('/');
  await seedBook(page, BOOK());
  await startOldest(page, 'choice');
  expect(await spoken(page)).toEqual([]);
  await page.getByRole('button', { name: '発音' }).click();
  expect(await spoken(page)).toEqual([{ text: 'be aware of', voice: 'Microsoft Zira - English (United States)', lang: 'en-US', rate: 0.9 }]);
  // 答えたあとは例文も読める
  await page.getByRole('button', { name: 'わかる' }).click();
  await page.getByRole('button', { name: '～に気づいている' }).click();
  await page.getByRole('button', { name: '例文を聞く' }).click();
  expect((await spoken(page)).at(-1)?.text).toBe('Please be aware of the new policy.');
  await fits(page, '学習(判定のあと・読み上げのボタン)');

  // 自動読み上げを入れる
  await page.getByRole('button', { name: '中断' }).click();
  await page.getByRole('button', { name: 'やめて条件を変える' }).click();
  await tab(page, '設定').click();
  await page.getByLabel('問題を出したときに見出し語を自動で読み上げる').check();
  await page.evaluate(() => { /** @type {any} */ (window).__spoken.length = 0; });
  await startOldest(page, 'choice');
  await expect.poll(() => spoken(page)).toEqual([{ text: 'be aware of', voice: 'Microsoft Zira - English (United States)', lang: 'en-US', rate: 0.9 }]);
  // 第 2 段階・判定のあと・中断と再開の描き直しでは読み直さない
  await page.getByRole('button', { name: 'わかる' }).click();
  await page.getByRole('button', { name: '～に気づいている' }).click();
  await page.getByRole('button', { name: '中断' }).click();
  await page.getByRole('button', { name: '続きから再開' }).click();
  expect((await spoken(page)).length).toBe(1);
  // 次の問題で 1 度読む
  await page.getByRole('button', { name: '次の問題 →' }).click();
  await expect(page.locator('.stem')).toHaveText('allocate');
  expect((await spoken(page)).map((s) => s.text)).toEqual(['be aware of', 'allocate']);
});

test('学習(カード): 「発音」を押してもカードはめくれない。裏を見せると例文を読める', async ({ page }) => {
  await fakeSpeech(page, EDGE_LIKE);
  await page.goto('/');
  await seedBook(page, BOOK());
  await startOldest(page, 'card');
  await page.getByRole('button', { name: '発音' }).click();
  await expect(page.getByText('タップで意味を表示')).toBeVisible();
  await page.locator('.q.card').click();
  await page.getByRole('button', { name: '例文を聞く' }).click();
  expect((await spoken(page)).map((s) => s.text)).toEqual(['be aware of', 'Please be aware of the new policy.']);
});

test('INV-1: 英語の音声がインターネット経由のものしか無ければ、読まない(ボタンは押せず、設定に理由を出す)', async ({ page }) => {
  await fakeSpeech(page, EDGE_LIKE.filter((v) => !v.localService || !v.lang.startsWith('en')));
  await page.goto('/');
  await seedBook(page, BOOK());
  await tab(page, '設定').click();
  await expect(page.locator('#speech-note')).toContainText('使える英語の音声がありません(インターネット経由の音声が 2 個');
  await expect(page.getByRole('button', { name: '試し聞き' })).toBeDisabled();
  await expect(page.getByLabel('問題を出したときに見出し語を自動で読み上げる')).toBeDisabled();
  await startOldest(page, 'choice');
  await expect(page.getByRole('button', { name: '発音' })).toBeDisabled();
  expect(await spoken(page)).toEqual([]);
});

test('読み上げを持たないブラウザでは、ボタンを出さず、設定にそう出す', async ({ page }) => {
  await fakeSpeech(page, null);
  await page.goto('/');
  await seedBook(page, BOOK());
  await startOldest(page, 'choice');
  await expect(page.getByRole('button', { name: '発音' })).toHaveCount(0);
  await tab(page, '設定').click();
  await expect(page.locator('#speech-note')).toContainText('このブラウザは読み上げに対応していません');
});

/**
 * 設定を保存層へそのまま置いて開き直す(音声の一覧が無い間は、画面から自動読み上げを入れられないため)。
 * @param {Page} page
 * @param {Partial<import('../../app/storage.js').Settings>} settings
 */
async function seedSettings(page, settings) {
  await page.evaluate(async (x) => {
    const path = '/app/storage.js';
    const { openStorage, DEFAULT_SETTINGS } = /** @type {typeof import('../../app/storage.js')} */ (await import(path));
    const s = await openStorage(indexedDB);
    await s.saveSettings({ ...DEFAULT_SETTINGS, ...x });
    s.close();
  }, settings);
  await page.reload();
}

test('読んでいる途中でも、タブを移る・中断する・やめると止める', async ({ page }) => {
  await fakeSpeech(page, EDGE_LIKE);
  await page.goto('/');
  await seedBook(page, BOOK());
  await startOldest(page, 'choice');
  await page.getByRole('button', { name: '発音' }).click();
  expect(await lastOp(page)).toBe('speak');
  await page.getByRole('button', { name: '中断' }).click();
  expect(await lastOp(page)).toBe('cancel');
  await page.getByRole('button', { name: '続きから再開' }).click();
  await page.getByRole('button', { name: '発音' }).click();
  expect(await lastOp(page)).toBe('speak');
  await tab(page, '単語帳').click();
  expect(await lastOp(page)).toBe('cancel');
  // やめる: カードの最後の 1 枚を読ませてから、見終わりの画面で「条件を変える」
  await tab(page, '学習').click();
  await page.getByRole('button', { name: '中断' }).click();
  await page.getByRole('button', { name: 'やめて条件を変える' }).click();
  await startOldest(page, 'card');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '次へ →' }).click();
  await page.getByRole('button', { name: '発音' }).click();
  await page.getByRole('button', { name: '次へ →' }).click();
  expect(await lastOp(page)).toBe('speak');
  await page.getByRole('button', { name: '条件を変える' }).click();
  expect(await lastOp(page)).toBe('cancel');
});

test('音声の一覧があとから届くと、学習タブと設定タブを描き直す。届く前に出した問題は、届いたときに自動で読む', async ({ page }) => {
  await fakeSpeech(page, EDGE_LIKE, { late: true });
  await page.goto('/');
  await seedBook(page, BOOK());
  await seedSettings(page, { speechAuto: true });
  await startOldest(page, 'choice');
  await expect(page.getByRole('button', { name: '発音' })).toBeDisabled();
  expect(await spoken(page)).toEqual([]);
  await page.evaluate(() => /** @type {any} */ (window).__deliver());
  await expect(page.getByRole('button', { name: '発音' })).toBeEnabled();
  expect((await spoken(page)).map((s) => s.text)).toEqual(['be aware of']);
  // 設定タブも、届いた一覧で描き直す
  await page.reload();
  await tab(page, '設定').click();
  await expect(page.locator('#speech-note')).toContainText('使える英語の音声がありません');
  await page.evaluate(() => /** @type {any} */ (window).__deliver());
  await expect(page.getByLabel('音声', { exact: true }).locator('option')).toHaveCount(3);
});

test('自動読み上げ: カードで前へ戻ると、戻った問題をまた読む', async ({ page }) => {
  await fakeSpeech(page, EDGE_LIKE);
  await page.goto('/');
  await seedBook(page, BOOK());
  await seedSettings(page, { speechAuto: true });
  await startOldest(page, 'card');
  await page.getByRole('button', { name: '次へ →' }).click();
  await expect(page.locator('.stem')).toHaveText('allocate');
  await page.getByRole('button', { name: '← 前へ' }).click();
  await expect(page.locator('.stem')).toHaveText('be aware of A');
  expect((await spoken(page)).map((s) => s.text)).toEqual(['be aware of', 'allocate', 'be aware of']);
});

test('自動読み上げ: 切のときに出した問題は、途中で入れても読まない。次の問題から読む', async ({ page }) => {
  await fakeSpeech(page, EDGE_LIKE);
  await page.goto('/');
  await seedBook(page, BOOK());
  await startOldest(page, 'choice');
  await tab(page, '設定').click();
  await page.getByLabel('問題を出したときに見出し語を自動で読み上げる').check();
  await tab(page, '学習').click();
  await expect(page.locator('.stem')).toHaveText('be aware of A');
  expect(await spoken(page)).toEqual([]);
  await page.getByRole('button', { name: 'わかる' }).click();
  await page.getByRole('button', { name: '～に気づいている' }).click();
  await page.getByRole('button', { name: '次の問題 →' }).click();
  await expect(page.locator('.stem')).toHaveText('allocate');
  expect((await spoken(page)).map((s) => s.text)).toEqual(['allocate']);
});
