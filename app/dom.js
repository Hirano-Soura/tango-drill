// 画面の共通部品: 文字のエスケープ・日付・ファイルの書き出し・各タブが受け取る文脈の型。

/** @typedef {import('../core/book.js').Book} Book */
/** @typedef {import('./storage.js').Settings} Settings */

/**
 * @typedef {'study' | 'list' | 'add' | 'stats' | 'settings'} TabId
 */

/**
 * 各タブの render が受け取る文脈。単語帳を変えるときは必ず commit を通す(保存と「元に戻す」をここで揃える)。
 * @typedef {object} Ctx
 * @property {HTMLElement} root タブの中身を描く場所
 * @property {Book} book 今の単語帳
 * @property {Settings} settings
 * @property {string} today 今日(YYYY-MM-DD)
 * @property {(next: Book, undoLabel?: string) => Promise<void>} commit 保存して描き直す。undoLabel を渡すと「元に戻す」を出す
 * @property {(next: Settings) => Promise<void>} setSettings
 * @property {(tab: TabId) => void} go
 * @property {() => void} rerender
 */

/**
 * HTML に埋め込む文字列のエスケープ。利用者の入力は必ずこれを通してから innerHTML に入れる。
 * @param {unknown} s
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * 端末の時刻での日付(YYYY-MM-DD)。回と追加日はこの日付で数える。
 * @param {Date} [d]
 * @returns {string}
 */
export function today(d = new Date()) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 文字列をファイルとして端末に保存させる(送信はしない。INV-1)。
 * @param {string} name
 * @param {string} text
 * @param {string} type
 */
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * フォームの入力欄の値(無ければ空文字)。
 * @param {HTMLFormElement} form
 * @param {string} name
 * @returns {string}
 */
export function field(form, name) {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : '';
}

/**
 * タグの入力欄(読点・カンマ区切り)を配列にする。
 * @param {string} s
 * @returns {string[]}
 */
export function splitTags(s) {
  return s.split(/[,、，]/).map((t) => t.trim()).filter(Boolean);
}

/**
 * クリックされた要素から data-action を持つ最も近い要素を探す。
 * @param {Event} e
 * @returns {HTMLElement | null}
 */
export function actionOf(e) {
  const t = e.target;
  return t instanceof Element ? /** @type {HTMLElement | null} */ (t.closest('[data-action]')) : null;
}
