// AI(ChatGPT・Claude・Gemini など)に単語カードを作ってもらう依頼文。ブラウザの API に触れない(INV-6)。
// 返答は利用者が追加タブの「まとめて取り込む」に貼り、確認表を経て入れる(INV-2)。送信はしない(INV-1)。
// 依頼文は簡易形式 simple/v1(Docs/20_ImportFormat.md §3)で答えさせる。規則は Docs/20_ImportFormat.md §6。

import { looksEnglish } from './importFormat.js';

/** @typedef {import('./word.js').Word} Word */

/**
 * 依頼文の版。依頼文を変えたら上げる。版ごとの全文は tests/core/fixtures/ai/prompt_<版>*.txt に固定してあり、
 * 版を上げずに文面を変えるとテスト(tests/core/aiPrompt.test.js)が落ちる。
 * 返答の見本(tests/core/fixtures/ai/replies.json)はどの版への返答かを持つ。上げたら見本を新しい版で採り直す
 * (今の版への本物の見本の無い提供元はテストが todo にする。古い版の見本は、貼られうる入力として残す)。
 */
export const AI_PROMPT_VERSION = 'v2';

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
    `- ${TRANS_RULE}複数の品詞を持つ語は「名/動(他)」のように最後に添えます。「動詞句」などの 2 語以上の表現には添えません。`,
    '- 意味: 日本語で短く。意味が複数あれば「、」で区切ります。',
    '  品詞が複数ある語と、自他で意味が変わる動詞は、「(名)見積もり ／ (動)見積もる」「(他)取り戻す ／ (自)回復する」のように「 ／ 」で分け、それぞれの頭に品詞か自他を半角かっこで付けます。',
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
    '- 補足: よく使う形・類義語など。自動詞は、続ける前置詞(dispose of など)も書きます。無ければ空欄にしてください。',
    '',
    '【語の一覧】',
    ...words,
  );
  return lines.join('\n');
}

/** 品詞に自他を添える書き方(依頼文 v2 と自他を補う依頼文で同じ文を使う。読み手は importFormat.js の splitTransMark) */
const TRANS_RULE = '動詞は、品詞の後ろに自他を半角かっこで添えてください。他動詞(目的語を直接とる)は「動(他)」、自動詞(目的語を直接とらない)は「動(自)」、どちらにも使うなら「動(自他)」です。';

/**
 * 単語帳にある動詞のうち、自他の無い語に自他を補ってもらう依頼文(既存の語への遡及。Docs/20_ImportFormat.md §6)。
 * 見出し語と品詞をそのまま書き写させ、品詞の後ろに自他だけを添えさせる。返答は「見出し語 | 品詞(自他)」の
 * 2 列の簡易形式になり、確認表では既存の語に当たって自他の空欄だけを埋める(merge。INV-2)。語が無ければ空文字。
 * 版は依頼文と同じ AI_PROMPT_VERSION で固定する(tests/core/fixtures/ai/trans_<版>.txt)。
 * @param {readonly Pick<Word, 'en' | 'pos'>[]} words
 * @returns {string}
 */
export function transPrompt(words) {
  if (!words.length) return '';
  return [
    '次の英語の動詞について、他動詞か自動詞かを教えてください。TOEIC の学習用の単語カードに書き足します。',
    '',
    '【答え方】',
    '- 全体を 1 つのコードブロック(```)に入れてください。コードブロックの外には何も書かないでください。',
    '- 1 行に 1 語。各行は「見出し語 | 品詞」の順に、半角の縦棒「|」で区切ってください。',
    '- 見出し行・表の区切り線・番号は付けないでください。',
    '- 見出し語と品詞は、一覧のとおりに書き写してください(品詞を変えないでください)。',
    `- ${TRANS_RULE}「名/動」のように品詞が複数なら「名/動(他)」のように最後に添えます。`,
    '',
    '【語の一覧】',
    ...words.map((w) => `${w.en} | ${w.pos ?? ''}`),
  ].join('\n');
}
