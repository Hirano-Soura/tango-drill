// 記録タブ: 語ごとの正誤・思い違いの集計、並べ替え、CSV の保存(Docs/21_Quiz.md §6)。

import { esc, actionOf, download } from '../dom.js';
import { allStats, sortStats, statsCsv, firstDates } from '../../core/review.js';
import { sessionsOf } from '../../core/book.js';

/** @typedef {import('../dom.js').Ctx} Ctx */
/** @typedef {import('../../core/review.js').StatSort} StatSort */

/** @type {Record<StatSort, string>} */
const SORT = { mis: '思い違いが多い順', wrong: '誤答が多い順', few: '回答が少ない順', date: '追加日の新しい順' };
/** @type {StatSort} */
let sortBy = 'mis';
let onlyAnswered = true;

/** @param {number | null} x */
const pct = (x) => (x == null ? '—' : Math.round(x * 1000) / 10 + '%');

/** @param {Ctx} ctx */
export function render(ctx) {
  const { book } = ctx;
  const dates = firstDates(sessionsOf(book));
  const all = allStats(book.words, book.records, new Set(book.starred));
  const answered = all.filter((s) => s.n > 0);
  const total = answered.reduce((n, s) => n + s.n, 0);
  const correct = answered.reduce((n, s) => n + s.correct, 0);
  const mis = answered.reduce((n, s) => n + s.mis, 0);
  const said = answered.reduce((n, s) => n + s.said, 0);
  const rows = sortStats(onlyAnswered ? answered : all, sortBy, dates);

  let h = `<div class="sumgrid">
    <div class="sumbox"><b>${book.words.length}</b><span>単語帳の語数</span></div>
    <div class="sumbox"><b>${answered.length}</b><span>回答した語</span></div>
    <div class="sumbox"><b>${total}</b><span>回答数(今の単語帳の語)</span></div>
    <div class="sumbox"><b>${pct(total ? correct / total : null)}</b><span>正答率</span></div>
    <div class="sumbox${mis ? ' warn' : ''}"><b>${mis}</b><span>思い違い(率 ${pct(said ? mis / said : null)})</span></div>
  </div>
  <div class="toolrow">
    ${Object.entries(SORT).map(([k, l]) => `<button class="${sortBy === k ? 'on' : ''}" data-action="sort" data-v="${k}">${l}</button>`).join('')}
    <button class="${onlyAnswered ? 'on' : ''}" data-action="scope">回答した語だけ</button>
    <button data-action="csv"${all.length ? '' : ' disabled'}>CSV を保存</button>
  </div>`;
  if (!rows.length) {
    h += `<p class="empty">${all.length ? 'まだ回答した語がありません。学習タブで解くと、ここに記録が出ます。' : '単語帳が空です。'}</p>`;
  } else {
    h += '<div class="tablewrap"><table><thead><tr><th>見出し語</th><th>回答</th><th>正答率</th><th>思い違い</th><th>直近の正誤</th></tr></thead><tbody>';
    for (const s of rows) {
      const hist = s.pairs.slice(-10).map((p) => `<i class="${p.ok ? 'o' : 'x'}${p.self === false ? ' u' : ''}">${p.ok ? '○' : '×'}</i>`).join('');
      h += `<tr data-key="${esc(s.key)}"><td><span class="en">${s.starred ? '<span class="star on">★</span>' : ''}${esc(s.w.en)}</span>
        <div class="meta">${esc(s.w.pos ?? '')} ${esc(s.w.ja ?? '')}${s.often ? ' ・ <span class="ng">よく間違える</span>' : ''}</div></td>
        <td>${s.n}</td><td>${pct(s.acc)}</td><td${s.mis ? ' class="mb"' : ''}>${s.mis}${s.said ? ` / ${s.said}` : ''}</td>
        <td class="hist">${hist}</td></tr>`;
    }
    h += '</tbody></table></div><p class="meta">思い違い = 「わかる」と申告して外した回数 / 「わかる」と申告した回数。薄い × は「わからない」と申告した回答。</p>';
  }
  ctx.root.innerHTML = h;
  ctx.root.onclick = (e) => {
    const el = actionOf(e);
    if (!el) return;
    if (el.dataset.action === 'sort') sortBy = /** @type {StatSort} */ (el.dataset.v);
    if (el.dataset.action === 'scope') onlyAnswered = !onlyAnswered;
    if (el.dataset.action === 'csv') {
      // Excel で文字化けしないよう、BOM はファイルに書き出すここで付ける
      download(`tango-drill_記録_${ctx.today}.csv`, String.fromCharCode(0xfeff) + statsCsv(rows.length ? rows : all, dates), 'text/csv');
      return;
    }
    ctx.rerender();
  };
}
