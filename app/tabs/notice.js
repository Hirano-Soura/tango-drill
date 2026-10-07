// 通知タブ: アプリの変更のお知らせ(core/notices.js)。規則は Docs/25_Notices.md。
// 開いたときに、まだ読んでいないお知らせを既読にする(app/main.js の go)。そのとき読んでいなかったものには「新着」を付ける。
// 自他のお知らせには、自他の無い動詞に自他を補う依頼文を作る操作を添える(追加タブの「AI に頼む」へ案内する)。

import { esc, actionOf, unfold } from '../dom.js';
import { NOTICES } from '../../core/notices.js';
import { needsTrans } from '../../core/word.js';
import { prepareTrans } from '../aiView.js';

/** @typedef {import('../dom.js').Ctx} Ctx */
/** @typedef {import('../../core/notices.js').Notice} Notice */

/** このタブを開いたときにまだ読んでいなかったお知らせ(「新着」の印。次に開くまで残す) */
let fresh = /** @type {Set<string>} */ (new Set());

/**
 * タブを開くときに、まだ読んでいなかったお知らせを渡す(app/main.js が既読にする前に呼ぶ)。
 * @param {readonly string[]} ids
 */
export function setFresh(ids) {
  fresh = new Set(ids);
}

/** @param {Ctx} ctx */
export function render(ctx) {
  ctx.root.innerHTML = NOTICES.map((n) => noticeHtml(ctx, n)).join('');
  ctx.root.onclick = (e) => {
    if (actionOf(e)?.dataset.action !== 'notice-trans') return;
    // 追加タブの「AI に頼む」に、自他の無い動詞の依頼文を作って見せる(AI へは何も送らない。INV-1)
    prepareTrans(ctx.book);
    unfold('ai-panel');
    ctx.go('add');
    ctx.root.querySelector('#ai-prompt')?.scrollIntoView({ block: 'center' });
  };
}

/**
 * @param {Ctx} ctx
 * @param {Readonly<Notice>} n
 * @returns {string}
 */
function noticeHtml(ctx, n) {
  const marks = [n.important ? '<span class="act a-merge">重要</span>' : '', fresh.has(n.id) ? '<span class="act a-add">新着</span>' : ''].filter(Boolean).join(' ');
  // 本文はアプリの中の固定の文なので、esc を通さず HTML として入れる(Q&A と同じ)
  return `<section class="panel notice" id="notice-${esc(n.id)}">
    <h2>${n.title}</h2>
    <p class="meta">${marks ? marks + ' ' : ''}${esc(n.date)} ・ バージョン ${esc(n.version)}</p>
    ${n.body.map((p) => `<p>${p}</p>`).join('')}
    ${n.action === 'trans' ? transAction(ctx) : ''}
  </section>`;
}

/**
 * 自他の無い動詞に自他を補う操作。対象が無ければ、無いことだけを出す。
 * @param {Ctx} ctx
 * @returns {string}
 */
function transAction(ctx) {
  const n = ctx.book.words.filter(needsTrans).length;
  if (!n) return '<p class="hint" id="trans-count">今の単語帳には、自他の無い動詞はありません。</p>';
  return `<p class="hint" id="trans-count">今の単語帳に、自他の無い動詞が ${n} 語あります。</p>
    <div class="rowbtns left"><button type="button" class="primary" data-action="notice-trans">自他を補う依頼文を作る</button></div>`;
}
