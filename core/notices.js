// 通知タブに載せるお知らせ。ブラウザの API に触れない(INV-6)。規則は Docs/25_Notices.md。
// 新しいお知らせは先頭に足す。id は既読の記録(端末ごとの設定 noticesSeen)の鍵なので、載せたあとは変えない。

/**
 * @typedef {object} Notice
 * @property {string} id 既読の記録の鍵。載せたあとは変えない
 * @property {string} date 載せた日(YYYY-MM-DD)
 * @property {string} version 載せた版(core/version.js の VERSION と同じ形)
 * @property {string} title
 * @property {boolean} important 重要なお知らせ。読むまで通知タブのボタンに赤い点を出す
 * @property {string[]} body 段落。アプリの中の固定の文なので、画面は esc を通さず HTML として入れる
 * @property {'trans'} [action] 本文の下に出す操作。trans は「自他の無い動詞に自他を補う」(Docs/20_ImportFormat.md §6)
 */

/** @type {readonly Readonly<Notice>[]} */
export const NOTICES = Object.freeze([
  {
    id: '2026-10-07-trans',
    date: '2026-10-07',
    version: '0.22.0',
    title: '動詞に「他」「自」の印が付くようになりました(他動詞・自動詞の区別)',
    important: true,
    body: [
      '動詞に、他動詞か自動詞かを示す印を付けられるようになりました。単語帳・学習の画面・取り込みの確認表で、品詞の横に'
        + '「他」(他動詞: 目的語を直接とる)、「自」(自動詞: 目的語を直接とらない。前置詞が要る)、「他自」(どちらにも使う)と出ます。'
        + 'TOEIC の Part 5 では、自他の区別がよく問われます。',
      '「追加」→「AI に頼む」の依頼文も変わりました。AI は品詞を「動(他)」のように自他を添えて答え、'
        + '自他で意味が変わる動詞は意味を「(他)取り戻す ／ (自)回復する」のように分けて答えます。',
      '<b>前から登録してある語には、自他が付いていません。</b>下のボタンで、自他の無い動詞だけを並べた依頼文を作れます。'
        + 'AI に貼り、返ってきた答えを「まとめて取り込む」に貼ると、確認表を経て自他だけを書き足します(意味や例文は変わりません)。'
        + '1 語ずつ直すときは、「単語帳」の「編集」で「自他」を選びます。',
    ],
    action: 'trans',
  },
  {
    id: '2026-10-07-speech',
    date: '2026-10-07',
    version: '0.21.0',
    title: '発音と例文を読み上げられるようになりました',
    important: false,
    body: [
      '学習の画面で、見出し語の横の「発音」を押すと読み上げます。答えたあと(カードは裏を見せたあと)は「例文を聞く」で例文も読めます。',
      '問題を出すたびに自動で読ませたいときや、声と速さを選ぶときは「設定」→「読み上げ」を使います。'
        + '端末の中にある音声だけで読み、単語や例文を外部へ送りません。',
    ],
  },
]);

/**
 * まだ読んでいない重要なお知らせ。1 つでもあれば、通知タブのボタンに赤い点を出す。
 * @param {readonly Readonly<Notice>[]} notices
 * @param {readonly string[]} seen 既読の id
 * @returns {Readonly<Notice>[]}
 */
export function unreadImportant(notices, seen) {
  const s = new Set(seen);
  return notices.filter((n) => n.important && !s.has(n.id));
}

/**
 * まだ読んでいないお知らせの id(重要でないものも含む)。通知タブを開いたときに既読にし、「新着」の印を付ける。
 * @param {readonly Readonly<Notice>[]} notices
 * @param {readonly string[]} seen
 * @returns {string[]}
 */
export function unreadIds(notices, seen) {
  const s = new Set(seen);
  return notices.filter((n) => !s.has(n.id)).map((n) => n.id);
}
