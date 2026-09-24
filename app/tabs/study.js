// 学習タブ: 復習ミックス(または全語)を、2 段階クイズかカードで解く。
// 2 段階クイズは既存アプリと同じ: 第 1 段階で「わかる / わからない」を自己申告し、第 2 段階で 4 択 +
// 「思い浮かべた訳が選択肢に無い」から選ぶ。判定と記録は core の stage1Record / stage2Judge(Docs/23_Screens.md §4)。

import { esc, actionOf } from '../dom.js';
import { posLine } from '../wordForm.js';
import { keyOf, isPhrase } from '../../core/word.js';
import { sessionsOf } from '../../core/book.js';
import { reviewMix, recordAnswer, baseDate, answerCount, missOften, stage1Record, stage2Judge } from '../../core/review.js';
import { buildChoices, quizModes } from '../../core/distractors.js';
import { BUILTIN_VOCAB } from '../../core/builtinVocab.js';
import { shuffle } from '../../core/random.js';

/** @typedef {import('../dom.js').Ctx} Ctx */
/** @typedef {import('../../core/word.js').Word} Word */
/** @typedef {import('../../core/review.js').Group} Group */
/** @typedef {import('../../core/distractors.js').ChoiceOk | import('../../core/distractors.js').ChoiceNg} Choice */
/** @typedef {ReturnType<typeof stage2Judge>['verdict']} Verdict */

/**
 * 解いている出題。2 段階クイズは前へ戻れない(答えた問題を解き直すと記録が二重になる)。
 * @typedef {object} Quiz
 * @property {{ word: Word, group: Group | null }[]} items
 * @property {number} idx
 * @property {1 | 2} stage
 * @property {boolean | null} self 第 1 段階の申告
 * @property {Choice | null} choice 今の問題の選択肢(問題ごとに 1 度だけ作る。途中で語を編集しても作り直さない)
 * @property {number | null} picked 選んだ選択肢の番号(-1 は「選択肢に無い」)
 * @property {Verdict | null} verdict
 * @property {boolean} reveal カードで裏を見せているか
 * @property {number} ok 正答数
 * @property {number} answered 記録した問題の数(結果の分母)
 */

const st = {
  /** @type {'mix' | 'all'} */ source: 'mix',
  /** @type {'choice' | 'card'} */ format: 'choice',
  /** @type {'all' | 'word' | 'phrase'} */ kind: 'all',
  /** @type {Quiz | null} */ quiz: null,
};

const REASON = {
  noMeaning: '意味が登録されていないため',
  needBuiltin: '語が 4 語未満で、内蔵語彙を使わない設定のため',
  notEnoughCandidates: '誤答にできる語が足りないため',
};

/** @param {Ctx} ctx */
export function render(ctx) {
  const modes = quizModes(ctx.book.words, { builtin: BUILTIN_VOCAB, useBuiltin: ctx.settings.useBuiltin });
  if (modes.tier === 'empty') {
    st.quiz = null;
    ctx.root.innerHTML = `<p class="empty">出題できる語がありません(意味のある語が 0 語)。<button data-action="go-add">単語を追加する</button></p>`;
    bind(ctx);
    return;
  }
  ctx.root.innerHTML = st.quiz ? renderQuiz(ctx) : renderStart(ctx, modes.choice);
  bind(ctx);
}

/**
 * @param {Ctx} ctx
 * @param {boolean} choiceOk
 */
function renderStart(ctx, choiceOk) {
  const sel = (/** @type {string} */ name, /** @type {string} */ label, /** @type {[string, string][]} */ opts, /** @type {string} */ cur) =>
    `<select name="${name}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const base = baseDate(sessionsOf(ctx.book), ctx.today);
  return `<section class="panel">
    <h2>学習</h2>
    <div class="toolrow">
      ${sel('source', '出題する語', [['mix', '復習ミックス'], ['all', 'すべての語(シャッフル)']], st.source)}
      ${sel('format', '形式', [['choice', '2 段階クイズ'], ['card', 'カード']], st.format)}
      ${sel('kind', '種別', [['all', '単語と句表現'], ['word', '単語だけ'], ['phrase', '句表現だけ']], st.kind)}
    </div>
    <p class="meta">復習ミックスは、${base === ctx.today || !base ? '今日' : `直近(${esc(base)})`}追加した語・1 回前・3 回前・よく間違える語・回答の少ない語の順に出します。</p>
    ${choiceOk ? '' : '<p class="stagebanner">語が 4 語未満で内蔵語彙を使わない設定なので、クイズはカードで出します(設定タブで変えられます)。</p>'}
    <div class="rowbtns"><button class="primary" data-action="start">始める</button></div>
  </section>`;
}

/** @param {Ctx} ctx */
function start(ctx) {
  /** @type {{ word: Word, group: Group | null }[]} */
  let items;
  if (st.source === 'mix') {
    items = reviewMix(sessionsOf(ctx.book), ctx.book.records, { today: ctx.today, kind: st.kind });
  } else {
    const kindOk = (/** @type {Word} */ w) => st.kind === 'all' || isPhrase(w) === (st.kind === 'phrase');
    items = shuffle(ctx.book.words.filter(kindOk), Math.random).map((word) => ({ word, group: null }));
  }
  st.quiz = { items, idx: 0, ...fresh(), ok: 0, answered: 0 };
}

/** 次の問題へ進むときに消す状態 */
function fresh() {
  return { stage: /** @type {1 | 2} */ (1), self: null, choice: null, picked: null, verdict: null, reveal: false };
}

/** @param {Ctx} ctx */
function renderQuiz(ctx) {
  const qz = /** @type {Quiz} */ (st.quiz);
  // 途中で単語帳から消した語(見出し語か品詞を変えて鍵が変わった語を含む)は飛ばす(INV-5: 単語帳に無い語は出さない)
  const keys = new Set(ctx.book.words.map(keyOf));
  while (qz.idx < qz.items.length && !keys.has(keyOf(qz.items[qz.idx].word))) qz.idx++;
  if (!qz.items.length) {
    return `<div class="q"><p>この条件で出せる語がありません。</p><div class="rowbtns"><button data-action="quit">戻る</button></div></div>`;
  }
  if (qz.idx >= qz.items.length) {
    const summary = st.format === 'choice'
      ? `結果: ${qz.ok} / ${qz.answered}`
      : `${qz.items.length} 枚を見終わりました`;
    const skipped = st.format === 'choice' && qz.answered < qz.items.length
      ? `<p class="stagenote">カードで出した問題と、途中で単語帳から消した語の ${qz.items.length - qz.answered} 問は数えていません。</p>` : '';
    return `<div class="q"><div class="stem">${summary}</div>
      ${st.format === 'choice' ? '<p class="stagenote">「わかる」と答えて選択肢も正解したものだけを正答として数えています。</p>' : ''}${skipped}
      <div class="rowbtns"><button class="primary" data-action="again">もう一度</button><button data-action="quit">条件を変える</button></div></div>`;
  }
  const { word: w, group } = qz.items[qz.idx];
  // 今の単語帳の語で表示する(途中で意味などを編集した語は新しい内容で出す。選択肢は出したときのまま)
  const cur = /** @type {Word} */ (ctx.book.words.find((x) => keyOf(x) === keyOf(w)));
  if (st.format === 'choice' && !qz.choice) {
    qz.choice = buildChoices(cur, ctx.book.words, { builtin: BUILTIN_VOCAB, useBuiltin: ctx.settings.useBuiltin });
  }
  const head = `<p class="meta">${qz.idx + 1} / ${qz.items.length}${st.format === 'choice' ? ` ｜ 正答 ${qz.ok} ｜ 第 ${qz.stage} 段階` : ''}` +
    (group ? ` ｜ <b>${groupLabel(group, ctx)}</b>${group === 'few' ? `(この語の回答 ${answerCount(ctx.book.records, keyOf(cur))} 回)` : ''}` : '') + '</p>';
  const stem = `<div class="stem${isPhrase(cur) ? ' ph' : ''}" lang="en">${esc(cur.en)}</div>`;
  if (st.format === 'card' || (qz.choice && !qz.choice.ok)) {
    const why = qz.choice && !qz.choice.ok ? `<p class="stagebanner">${REASON[qz.choice.reason]}、4 択を作れません。カードで確かめてください(記録には入りません)。</p>` : '';
    const back = [cur.ex, cur.exJa, cur.note].filter(Boolean).map(esc).join('<br>');
    // 前へ戻れるのはカード形式だけ(2 段階クイズで戻ると、答えた問題を解き直して記録が二重になる)
    const prev = st.format === 'card' ? '<button data-action="prev">← 前へ</button>' : '';
    return head + `<div class="q card" data-action="flip">${why}${stem}<div class="pos">${posLine(cur)}</div>
      ${qz.reveal ? `<div class="back">${esc(cur.ja ?? '(意味なし)')}</div><div class="ex">${back}</div>` : '<p class="meta">タップで意味を表示</p>'}
      </div><div class="rowbtns">${prev}<button class="primary" data-action="next">次へ →</button><button data-action="quit">終わる</button></div>`;
  }
  const choice = /** @type {import('../../core/distractors.js').ChoiceOk} */ (qz.choice);
  if (qz.stage === 1) {
    return head + `<div class="q">${stem}<div class="pos">${posLine(cur)} ｜ 意味を思い出せますか</div>
      <div class="choices two"><button class="choice self yes" data-action="self" data-v="1">わかる</button>
      <button class="choice self no" data-action="self" data-v="0">わからない</button></div>
      <p class="stagenote">「わからない」は不正解として記録します。そのあとも選択肢と解説は表示されますが、そこで選んだものは記録に入りません。正直に押してください。</p></div>`;
  }
  const answered = qz.picked !== null;
  let h = head + `<div class="q">${stem}<div class="pos">${posLine(cur)} ｜ 意味を選んでください</div>`;
  if (!qz.self) h += '<p class="stagebanner">「わからない」を選んだので、この問題は<b>不正解として記録済み</b>です。ここから先の回答は記録に入りません。</p>';
  h += '<div class="choices">';
  choice.options.forEach((o, i) => {
    const cls = answered ? (o.correct ? ' correct' : qz.picked === i ? ' wrong' : '') : '';
    h += `<button class="choice${cls}" data-action="pick" data-i="${i}"${answered ? ' disabled' : ''}>${esc(o.word.ja)}</button>`;
  });
  h += `<button class="choice none${answered && qz.picked === -1 ? ' wrong' : ''}" data-action="pick" data-i="-1"${answered ? ' disabled' : ''}>思い浮かべた訳が選択肢に無い</button></div>`;
  if (answered) {
    const pickOk = qz.picked !== null && qz.picked >= 0 && choice.options[qz.picked].correct;
    const verdict = {
      correct: '<b class="ok">正解</b>',
      misbelief: '<b class="ng">不正解</b>(思い違い)',
      notListed: '<b class="ng">不正解</b>(思い浮かべた訳が選択肢にありませんでした)',
      unknown: `<b class="ng">不正解</b>(わからないと申告)${pickOk ? ' ／ 選択肢では正解を選べました' : ''}`,
    }[/** @type {Verdict} */ (qz.verdict)];
    const sub = [cur.exJa, cur.note].filter(Boolean).map(esc).join(' ／ ');
    h += `<div class="fb" role="status">${verdict}${missOften(ctx.book.records, keyOf(cur)) ? ' <span class="meta">よく間違える語</span>' : ''}
      ${cur.ex ? `<div lang="en">${esc(cur.ex)}</div>` : ''}${sub ? `<div class="meta">${sub}</div>` : ''}
      <div class="rowbtns left"><button class="primary" data-action="next">次の問題 →</button></div></div>`;
  }
  return h + '</div>';
}

/**
 * @param {Group} g
 * @param {Ctx} ctx
 */
function groupLabel(g, ctx) {
  if (g === 'today') {
    const b = baseDate(sessionsOf(ctx.book), ctx.today);
    return b === ctx.today || !b ? '今日' : `直近(${esc(b)})`;
  }
  return { d1: '1 回前', d3: '3 回前', miss: 'よく間違える', few: '回答数が少ない' }[g];
}

/**
 * 記録を 1 件積んで保存する。
 * @param {Ctx} ctx
 * @param {Word} w
 * @param {{ ok: boolean, self: boolean }} r
 */
function record(ctx, w, r) {
  /** @type {Quiz} */ (st.quiz).answered++;
  return ctx.commit({ ...ctx.book, records: recordAnswer(ctx.book.records, keyOf(w), r.ok, r.self) });
}

/** @param {Ctx} ctx */
function bind(ctx) {
  ctx.root.onchange = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    if (t.name === 'source') st.source = /** @type {any} */ (t.value);
    if (t.name === 'format') st.format = /** @type {any} */ (t.value);
    if (t.name === 'kind') st.kind = /** @type {any} */ (t.value);
  };
  ctx.root.onclick = async (e) => {
    const el = actionOf(e);
    if (!el || (el instanceof HTMLButtonElement && el.disabled)) return;
    const act = el.dataset.action;
    const qz = st.quiz;
    if (act === 'go-add') return ctx.go('add');
    if (act === 'start' || act === 'again') {
      start(ctx);
      return ctx.rerender();
    }
    if (act === 'quit') {
      st.quiz = null;
      return ctx.rerender();
    }
    if (!qz) return;
    const cur = qz.items[qz.idx]?.word;
    if (act === 'flip') {
      qz.reveal = !qz.reveal;
      return ctx.rerender();
    }
    if (act === 'next') {
      qz.idx++;
      Object.assign(qz, fresh());
      return ctx.rerender();
    }
    if (act === 'prev' && st.format === 'card') {
      qz.idx = Math.max(0, qz.idx - 1);
      Object.assign(qz, fresh());
      return ctx.rerender();
    }
    if (act === 'self' && cur && qz.stage === 1) {
      qz.self = el.dataset.v === '1';
      qz.stage = 2;
      const r = stage1Record(qz.self);
      return r ? record(ctx, cur, r) : ctx.rerender();
    }
    if (act === 'pick' && cur && qz.choice?.ok && qz.picked === null && qz.self !== null) {
      const i = Number(el.dataset.i);
      qz.picked = i;
      const j = stage2Judge(qz.self, i < 0 ? 'notListed' : qz.choice.options[i].correct ? 'correct' : 'wrong');
      qz.verdict = j.verdict;
      if (j.correct) qz.ok++;
      return j.record ? record(ctx, cur, j.record) : ctx.rerender();
    }
  };
}
