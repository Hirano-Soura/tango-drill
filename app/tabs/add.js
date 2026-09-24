// 追加タブ: 1 語ずつ手で足す。まとめて貼り付ける取り込み(確認表)は T-5.1 でここに足す。

import { esc } from '../dom.js';
import { wordFields, readWordFields } from '../wordForm.js';
import { addOneWord } from '../../core/book.js';

/** @typedef {import('../dom.js').Ctx} Ctx */

/** 直前の結果(描き直しても残す) */
let message = '';
let isError = false;

/** @param {Ctx} ctx */
export function render(ctx) {
  ctx.root.innerHTML = `
    <section class="panel">
      <h2>単語を追加</h2>
      <form id="add-form" class="wordform">
        ${wordFields()}
        <div class="rowbtns"><button type="submit" class="primary">追加する</button></div>
      </form>
      <p class="msg${isError ? ' err' : ''}" role="status">${esc(message)}</p>
    </section>`;
  const form = /** @type {HTMLFormElement} */ (ctx.root.querySelector('#add-form'));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const r = addOneWord(ctx.book, readWordFields(form), ctx.today);
    if (!r.ok) {
      message = r.error;
      isError = true;
      ctx.rerender();
      return;
    }
    message = `「${r.key.split('|')[0]}」を追加しました(単語帳の語数: ${r.book.words.length})` +
      (r.warnings.length ? '。' + r.warnings.join(' / ') : '');
    isError = false;
    await ctx.commit(r.book, `「${r.key.split('|')[0]}」を追加しました`);
  };
}
