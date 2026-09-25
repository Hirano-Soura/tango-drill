// 画面の入口: 保存層を開き、5 つのタブを切り替える。単語帳を変える操作は commit を通す
// (バックアップからの復元とその取り消しだけは restore / undoRestore を通す)。
// 「元に戻す」は直前の追加・編集・削除・取り込みの確定だけを 1 段取り消す(次に単語帳を変えると消える)。

import { openStorage } from './storage.js';
import { today, esc, actionOf } from './dom.js';
import * as study from './tabs/study.js';
import * as list from './tabs/list.js';
import * as add from './tabs/add.js';
import * as stats from './tabs/stats.js';
import * as settings from './tabs/settings.js';

/** @typedef {import('./dom.js').Ctx} Ctx */
/** @typedef {import('./dom.js').TabId} TabId */
/** @typedef {import('../core/book.js').Book} Book */
/** @typedef {import('./storage.js').Settings} Settings */

/** @type {[TabId, string, { render: (ctx: Ctx) => void }][]} */
const TABS = [
  ['study', '学習', study],
  ['list', '単語帳', list],
  ['add', '追加', add],
  ['stats', '記録', stats],
  ['settings', '設定', settings],
];

const content = /** @type {HTMLElement} */ (document.getElementById('content'));
const nav = /** @type {HTMLElement} */ (document.getElementById('tabs'));
const toast = /** @type {HTMLElement} */ (document.getElementById('toast'));

async function main() {
  const storage = await openStorage(indexedDB);
  const loaded = await storage.load(today());
  const app = {
    book: loaded.book,
    settings: await storage.loadSettings(),
    /** @type {TabId} */ tab: loaded.book.words.length ? 'study' : 'add',
    /** @type {{ label: string, book: Book } | null} */ undo: null,
    /** @type {string} */ note: loaded.warnings.length ? '保存してある単語帳を読むときの注意: ' + loaded.warnings.join(' / ') : '',
    restoreUndo: await storage.canUndo(),
  };

  /** @type {Ctx} */
  const ctx = {
    root: content,
    get book() { return app.book; },
    get settings() { return app.settings; },
    get today() { return today(); },
    async commit(next, undoLabel) {
      const prev = app.book;
      await storage.save(next);
      app.book = next;
      app.undo = undoLabel ? { label: undoLabel, book: prev } : null;
      app.note = '';
      render();
    },
    async setSettings(next) {
      await storage.saveSettings(next);
      app.settings = next;
      render();
    },
    // 復元の「元に戻す」は 1 段の「元に戻す」とは別に、保存層に退避して次の復元まで残す(Docs/22_Storage.md §3)
    async restore(next) {
      await storage.restore(next);
      app.book = next;
      app.undo = null;
      app.restoreUndo = true;
      app.note = '';
      render();
    },
    get canUndoRestore() { return app.restoreUndo; },
    async undoRestore() {
      await storage.undoRestore();
      // 退避はもう消えている。このあと読み直しに失敗しても、戻すボタンを出し続けない
      app.restoreUndo = false;
      app.undo = null;
      let back;
      try {
        back = await storage.load(today());
      } catch (e) {
        // 画面の単語帳と保存した中身がずれたまま続けない(次の保存で上書きして失うため)
        nav.onclick = null;
        toast.hidden = true;
        showFatal(e);
        return;
      }
      app.book = back.book;
      app.note = back.warnings.length ? '保存してある単語帳を読むときの注意: ' + back.warnings.join(' / ') : '';
      render();
    },
    go(tab) {
      app.tab = tab;
      app.undo = null;
      render();
    },
    rerender: () => render(),
  };

  function render() {
    nav.innerHTML = TABS.map(([id, label]) =>
      `<button role="tab" data-tab="${id}" aria-selected="${app.tab === id}" class="${app.tab === id ? 'active' : ''}">${label}</button>`).join('');
    const tab = TABS.find(([id]) => id === app.tab) ?? TABS[0];
    content.onclick = null;
    content.onchange = null;
    tab[2].render(ctx);
    renderToast();
  }

  function renderToast() {
    if (app.undo) {
      toast.innerHTML = `<span>${esc(app.undo.label)}</span><button data-action="undo">元に戻す</button>`;
    } else if (app.note) {
      toast.innerHTML = `<span>${esc(app.note)}</span><button data-action="dismiss">閉じる</button>`;
    } else {
      toast.innerHTML = '';
    }
    toast.hidden = !toast.innerHTML;
  }

  nav.onclick = (e) => {
    const t = e.target instanceof Element ? /** @type {HTMLElement | null} */ (e.target.closest('[data-tab]')) : null;
    if (t?.dataset.tab) ctx.go(/** @type {TabId} */ (t.dataset.tab));
  };
  toast.onclick = async (e) => {
    const act = actionOf(e)?.dataset.action;
    if (act === 'undo' && app.undo) {
      const back = app.undo.book;
      await storage.save(back);
      app.book = back;
      app.undo = null;
      app.note = '元に戻しました';
      render();
    } else if (act === 'dismiss') {
      app.note = '';
      renderToast();
    }
  };
  render();
}

/**
 * 保存してある単語帳が読めないときの画面。空の単語帳として続けない(上書きして失うため)。
 * @param {unknown} e
 */
function showFatal(e) {
  content.onclick = null;
  content.onchange = null;
  content.innerHTML = `<div class="panel"><h2>単語帳を開けませんでした</h2><p class="msg err">${esc(e instanceof Error ? e.message : String(e))}</p>
    <p class="hint">アプリを更新してから開き直してください。データは消していません。</p></div>`;
}

main().catch(showFatal);
