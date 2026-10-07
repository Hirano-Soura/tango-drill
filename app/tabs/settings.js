// 設定タブ: 端末ごとの設定と、バックアップの書き出し・読み込み(復元)。
// 復元は確認表(INV-2)を通さず、件数を見せて確かめてから単語帳の全体を置き換える。次の復元まで元に戻せる。
// 規則は Docs/22_Storage.md §3、画面の規則は Docs/23_Screens.md §3。

import { esc, actionOf, download } from '../dom.js';
import { backupText, parseBackup } from '../../core/backup.js';
import { countBook } from '../../core/book.js';
import { VERSION, isPreRelease } from '../../core/version.js';
import { RATES } from '../../core/speech.js';
import * as speech from '../speech.js';

/** @typedef {import('../dom.js').Ctx} Ctx */
/** @typedef {import('../../core/book.js').Book} Book */

/** 読み込んで確認を待っているバックアップ(描き直しても残す) */
let pending = /** @type {{ name: string, book: Book, exportedAt?: string, warnings: string[] } | null} */ (null);
/** 直前の結果 */
let message = '';
let isError = false;

/** @param {Ctx} ctx */
export function render(ctx) {
  ctx.root.innerHTML = `<section class="panel">
    <h2>設定</h2>
    <div class="check"><input type="checkbox" id="useBuiltin"${ctx.settings.useBuiltin ? ' checked' : ''}>
      <label for="useBuiltin">4 択の誤答に内蔵の語彙を使う</label></div>
    <p class="hint">単語帳の語が少ないうちは、誤答の選択肢を内蔵の語彙で補います。内蔵の語彙が問題に出ることはありません。
      切ると、語が 4 語未満のあいだはカードで出題します。</p>
  </section>
  ${speechPanel(ctx)}
  <section class="panel" id="backup-panel">
    <h2>バックアップ</h2>
    <p class="hint">単語帳と学習の記録を 1 つのファイルに書き出します。機種変更のときや別の端末へ移すときは、
      書き出したファイルを移した先で読み込みます。この画面の設定はファイルに入りません。</p>
    <div class="rowbtns left"><button type="button" data-action="export">書き出す</button></div>
    <div class="wordform">
      <div class="f"><label for="backup-file">バックアップを読み込む</label>
        <input type="file" id="backup-file" accept=".json,application/json"></div>
    </div>
    ${pending ? pendingHtml(ctx, pending) : ''}
    ${!pending && ctx.canUndoRestore ? `<div id="restore-undo">
      <div class="rowbtns left"><button type="button" data-action="undo-restore">読み込む前の単語帳に戻す</button></div>
      <p class="hint">直前に読み込んだバックアップを取り消します。読み込んだあとに足した語や記録は消えます。</p></div>` : ''}
    <p class="msg${isError ? ' err' : ''}" role="status" id="backup-msg">${esc(message)}</p>
  </section>
  <section class="panel">
    <h2>データについて</h2>
    <p class="hint">単語帳と学習の記録は、この端末のブラウザの中にだけ保存され、外部には送信されません。
      ブラウザのデータを消すと単語帳も消えます。</p>
    <p class="hint" id="app-version">バージョン ${VERSION}${isPreRelease(VERSION) ? '(pre-release)' : ''}</p>
  </section>`;

  const box = /** @type {HTMLInputElement} */ (ctx.root.querySelector('#useBuiltin'));
  box.onchange = () => ctx.setSettings({ ...ctx.settings, useBuiltin: box.checked });

  bindSpeech(ctx);

  const file = /** @type {HTMLInputElement} */ (ctx.root.querySelector('#backup-file'));
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    // 読むだけで、保存はしない。置き換えるのは確認のあと
    const r = parseBackup(await f.text(), { today: ctx.today });
    if (r.fatal !== undefined || !r.book) {
      pending = null;
      message = `「${f.name}」は読み込めません: ${r.fatal}`;
      isError = true;
    } else {
      pending = { name: f.name, book: r.book, exportedAt: r.exportedAt, warnings: r.warnings };
      message = '';
      isError = false;
    }
    ctx.rerender();
    ctx.root.querySelector('#restore-confirm')?.scrollIntoView({ block: 'start' });
  };

  ctx.root.onclick = async (e) => {
    const act = actionOf(e)?.dataset.action;
    if (act === 'export') {
      const c = countBook(ctx.book);
      download(`tango-drill_backup_${ctx.today}.json`, backupText(ctx.book, new Date().toISOString()), 'application/json');
      message = `書き出しました(語数 ${c.words}・記録件数 ${c.answers}・印 ${c.starred})`;
      isError = false;
      ctx.rerender();
    } else if (act === 'cancel-restore') {
      pending = null;
      message = '読み込みをやめました(単語帳は変えていません)';
      isError = false;
      ctx.rerender();
    } else if (act === 'restore' && pending) {
      const next = pending.book;
      const c = countBook(next);
      pending = null;
      await run(ctx, () => ctx.restore(next), `バックアップで置き換えました(語数 ${c.words}・記録件数 ${c.answers}・印 ${c.starred})`);
    } else if (act === 'speech-test') {
      speech.speak(SAMPLE, ctx.settings);
    } else if (act === 'undo-restore') {
      await run(ctx, () => ctx.undoRestore(), '読み込む前の単語帳に戻しました');
    }
  };
}

/** 試し聞きの文 */
const SAMPLE = 'I would like to confirm the itinerary for my business trip.';

/**
 * 読み上げの欄。使える音声は端末内の英語の音声だけ(INV-1。Docs/24_Speech.md)。
 * @param {Ctx} ctx
 * @returns {string}
 */
function speechPanel(ctx) {
  const head = '<section class="panel" id="speech-panel"><h2>読み上げ</h2>';
  if (!speech.supported) {
    return head + '<p class="hint" id="speech-note">このブラウザは読み上げに対応していません。別のブラウザ(Chrome・Edge・Safari など)で開くと使えます。</p></section>';
  }
  const list = speech.voices();
  const remote = speech.remoteCount();
  const s = ctx.settings;
  const chosenOk = list.some((v) => v.voiceURI === s.speechVoice);
  const voiceOpts = [['', `自動${list[0] ? `(${list[0].name})` : ''}`], ...list.map((v) => [v.voiceURI, `${v.name}(${v.lang})`])]
    .map(([val, label]) => `<option value="${esc(val)}"${val === (chosenOk ? s.speechVoice : '') ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const rateOpts = RATES.map(([r, label]) => `<option value="${r}"${r === s.speechRate ? ' selected' : ''}>${label}</option>`).join('');
  const note = !list.length
    ? `この端末のブラウザには、使える英語の音声がありません${remote ? `(インターネット経由の音声が ${remote} 個ありますが、単語を外部へ送らないために使いません)` : ''}。
      端末の設定で英語の音声を追加するか、別のブラウザで開いてください。Windows は「設定」→「時刻と言語」→「音声認識」の「音声」で英語(米国)の音声を追加できます。`
    : remote ? `インターネット経由の英語の音声(${remote} 個)は、単語や例文を外部へ送るため一覧に出していません。この端末の中にある音声だけで読みます。` : '';
  return head + `<div class="check"><input type="checkbox" id="speechAuto"${s.speechAuto ? ' checked' : ''}${list.length ? '' : ' disabled'}>
      <label for="speechAuto">問題を出したときに見出し語を自動で読み上げる</label></div>
    <p class="hint">切っていても、学習の画面の「発音」で読み上げられます。答えたあとは例文も読めます。</p>
    <div class="wordform">
      <div class="f"><label for="speechVoice">音声</label><select id="speechVoice"${list.length ? '' : ' disabled'}>${voiceOpts}</select></div>
      <div class="f"><label for="speechRate">速さ</label><select id="speechRate"${list.length ? '' : ' disabled'}>${rateOpts}</select></div>
    </div>
    <div class="rowbtns left"><button type="button" data-action="speech-test"${list.length ? '' : ' disabled'}>試し聞き</button></div>
    ${note ? `<p class="hint" id="speech-note">${note}</p>` : ''}
  </section>`;
}

/** @param {Ctx} ctx */
function bindSpeech(ctx) {
  const auto = /** @type {HTMLInputElement | null} */ (ctx.root.querySelector('#speechAuto'));
  const voice = /** @type {HTMLSelectElement | null} */ (ctx.root.querySelector('#speechVoice'));
  const rate = /** @type {HTMLSelectElement | null} */ (ctx.root.querySelector('#speechRate'));
  if (auto) auto.onchange = () => ctx.setSettings({ ...ctx.settings, speechAuto: auto.checked });
  // 選んだら試しに読む(どんな声かをすぐ確かめられるように)
  if (voice) voice.onchange = () => ctx.setSettings({ ...ctx.settings, speechVoice: voice.value }).then(() => speech.speak(SAMPLE, ctx.settings));
  if (rate) rate.onchange = () => ctx.setSettings({ ...ctx.settings, speechRate: Number(rate.value) }).then(() => speech.speak(SAMPLE, ctx.settings));
}

/**
 * 保存層を変える操作を行い、結果を知らせる。失敗したら理由を出す(成功の知らせを先に出さない)。
 * @param {Ctx} ctx
 * @param {() => Promise<void>} op
 * @param {string} done
 */
async function run(ctx, op, done) {
  message = done;
  isError = false;
  try {
    await op();
  } catch (err) {
    message = '失敗しました: ' +(err instanceof Error ? err.message : String(err));
    isError = true;
    ctx.rerender();
  }
}

/**
 * 置き換える前の確認。読み込むファイルと今の単語帳の件数を並べる。
 * @param {Ctx} ctx
 * @param {NonNullable<typeof pending>} p
 * @returns {string}
 */
function pendingHtml(ctx, p) {
  const a = countBook(p.book);
  const b = countBook(ctx.book);
  /** @type {[string, number, number][]} */
  const rows = [
    ['語数', a.words, b.words],
    ['記録件数', a.answers, b.answers],
    ['記録のある語', a.recordedWords, b.recordedWords],
    ['印', a.starred, b.starred],
  ];
  return `<div id="restore-confirm"><h2>読み込む前の確認</h2>
    <p class="meta">${esc(p.name)} ・ 書き出した日時 ${p.exportedAt ? esc(dateTime(p.exportedAt)) : '不明'}</p>
    <div class="tablewrap"><table>
      <thead><tr><th></th><th>読み込むファイル</th><th>今の単語帳</th></tr></thead>
      <tbody>${rows.map(([name, x, y]) => `<tr><th>${name}</th><td>${x}</td><td>${y}</td></tr>`).join('')}</tbody>
    </table></div>
    ${p.warnings.length ? `<ul class="warns">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <p class="hint">置き換えると、今の単語帳(語・追加日・記録・印)はすべてこのファイルの中身になります。
      次にバックアップを読み込むまでは、読み込む前の単語帳に戻せます。記録件数は正誤の記録の総数で、単語帳から消した語の分も数えます。</p>
    <div class="rowbtns"><button type="button" class="primary" data-action="restore">置き換える</button>
      <button type="button" data-action="cancel-restore">やめる</button></div></div>`;
}

/**
 * ISO 8601 の日時を端末の時刻で「YYYY-MM-DD HH:MM」にする。
 * @param {string} iso
 * @returns {string}
 */
function dateTime(iso) {
  const d = new Date(iso);
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
