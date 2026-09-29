// AI(ChatGPT・Claude・Gemini など)に単語カードを作ってもらう依頼文。ブラウザの API に触れない(INV-6)。
// 返答は利用者が追加タブの「まとめて取り込む」に貼り、確認表を経て入れる(INV-2)。送信はしない(INV-1)。
// 依頼文は簡易形式 simple/v1(Docs/20_ImportFormat.md §3)で答えさせる。規則は Docs/20_ImportFormat.md §6。

import { looksEnglish } from './importFormat.js';

/**
 * 依頼文の版。依頼文を変えたら上げる。版ごとの全文は tests/core/fixtures/ai/prompt_<版>*.txt に固定してあり、
 * 版を上げずに文面を変えるとテスト(tests/core/aiPrompt.test.js)が落ちる。
 * 返答の見本(tests/core/fixtures/ai/replies.json)はどの版への返答かを持ち、今の版でない見本はテストが落とす
 * (上げたら、見本を新しい版で採り直す)。
 */
export const AI_PROMPT_VERSION = 'v1';

/**
 * @typedef {object} AiPromptOptions
 * @property {boolean} [examples] 例文と和訳も作ってもらう(既定: true)
 */

/**
 * 依頼する語の一覧を、貼られた文から取り出す。1 行 1 語。空行・重複と、英語として読めない行
 * (見出し語と同じ判定 looksEnglish: 英字を含み、かな・漢字・全角文字を含まない)は除く。
 * @param {string} text
 * @returns {{ words: string[], ignored: string[] }}
 */
export function requestWords(text) {
  /** @type {string[]} */
  const words = [];
  /** @type {string[]} */
  const ignored = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const w = line.replace(/\s+/g, ' ').trim();
    if (!w) continue;
    if (!looksEnglish(w)) ignored.push(w);
    else if (!words.includes(w)) words.push(w);
  }
  return { words, ignored };
}

/**
 * 依頼文を作る。語が無ければ空文字。
 * @param {readonly string[]} words
 * @param {AiPromptOptions} [opts]
 * @returns {string}
 */
export function aiPrompt(words, opts = {}) {
  if (!words.length) return '';
  const examples = opts.examples ?? true;
  const cols = examples ? '見出し語 | 品詞 | 意味 | 例文 | 例文の和訳 | 補足' : '見出し語 | 品詞 | 意味 | | | 補足';
  const lines = [
    '次の英単語・英語表現について、TOEIC の学習用に単語カードを作ってください。',
    '',
    '【答え方】',
    '- 全体を 1 つのコードブロック(```)に入れてください。コードブロックの外には何も書かないでください。',
    `- 1 行に 1 語。各行は「${cols}」の順に、半角の縦棒「|」で区切ってください。`,
    '- 見出し行・表の区切り線・番号は付けないでください。項目の中には「|」を使わないでください。',
    '- 見出し語: 一覧のとおりの綴りで書いてください。',
    '- 品詞: 名・動・形・副・前・接 のどれか。複数なら「名/動」のように書きます。2 語以上の表現は「動詞句」「前置詞句」などと書きます。',
    '- 意味: 日本語で短く。意味が複数あれば「、」で区切ります。',
  ];
  if (examples) {
    lines.push(
      '- 例文: TOEIC に出そうな短い英文を 1 つ。',
      '- 例文の和訳: 例文の日本語訳。',
    );
  } else {
    lines.push('- 例文と例文の和訳は空欄にしてください(区切りの「|」は残します)。');
  }
  lines.push(
    '- 補足: よく使う形・類義語など。無ければ空欄にしてください。',
    '',
    '【語の一覧】',
    ...words,
  );
  return lines.join('\n');
}
