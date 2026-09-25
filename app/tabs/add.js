// 追加タブ: 1 語ずつ手で足す欄と、まとめて貼り付ける取り込み(確認表。INV-2)。
// 取り込みは 貼り付け → 確認表を作る → 行ごとに選ぶ → 確定 の順でしか単語帳を変えない。
// 確認表の規則は Docs/20_ImportFormat.md §4、画面の規則は Docs/23_Screens.md §3。

import { esc, actionOf, splitTags } from '../dom.js';
import { wordFields, readWordFields, posLine } from '../wordForm.js';
import { addOneWord, importIntoBook } from '../../core/book.js';
import { parseImport, SIMPLE_EXAMPLE } from '../../core/importFormat.js';
import { planImport, confirmPlan } from '../../core/importPlan.js';

/** @typedef {import('../dom.js').Ctx} Ctx */
/** @typedef {import('../../core/importPlan.js').Plan} Plan */
/** @typedef {import('../../core/importPlan.js').PlanRow} PlanRow */
/** @typedef {import('../../core/importPlan.js').Choices} Choices */
/** @typedef {import('../../core/importPlan.js').Conflict} Conflict */

/** 直前の結果(描き直しても残す) */
let message = '';
let isError = false;

/** 取り込み: 貼り付けた内容・既定・確認表・行ごとの選択(描き直しても残す) */
let pasted = '';
let exSrc = /** @type {'' | 'ai' | 'set'} */ ('');
let tagText = '';
let plan = /** @type {Plan | null} */ (null);
/** @type {Choices} */
let choices = {};
let importMsg = '';
let importIsError = false;

/** 行の種類の表示名 */
const ACTION_LABEL = /** @type {Record<PlanRow['action'], string>} */ ({
  add: '足す',
  merge: '既存の語に重ねる',
  same: '変更なし',
  ambiguous: '当て先を選ぶ',
  duplicate: '重複',
  error: '読めない行',
  skipped: '語ではない行',
});

/** 項目名の表示名 */
const FIELD_LABEL = /** @type {Record<string, string>} */ ({
  pos: '品詞', trans: '自他', ja: '意味', ex: '例文', exJa: '例文の和訳', note: '補足', kind: '種別', tags: 'タグ',
});

/** @param {Ctx} ctx */
export function render(ctx) {
  ctx.root.innerHTML = `
    <section class="panel">
      <h2>単語を追加</h2>
      <form id="add-form" class="wordform">
        ${wordFields()}
        <div class="rowbtns"><button type="submit" class="primary">追加する</button></div>
      </form>
      <p class="msg${isError ? ' err' : ''}" role="status" id="add-msg">${esc(message)}</p>
    </section>
    <section class="panel" id="import-panel">
      <h2>まとめて取り込む</h2>
      <p class="hint">AI の返答や表計算からのコピーを貼り付けるか、ファイルを選びます。
        1 行 1 語で「見出し語 | 品詞 | 意味 | 例文 | 例文の和訳 | 補足」の順。確認表で中身を確かめてから単語帳に入れます。</p>
      <div class="wordform">
        <div class="f"><label for="imp-text">貼り付ける内容</label><textarea id="imp-text" rows="6" spellcheck="false" placeholder="${esc(SIMPLE_EXAMPLE)}">${esc(pasted)}</textarea></div>
        <div class="f"><label for="imp-file">ファイルから読む</label><input type="file" id="imp-file" accept=".txt,.json,.tsv,.md,text/plain,application/json"></div>
        <div class="two">
          <div class="f"><label for="imp-tags">全部の語に付けるタグ(読点・カンマ区切り)</label><input id="imp-tags" autocomplete="off" value="${esc(tagText)}"></div>
          <div class="f"><label for="imp-src">例文の出どころ</label><select id="imp-src">
            ${[['', '—'], ['ai', 'AI'], ['set', '教材セット']].map(([v, t]) => `<option value="${v}"${exSrc === v ? ' selected' : ''}>${t}</option>`).join('')}
          </select></div>
        </div>
      </div>
      <div class="rowbtns"><button type="button" data-action="plan"${plan ? '' : ' class="primary"'}>確認表を作る</button>
        <button type="button" data-action="example"${pasted ? ' disabled' : ''}>例を入れる</button></div>
      ${plan ? planHtml(plan) : ''}
      <p class="msg${importIsError ? ' err' : ''}" role="status" id="import-msg">${esc(importMsg)}</p>
    </section>`;
  bindAdd(ctx);
  bindImport(ctx);
}

/** @param {Ctx} ctx */
function bindAdd(ctx) {
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

/** @param {Ctx} ctx */
function bindImport(ctx) {
  const text = /** @type {HTMLTextAreaElement} */ (ctx.root.querySelector('#imp-text'));
  const tags = /** @type {HTMLInputElement} */ (ctx.root.querySelector('#imp-tags'));
  const src = /** @type {HTMLSelectElement} */ (ctx.root.querySelector('#imp-src'));
  const file = /** @type {HTMLInputElement} */ (ctx.root.querySelector('#imp-file'));
  // 入力を変えたら、作ってある確認表は古くなる(確定させない)。入力中の欄を描き直さないよう、確認表だけを外す
  const stale = () => {
    if (!plan) return;
    plan = null;
    choices = {};
    importMsg = '内容を変えたので、確認表を作り直してください';
    importIsError = false;
    ctx.root.querySelector('#plan')?.remove();
    ctx.root.querySelector('[data-action="plan"]')?.classList.add('primary');
    const msg = ctx.root.querySelector('#import-msg');
    if (msg) {
      msg.textContent = importMsg;
      msg.classList.remove('err');
    }
  };
  // 例を入れるのは空の欄にだけ(貼り付けた内容を例で消さない)
  const exampleBtn = /** @type {HTMLButtonElement} */ (ctx.root.querySelector('[data-action="example"]'));
  text.oninput = () => { pasted = text.value; exampleBtn.disabled = pasted !== ''; stale(); };
  tags.oninput = () => { tagText = tags.value; stale(); };
  src.onchange = () => { exSrc = /** @type {typeof exSrc} */ (src.value); stale(); };
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    pasted = await f.text();
    plan = null;
    choices = {};
    importMsg = `「${f.name}」を読みました。確認表を作ってください`;
    importIsError = false;
    ctx.rerender();
  };

  ctx.root.onchange = (e) => {
    const el = e.target;
    if (!(el instanceof HTMLSelectElement) || el.dataset.ref === undefined || !plan) return;
    const ref = Number(el.dataset.ref);
    const v = el.value;
    const next = { ...choices };
    if (v === '') delete next[ref];
    else if (v.startsWith('t:')) next[ref] = { target: v.slice(2) };
    else next[ref] = /** @type {'skip' | 'overwrite' | 'add'} */ (v);
    choices = next;
  };

  ctx.root.onclick = async (e) => {
    const act = actionOf(e)?.dataset.action;
    if (act === 'example' && !text.value) {
      text.value = SIMPLE_EXAMPLE;
      text.dispatchEvent(new Event('input'));
      text.focus();
    } else if (act === 'plan') {
      pasted = text.value;
      tagText = tags.value;
      plan = planImport(ctx.book.words, parseImport(pasted), { exSrc: exSrc || undefined, tags: splitTags(tagText) });
      choices = {};
      importMsg = plan.fatal !== undefined ? '' : plan.rows.length ? '' : '語が見つかりませんでした';
      importIsError = false;
      ctx.rerender();
      ctx.root.querySelector('#plan')?.scrollIntoView({ block: 'start' });
    } else if (act === 'cancel-plan') {
      plan = null;
      choices = {};
      importMsg = '取り込みをやめました(単語帳は変えていません)';
      importIsError = false;
      ctx.rerender();
    } else if (act === 'confirm' && plan) {
      let r;
      try {
        r = importIntoBook(ctx.book, confirmPlan(plan, choices), ctx.today);
      } catch (err) {
        importMsg = err instanceof Error ? err.message : String(err);
        importIsError = true;
        ctx.rerender();
        return;
      }
      plan = null;
      choices = {};
      importIsError = false;
      if (!r.added && !r.updated) {
        importMsg = '取り込む語がありませんでした(単語帳は変えていません)';
        ctx.rerender();
        return;
      }
      pasted = '';
      const done = `取り込みました(追加 ${r.added} 語・更新 ${r.updated} 語)`;
      importMsg = done + `。単語帳の語数: ${r.book.words.length}`;
      await ctx.commit(r.book, done);
    }
  };
}

/**
 * 確認表の HTML。利用者の入力はすべて esc を通す。
 * @param {Plan} p
 * @returns {string}
 */
function planHtml(p) {
  if (p.fatal !== undefined) {
    return `<div id="plan"><p class="msg err">読めませんでした: ${esc(p.fatal)}</p></div>`;
  }
  const counts = /** @type {PlanRow['action'][]} */ (Object.keys(ACTION_LABEL))
    .filter((a) => p.counts[a])
    .map((a) => `${ACTION_LABEL[a]} ${p.counts[a]}`)
    .join(' ・ ');
  let h = `<div id="plan"><h2>確認表</h2>
    <p class="meta">形式 ${esc(p.format)} ・ ${counts || '行なし'}</p>`;
  if (p.warnings.length) h += `<ul class="warns">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
  h += '<ul class="words plan">';
  for (const row of p.rows) h += rowHtml(row);
  h += `</ul>
    <p class="hint">確定するまで単語帳は変わりません。食い違う項目は、上書きを選んだ行だけ入力の値にします。</p>
    <div class="rowbtns"><button type="button" class="primary" data-action="confirm">確定して取り込む</button>
      <button type="button" data-action="cancel-plan">やめる</button></div></div>`;
  return h;
}

/**
 * @param {PlanRow} row
 * @returns {string}
 */
function rowHtml(row) {
  const w = row.word;
  let body = `<div><span class="act a-${row.action}">${ACTION_LABEL[row.action]}</span> `;
  body += w ? `<span class="en" lang="en">${esc(w.en)}</span> <span class="meta">${posLine(w)}</span>` : `<span class="meta">${row.ref} 行目</span>`;
  body += '</div>';
  if (w) {
    if (w.ja) body += `<div class="ja">${esc(w.ja)}</div>`;
    if (w.ex) body += `<div class="ex" lang="en">${esc(w.ex)}</div>`;
    const sub = [w.exJa, w.note, ...(w.tags ?? []).map((t) => '#' + t)].filter(Boolean).map(esc).join(' ／ ');
    if (sub) body += `<div class="ex">${sub}</div>`;
  } else {
    body += `<div class="ex">${esc(row.raw)}</div>`;
  }
  if (row.target && row.action !== 'duplicate') body += `<div class="meta">単語帳の ${esc(keyLabel(row.target))} に当てる</div>`;
  if (row.fills?.length) body += `<div class="meta">埋める項目: ${row.fills.map(fieldLabel).join('・')}</div>`;
  if (row.conflicts?.length) body += conflictsHtml(row.conflicts);
  for (const pv of row.previews ?? []) {
    body += `<div class="meta">${esc(keyLabel(pv.target))} に当てると: ` +
      (pv.fills.length ? `埋める項目 ${pv.fills.map(fieldLabel).join('・')}` : '埋める項目なし') +
      (pv.conflicts.length ? ` ／ 食い違い ${pv.conflicts.map((c) => fieldLabel(c.field)).join('・')}(単語帳の値を残す)` : '') +
      '</div>';
  }
  if (row.message) body += `<div class="meta">${esc(row.message)}</div>`;
  if (row.warnings.length) body += `<div class="meta warn">注意: ${row.warnings.map(esc).join(' / ')}</div>`;

  const ops = selectHtml(row);
  return `<li class="word prow" data-ref="${row.ref}"><div class="body">${body}</div>${ops ? `<div class="ops">${ops}</div>` : ''}</li>`;
}

/**
 * 行ごとに選べることの選択欄。選べることの無い行は空。
 * @param {PlanRow} row
 * @returns {string}
 */
function selectHtml(row) {
  /** @type {[string, string][]} */
  let opts = [];
  if (row.action === 'add') opts = [['', '足す'], ['skip', '外す']];
  else if (row.action === 'merge') {
    opts = [['', '空欄だけ埋める']];
    if (row.conflicts?.length) opts.push(['overwrite', '食い違いも上書き']);
    opts.push(['skip', '外す']);
  } else if (row.action === 'ambiguous') {
    opts = [['', '取り込まない'], ...(row.candidates ?? []).map((k) => /** @type {[string, string]} */ ([`t:${k}`, `${keyLabel(k)} に当てる`])), ['add', '新しい語として足す']];
  }
  if (!opts.length) return '';
  const c = choices[row.ref];
  const cur = c === undefined ? '' : typeof c === 'object' ? `t:${c.target}` : c;
  const name = row.word?.en ?? String(row.ref);
  return `<select data-ref="${row.ref}" aria-label="${esc(name)}(${row.ref} 行目)の扱い">${opts
    .map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
}

/**
 * @param {Conflict[]} conflicts
 * @returns {string}
 */
function conflictsHtml(conflicts) {
  return `<div class="meta">食い違い(既定では単語帳の値を残す):</div><ul class="conf">${conflicts
    .map((c) => `<li>${fieldLabel(c.field)}: 単語帳「${esc(c.current)}」 ／ 入力「${esc(c.incoming)}」</li>`).join('')}</ul>`;
}

/** @param {string} f */
function fieldLabel(f) {
  return esc(FIELD_LABEL[f] ?? f);
}

/**
 * 語の鍵(見出し語|品詞)の表示。
 * @param {string} k
 * @returns {string}
 */
function keyLabel(k) {
  const i = k.lastIndexOf('|');
  const en = i < 0 ? k : k.slice(0, i);
  const pos = i < 0 ? '' : k.slice(i + 1);
  return pos ? `${en}(${pos})` : en;
}
