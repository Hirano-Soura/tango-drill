// 単語帳タブ: 一覧・絞り込み・印・編集・削除。削除と編集は直後に「元に戻す」で取り消せる。

import { esc, actionOf } from '../dom.js';
import { wordFields, readWordFields, posLine } from '../wordForm.js';
import { keyOf, isPhrase } from '../../core/word.js';
import { editWord, deleteWord, toggleStar } from '../../core/book.js';

/** @typedef {import('../dom.js').Ctx} Ctx */

/** 編集中の語の鍵(null なら編集していない) */
let editing = /** @type {string | null} */ (null);
let editError = '';
let query = '';

/** @param {Ctx} ctx */
export function render(ctx) {
  const { book } = ctx;
  if (editing !== null && !book.words.some((w) => keyOf(w) === editing)) editing = null;
  const q = query.trim().toLowerCase();
  const shown = book.words.filter((w) => !q || w.en.toLowerCase().includes(q) || (w.ja ?? '').includes(query.trim()));
  const nPhrase = book.words.filter(isPhrase).length;
  const star = new Set(book.starred);

  let h = '';
  if (editing !== null) {
    const w = /** @type {import('../../core/word.js').Word} */ (book.words.find((x) => keyOf(x) === editing));
    h += `<section class="panel" id="edit-panel"><h2>編集: ${esc(w.en)}</h2>
      <form id="edit-form" class="wordform">${wordFields(w, 'edit')}
        <div class="rowbtns"><button type="submit" class="primary">保存する</button><button type="button" data-action="cancel">やめる</button></div>
      </form><p class="msg err" role="status">${esc(editError)}</p></section>`;
  }
  if (!book.words.length) {
    h += `<p class="empty">単語帳はまだ空です。<button data-action="go-add">追加する</button></p>`;
    ctx.root.innerHTML = h;
    bind(ctx);
    return;
  }
  h += `<div class="toolrow"><input type="search" id="q" aria-label="絞り込み" placeholder="見出し語・意味で絞り込む" value="${esc(query)}">
    <span class="meta">単語 ${book.words.length - nPhrase} ／ 句表現 ${nPhrase}(計 ${book.words.length})</span></div>`;
  h += '<ul class="words">';
  for (const w of shown) {
    const k = keyOf(w);
    const sub = [w.exJa, w.note].filter(Boolean).map(esc).join(' ／ ');
    const meta = [`追加 ${esc(book.added[k] ?? '')}`, ...(w.tags ?? []).map(esc)].join(' ・ ');
    h += `<li class="word" data-key="${esc(k)}">
      <button class="star${star.has(k) ? ' on' : ''}" data-action="star" aria-pressed="${star.has(k)}" aria-label="印">★</button>
      <div class="body">
        <div><span class="en${isPhrase(w) ? ' ph' : ''}" lang="en">${esc(w.en)}</span> <span class="meta">${posLine(w)}</span></div>
        <div class="ja">${esc(w.ja ?? '')}</div>
        ${w.ex ? `<div class="ex" lang="en">${esc(w.ex)}</div>` : ''}${sub ? `<div class="ex">${sub}</div>` : ''}
        <div class="meta">${meta}</div>
      </div>
      <div class="ops"><button data-action="edit">編集</button><button data-action="delete">削除</button></div>
    </li>`;
  }
  h += '</ul>';
  if (!shown.length) h += '<p class="empty">絞り込みに当たる語がありません。</p>';
  ctx.root.innerHTML = h;
  bind(ctx);
}

/** @param {Ctx} ctx */
function bind(ctx) {
  const search = /** @type {HTMLInputElement | null} */ (ctx.root.querySelector('#q'));
  if (search) {
    search.oninput = () => {
      query = search.value;
      const pos = search.selectionStart;
      ctx.rerender();
      const again = /** @type {HTMLInputElement | null} */ (ctx.root.querySelector('#q'));
      again?.focus();
      if (again && pos !== null) again.setSelectionRange(pos, pos);
    };
  }
  const form = /** @type {HTMLFormElement | null} */ (ctx.root.querySelector('#edit-form'));
  if (form && editing !== null) {
    const key = editing;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const r = editWord(ctx.book, key, readWordFields(form));
      if (!r.ok) {
        editError = r.error;
        ctx.rerender();
        return;
      }
      editing = null;
      editError = '';
      const en = r.book.words.find((w) => keyOf(w) === r.key)?.en;
      await ctx.commit(r.book, `「${en}」を保存しました` + (r.warnings.length ? '(' + r.warnings.join(' / ') + ')' : ''));
    };
    form.querySelector('input[name="en"]')?.scrollIntoView({ block: 'center' });
  }
  ctx.root.onclick = async (e) => {
    const el = actionOf(e);
    if (!el) return;
    const act = el.dataset.action;
    const key = /** @type {HTMLElement | null} */ (el.closest('[data-key]'))?.dataset.key;
    if (act === 'go-add') ctx.go('add');
    else if (act === 'cancel') {
      editing = null;
      editError = '';
      ctx.rerender();
    } else if (act === 'edit' && key) {
      editing = key;
      editError = '';
      ctx.rerender();
    } else if (act === 'star' && key) {
      await ctx.commit(toggleStar(ctx.book, key));
    } else if (act === 'delete' && key) {
      const en = ctx.book.words.find((w) => keyOf(w) === key)?.en ?? key;
      if (editing === key) editing = null;
      await ctx.commit(deleteWord(ctx.book, key), `「${en}」を削除しました`);
    }
  };
}
