// 追加タブの「AI に頼む」: 覚えたい語の一覧から依頼文(core/aiPrompt.js)を作り、写させる。
// AI へは何も送らない(INV-1)。利用者が AI に貼り、返ってきた答えを「まとめて取り込む」に貼る(確認表を経る。INV-2)。

import { esc, actionOf, foldOpen, bindFolds } from './dom.js';
import { aiPrompt, requestWords } from '../core/aiPrompt.js';

/** @typedef {import('./dom.js').Ctx} Ctx */

/** 入力と作った依頼文(タブを移っても残す) */
const state = { words: '', examples: true, prompt: '', message: '' };

/** @returns {string} */
export function aiHtml() {
  return `${foldOpen('ai-panel')}
    <summary><h2>AI に頼む</h2></summary>
    <p class="hint">覚えたい語を 1 行に 1 つ書いて依頼文を作り、ChatGPT・Claude・Gemini などに貼ってください。
      返ってきた答えを下の「まとめて取り込む」にそのまま貼り(例文の出どころは「AI」)、確認表を経て単語帳に入れます。このアプリから AI へは何も送りません。</p>
    <div class="wordform">
      <div class="f"><label for="ai-words">頼む語(1 行に 1 つ)</label>
        <textarea id="ai-words" rows="4" spellcheck="false" lang="en">${esc(state.words)}</textarea></div>
      <div class="check"><input type="checkbox" id="ai-ex"${state.examples ? ' checked' : ''}><label for="ai-ex">例文と和訳も作ってもらう</label></div>
      <div class="rowbtns"><button type="button" class="primary" data-action="ai-make">依頼文を作る</button></div>
      ${state.prompt ? `<div class="f"><label for="ai-prompt">AI への依頼文</label>
        <textarea id="ai-prompt" rows="8" readonly>${esc(state.prompt)}</textarea></div>
        <div class="rowbtns"><button type="button" data-action="ai-copy">依頼文をコピー</button></div>` : ''}
    </div>
    <p class="msg" role="status" id="ai-msg">${esc(state.message)}</p>
  </details>`;
}

/** @param {Ctx} ctx */
export function bindAi(ctx) {
  const words = /** @type {HTMLTextAreaElement} */ (ctx.root.querySelector('#ai-words'));
  const ex = /** @type {HTMLInputElement} */ (ctx.root.querySelector('#ai-ex'));
  words.oninput = () => { state.words = words.value; };
  ex.onchange = () => { state.examples = ex.checked; };
}

/**
 * 「AI に頼む」のボタン。扱ったら true。
 * @param {Ctx} ctx
 * @param {Event} e
 * @returns {Promise<boolean>}
 */
export async function handleAiClick(ctx, e) {
  const act = actionOf(e)?.dataset.action;
  if (act === 'ai-make') {
    const { words, ignored } = requestWords(state.words);
    state.prompt = aiPrompt(words, { examples: state.examples });
    state.message = words.length
      ? `${words.length} 語の依頼文を作りました` + (ignored.length ? `(英語でない行を除きました: ${ignored.join('、')})` : '')
      : '頼む語を 1 行に 1 つ書いてください';
    // この欄だけを描き直す(タブ全体を描き直すと、1 語の追加欄に入力中の値が消える)
    const panel = ctx.root.querySelector('#ai-panel');
    if (panel) {
      panel.outerHTML = aiHtml();
      bindFolds(ctx.root);
      bindAi(ctx);
    } else {
      ctx.rerender();
    }
    return true;
  }
  if (act === 'ai-copy') {
    const box = /** @type {HTMLTextAreaElement | null} */ (ctx.root.querySelector('#ai-prompt'));
    try {
      await navigator.clipboard.writeText(state.prompt);
      state.message = 'コピーしました。AI に貼ってください';
    } catch {
      // クリップボードを使えない環境では、選んだ状態にして利用者にコピーしてもらう
      box?.focus();
      box?.select();
      state.message = '依頼文を選びました。コピーして AI に貼ってください';
    }
    const msg = ctx.root.querySelector('#ai-msg');
    if (msg) msg.textContent = state.message;
    return true;
  }
  return false;
}
