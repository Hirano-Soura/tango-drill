// 1 語の入力欄(追加と編集で共用)と、語の見出しの表示。

import { esc, field, splitTags } from './dom.js';
import { isPhrase, TRANS_VALUES, TRANS_LABEL } from '../core/word.js';

/** @typedef {import('../core/word.js').Word} Word */
/** @typedef {import('../core/book.js').WordInput} WordInput */

/** 品詞の入力候補(自由に書いてもよい。取り込みと同じ規則で正規化する) */
const POS_HINTS = ['名', '動', '形', '副', '前', '接', '代', '動/名', '動詞句', '前置詞句', '名詞句'];

/** 自他の選択肢の表示(値は trans の値のまま) */
const TRANS_OPTION = /** @type {Record<string, string>} */ ({ vt: '他動詞(vt)', vi: '自動詞(vi)', 'vt/vi': '両用(vt/vi)' });

/**
 * 入力欄の HTML。name 属性は WordInput の項目名と同じ。ラベルは for で結ぶ
 * (textarea をラベルで囲むと、入力中の文までラベルの名前に含まれてしまう)。
 * @param {Partial<Word>} [w] 編集なら今の値
 * @param {string} [prefix] id の頭(1 つの画面に入力欄を 2 組置くときに分ける)
 * @returns {string}
 */
export function wordFields(w = {}, prefix = 'w') {
  const v = (/** @type {keyof Word} */ k) => esc(w[k] ?? '');
  const id = (/** @type {string} */ name) => `${prefix}-${name}`;
  const lab = (/** @type {string} */ name, /** @type {string} */ text) => `<label for="${id(name)}">${text}</label>`;
  return `
    <div class="f">${lab('en', '見出し語(英語)')}<input id="${id('en')}" name="en" required autocomplete="off" autocapitalize="off" spellcheck="false" value="${v('en')}"></div>
    <div class="two">
      <div class="f">${lab('pos', '品詞')}<input id="${id('pos')}" name="pos" list="pos-hints" autocomplete="off" value="${v('pos')}" placeholder="名 / 動 / 形 …"></div>
      <div class="f">${lab('trans', '自他')}<select id="${id('trans')}" name="trans">
        ${['', ...TRANS_VALUES].map((t) => `<option value="${t}"${(w.trans ?? '') === t ? ' selected' : ''}>${t ? TRANS_OPTION[t] : '—'}</option>`).join('')}
      </select></div>
    </div>
    <p class="hint">動詞は「自他」を選びます。品詞に「動(他)」「動(自)」「動(自他)」と書いても同じです。</p>
    <datalist id="pos-hints">${POS_HINTS.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    <div class="f">${lab('ja', '意味')}<input id="${id('ja')}" name="ja" autocomplete="off" value="${v('ja')}"></div>
    <div class="f">${lab('ex', '例文')}<textarea id="${id('ex')}" name="ex" rows="2" lang="en">${v('ex')}</textarea></div>
    <div class="f">${lab('exJa', '例文の和訳')}<textarea id="${id('exJa')}" name="exJa" rows="2">${v('exJa')}</textarea></div>
    <p class="hint">例文を消すと、和訳と例文の出どころも消えます。</p>
    <div class="f">${lab('note', '補足')}<input id="${id('note')}" name="note" autocomplete="off" value="${v('note')}"></div>
    <div class="f">${lab('tags', 'タグ(読点・カンマ区切り)')}<input id="${id('tags')}" name="tags" autocomplete="off" value="${esc((w.tags ?? []).join('、'))}"></div>`;
}

/**
 * 入力欄から 1 語を読む。正規化(品詞の別名など)は core 側で行う。
 * @param {HTMLFormElement} form
 * @returns {WordInput}
 */
export function readWordFields(form) {
  return {
    en: field(form, 'en'),
    pos: field(form, 'pos'),
    trans: field(form, 'trans'),
    ja: field(form, 'ja'),
    ex: field(form, 'ex'),
    exJa: field(form, 'exJa'),
    note: field(form, 'note'),
    tags: splitTags(field(form, 'tags')),
  };
}

/**
 * 語の種別・品詞・自他の短い表示。
 * @param {Word} w
 * @returns {string}
 */
export function posLine(w) {
  const ph = isPhrase(w);
  return `<span class="kind${ph ? ' ph' : ''}">${ph ? '句表現' : '単語'}</span> ${esc(w.pos || '品詞なし')}${transBadge(w)}`;
}

/**
 * 動詞の自他の印(既存アプリと同じ 他 / 自 / 他自。色で分け、説明を title に持たせる)。自他が無ければ空。
 * @param {Pick<Word, 'trans'>} w
 * @returns {string}
 */
export function transBadge(w) {
  const t = w.trans ? TRANS_LABEL[w.trans] : undefined;
  if (!t) return '';
  const cls = w.trans === 'vt/vi' ? 'both' : w.trans;
  return ` <span class="tr ${cls}" title="${esc(t.title)}">${t.mark}</span>`;
}

/**
 * 意味の表示。半角かっこの品詞・自他のラベル((名)(動)(他)(自)など。依頼文 v2 が付けさせる)を小さな印にする。
 * 利用者の入力なので、先に esc を通す(ラベルの文字は esc で変わらない)。
 * @param {string | undefined} ja
 * @returns {string}
 */
export function jaHtml(ja) {
  return esc(ja ?? '').replace(/\((名|動|形|副|前|接|自|他)\)/g, '<span class="jl">$1</span>');
}
