// 取り込みの確認表(INV-2)。ブラウザの API に触れない(INV-6)。
// 解析結果と既存の単語帳を突き合わせ、行ごとに何が起きるかを示す。保存に渡す語の一覧を返すのは
// applyImport だけで、applyImport は confirmPlan を通った確認表しか受け付けない。
// 規則は Docs/20_ImportFormat.md §4。

import { keyOf, normPos } from './word.js';

/** @typedef {import('./word.js').Word} Word */
/** @typedef {import('./importFormat.js').ParseResult} ParseResult */

/** 1 つずつ空欄を埋める・食い違いを調べる項目。例文(ex / exJa / exSrc)は一組で扱い、tags は足し合わせる */
const FIELDS = /** @type {const} */ (['pos', 'trans', 'ja', 'note', 'kind']);

/**
 * @typedef {object} Conflict
 * @property {string} field
 * @property {string} current 単語帳にある値
 * @property {string} incoming 入力の値
 */

/**
 * 確認表の 1 行。action の意味:
 * - add: 新しい語として足す
 * - merge: 既存の語(target)の空欄を埋める。食い違う項目は、既定では単語帳の値を残す
 * - same: 既存の語と同じで、変わるところが無い
 * - ambiguous: 品詞が無く、同じ綴りの語が複数あって当て先を決められない。既定では取り込まない
 * - duplicate: 同じ入力の中で先に出た語と重なる。取り込まない
 * - error / skipped: 読めなかった行・語ではない行。取り込まない
 * @typedef {object} PlanRow
 * @property {number} ref 解析結果の ref(簡易形式なら行番号)
 * @property {string} raw
 * @property {'add' | 'merge' | 'same' | 'ambiguous' | 'duplicate' | 'error' | 'skipped'} action
 * @property {Word} [word] 入力の語
 * @property {string} [target] 当てる既存の語の鍵(merge / same)
 * @property {string[]} [candidates] 当て先の候補の鍵(ambiguous)
 * @property {{ target: string, fills: string[], conflicts: Conflict[] }[]} [previews] 候補ごとに、当てたら変わること(ambiguous)
 * @property {string[]} [fills] 空欄を埋める項目(merge)
 * @property {Conflict[]} [conflicts] 値が食い違う項目(merge)
 * @property {string} [message] error / skipped / duplicate の理由
 * @property {string[]} warnings
 */

/**
 * @typedef {object} Plan
 * @property {string} format
 * @property {string} [fatal]
 * @property {string[]} warnings
 * @property {PlanRow[]} rows
 * @property {Record<PlanRow['action'], number>} counts
 * @property {string} base 突き合わせた単語帳の指紋(古い確認表で保存しないため)
 */

/**
 * 確認表で利用者が選んだこと。行の ref ごとに指定し、指定の無い行は既定に従う。
 * - 'skip': 取り込まない(add / merge)
 * - 'overwrite': 食い違う項目も入力の値で上書きする(食い違いのある merge)
 * - 'add': 新しい語として足す(ambiguous)
 * - { target }: この既存の語に当てる(ambiguous。candidates のどれか)
 * @typedef {Record<number, 'skip' | 'overwrite' | 'add' | { target: string }>} Choices
 */

/**
 * @typedef {object} PlanOptions
 * @property {'self' | 'ai' | 'set'} [exSrc] 例文を持つのに出どころの無い語に付ける出どころ
 * @property {string[]} [tags] 取り込む語すべてに足すタグ(教材セットの名前など)
 */

/**
 * confirmPlan が返す確認済みの確認表。中身は凍結されている。
 * @typedef {{ readonly plan: Plan, readonly choices: Choices }} ConfirmedPlan
 */

/**
 * @typedef {object} ApplyResult
 * @property {Word[]} words 保存する単語帳の全体
 * @property {{ from: string, to: string }[]} rekeys 品詞が埋まって鍵が変わった語(記録の付け替えに使う)
 * @property {number} added
 * @property {number} updated
 */

/** planImport が作った確認表。モジュールの外からは足せない */
const planned = new WeakSet();
/** confirmPlan を通った確認表。モジュールの外からは足せない */
const confirmed = new WeakSet();

/**
 * 確認表を作る。単語帳は変えない。返す確認表は凍結されている(利用者の選択は confirmPlan に渡す)。
 * @param {Word[]} existing 今の単語帳
 * @param {ParseResult} parsed
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 */
export function planImport(existing, parsed, opts = {}) {
  /** @type {Plan} */
  const plan = {
    format: parsed.format,
    warnings: [...parsed.warnings],
    rows: [],
    counts: { add: 0, merge: 0, same: 0, ambiguous: 0, duplicate: 0, error: 0, skipped: 0 },
    base: fingerprint(existing),
  };
  if (parsed.fatal !== undefined) return register({ ...plan, fatal: parsed.fatal });

  const byKey = new Map(existing.map((w) => [keyOf(w), w]));
  /** 入力の中で既に使った鍵(足す語の鍵・当てた既存の語の鍵) */
  const used = new Set();
  for (const r of parsed.rows) {
    const base = { ref: r.ref, raw: r.raw, warnings: [...r.warnings] };
    /** @type {PlanRow} */
    let row;
    if (r.error !== undefined) row = { ...base, action: 'error', message: r.error };
    else if (r.skipped !== undefined || !r.word) row = { ...base, action: 'skipped', message: r.skipped ?? '' };
    else row = planWord(base, withOptions(r.word, opts), existing, byKey, used);
    plan.counts[row.action]++;
    plan.rows.push(row);
  }
  return register(plan);
}

/**
 * @param {Plan} plan
 * @returns {Plan}
 */
function register(plan) {
  deepFreeze(plan);
  planned.add(plan);
  return plan;
}

/**
 * @param {{ ref: number, raw: string, warnings: string[] }} base
 * @param {Word} word
 * @param {Word[]} existing
 * @param {Map<string, Word>} byKey
 * @param {Set<string>} used
 * @returns {PlanRow}
 */
function planWord(base, word, existing, byKey, used) {
  const m = findTarget(word, existing, byKey);
  if (m.target === undefined) {
    // 足す語・当て先の決まらない語: 足したときの鍵が入力の中で重なれば取り込まない(INV-4)
    const k = keyOf(word);
    if (used.has(k)) return { ...base, action: 'duplicate', word, message: `同じ入力の中で先に出た ${k} と重なります` };
    used.add(k);
    if (m.candidates) {
      const previews = m.candidates.map((t) => ({ target: t, ...diff(/** @type {Word} */ (byKey.get(t)), word) }));
      return { ...base, action: 'ambiguous', word, candidates: m.candidates, previews };
    }
    return { ...base, action: 'add', word };
  }
  const target = m.target;
  if (used.has(target)) {
    return { ...base, action: 'duplicate', word, target, message: `同じ入力の中で先に出た ${target} と重なります` };
  }
  const cur = /** @type {Word} */ (byKey.get(target));
  const { fills, conflicts } = diff(cur, word);
  used.add(target);
  used.add(keyOf(mergeWord(cur, word, false)));
  if (!fills.length && !conflicts.length) return { ...base, action: 'same', word, target };
  return { ...base, action: 'merge', word, target, fills, conflicts };
}

/**
 * 入力の語を当てる既存の語を探す(INV-4 の鍵が第一。品詞の空欄は同じ綴りの語に寄せる)。
 * @param {Word} word
 * @param {Word[]} existing
 * @param {Map<string, Word>} byKey
 * @returns {{ target?: string, candidates?: string[] }}
 */
function findTarget(word, existing, byKey) {
  const k = keyOf(word);
  if (byKey.has(k)) return { target: k };
  const sameEn = existing.filter((w) => w.en === word.en);
  if (!normPos(word)) {
    // 品詞の無い入力: 同じ綴りの語が 1 つならそれに当てる。複数なら決められない
    if (sameEn.length === 1) return { target: keyOf(sameEn[0]) };
    if (sameEn.length > 1) return { candidates: sameEn.map(keyOf) };
    return {};
  }
  // 品詞のある入力: 品詞の無い同じ綴りの語が 1 つなら、それの品詞を埋める
  const bare = sameEn.filter((w) => !normPos(w));
  return bare.length === 1 ? { target: keyOf(bare[0]) } : {};
}

/**
 * @param {Word} cur
 * @param {Word} inc
 * @returns {{ fills: string[], conflicts: Conflict[] }}
 */
function diff(cur, inc) {
  /** @type {string[]} */
  const fills = [];
  /** @type {Conflict[]} */
  const conflicts = [];
  for (const f of FIELDS) {
    const v = inc[f];
    const c = cur[f];
    if (!v) continue;
    if (!c) fills.push(f);
    else if (f === 'pos' ? normPos(cur) !== normPos(inc) : c !== v) conflicts.push({ field: f, current: c, incoming: v });
  }
  // 例文: 和訳と出どころは例文に付いて動く。入力の和訳は、同じ例文の和訳のときだけ単独で埋める
  if (inc.ex) {
    if (!cur.ex) {
      fills.push('ex');
      if (inc.exJa) fills.push('exJa');
    } else if (cur.ex !== inc.ex) {
      conflicts.push({ field: 'ex', current: cur.ex, incoming: inc.ex });
      if ((cur.exJa ?? '') !== (inc.exJa ?? '')) conflicts.push({ field: 'exJa', current: cur.exJa ?? '', incoming: inc.exJa ?? '' });
    } else if (inc.exJa && !cur.exJa) {
      fills.push('exJa');
    } else if (inc.exJa && cur.exJa !== inc.exJa) {
      conflicts.push({ field: 'exJa', current: cur.exJa ?? '', incoming: inc.exJa });
    }
  }
  if ((inc.tags || []).some((t) => !(cur.tags || []).includes(t))) fills.push('tags');
  return { fills, conflicts };
}

/**
 * 既存の語に入力の語を重ねる。空欄は埋め、食い違いは overwrite のときだけ入力の値にする。
 * 品詞は括弧書きの違いしか食い違わない(鍵が同じ語にしか当てない)ので上書きしない。
 * @param {Word} cur
 * @param {Word} inc
 * @param {boolean} overwrite
 * @returns {Word}
 */
function mergeWord(cur, inc, overwrite) {
  const out = cloneWord(cur);
  for (const f of FIELDS) {
    const v = inc[f];
    if (!v) continue;
    if (!out[f] || (overwrite && f !== 'pos')) out[f] = v;
  }
  if (inc.ex && (!cur.ex || (overwrite && cur.ex !== inc.ex))) {
    // 例文を入力のものにするときは、和訳と出どころも入力のものにする(無ければ消す)
    out.ex = inc.ex;
    if (inc.exJa) out.exJa = inc.exJa;
    else delete out.exJa;
    if (inc.exSrc) out.exSrc = inc.exSrc;
    else delete out.exSrc;
  } else if (inc.ex && cur.ex === inc.ex && inc.exJa && (!cur.exJa || overwrite)) {
    out.exJa = inc.exJa;
  }
  const tags = [...new Set([...(cur.tags || []), ...(inc.tags || [])])];
  if (tags.length) out.tags = tags;
  return out;
}

/**
 * 確認表を確定する。確定した確認表だけが applyImport に渡せる(INV-2)。
 * @param {Plan} plan
 * @param {Choices} [choices]
 * @returns {ConfirmedPlan}
 */
export function confirmPlan(plan, choices = {}) {
  if (!planned.has(plan)) throw new Error('planImport が作っていない確認表は確定できません(INV-2)');
  if (plan.fatal !== undefined) throw new Error('読めなかった入力は確定できません: ' + plan.fatal);
  for (const [refText, c] of Object.entries(choices)) {
    const row = plan.rows.find((r) => r.ref === Number(refText));
    if (!row) throw new Error(`${refText} 番の行は確認表にありません`);
    const ok =
      (c === 'skip' && (row.action === 'add' || row.action === 'merge')) ||
      (c === 'overwrite' && row.action === 'merge' && !!row.conflicts?.length) ||
      (c === 'add' && row.action === 'ambiguous') ||
      (typeof c === 'object' && row.action === 'ambiguous' && !!row.candidates?.includes(c.target));
    if (!ok) throw new Error(`${refText} 番の行(${row.action})には ${JSON.stringify(c)} を選べません`);
  }
  // 1 つの既存の語に当てる行は 1 つだけ(ambiguous で選んだ当て先が、他の行の当て先と重ならないこと)
  /** @type {Map<string, number>} */
  const targets = new Map();
  for (const row of plan.rows) {
    const c = choices[row.ref];
    const t =
      (row.action === 'merge' || row.action === 'same') && c !== 'skip' ? row.target
        : row.action === 'ambiguous' && typeof c === 'object' ? c.target
          : undefined;
    if (t === undefined) continue;
    const prev = targets.get(t);
    if (prev !== undefined) throw new Error(`${row.ref} 番の行の当て先 ${t} は、${prev} 番の行の当て先と重なります`);
    targets.set(t, row.ref);
  }
  /** @type {ConfirmedPlan} */
  const out = deepFreeze({ plan, choices: JSON.parse(JSON.stringify(choices)) });
  confirmed.add(out);
  return out;
}

/**
 * 確定した確認表を単語帳に当て、保存する単語帳の全体を返す。渡された配列は変えない。
 * @param {Word[]} existing 確認表を作ったときと同じ単語帳
 * @param {ConfirmedPlan} confirmedPlan
 * @returns {ApplyResult}
 */
export function applyImport(existing, confirmedPlan) {
  if (!confirmed.has(confirmedPlan)) {
    throw new Error('確認表を経ていない取り込みは保存できません(INV-2)');
  }
  const { plan, choices } = confirmedPlan;
  if (fingerprint(existing) !== plan.base) {
    throw new Error('確認表を作ったあとに単語帳が変わりました。もう一度確認表を作ってください');
  }
  const words = existing.map(cloneWord);
  const index = new Map(words.map((w, i) => [keyOf(w), i]));
  /** @type {{ from: string, to: string }[]} */
  const rekeys = [];
  let added = 0;
  let updated = 0;
  for (const row of plan.rows) {
    const c = choices[row.ref];
    if (c === 'skip' || !row.word) continue;
    if (row.action === 'add' || (row.action === 'ambiguous' && c === 'add')) {
      // 防御: planImport の重複判定を通った確認表では起きない
      if (index.has(keyOf(row.word))) throw new Error(`${keyOf(row.word)} は既にあります(INV-4)`);
      index.set(keyOf(row.word), words.length);
      words.push(cloneWord(row.word));
      added++;
      continue;
    }
    let target = row.target;
    if (row.action === 'ambiguous') target = typeof c === 'object' ? c.target : undefined;
    else if (row.action !== 'merge') continue;
    const i = target === undefined ? undefined : index.get(target);
    if (i === undefined) continue;
    const before = keyOf(words[i]);
    words[i] = mergeWord(words[i], row.word, c === 'overwrite');
    const after = keyOf(words[i]);
    if (after !== before) {
      if (index.has(after)) throw new Error(`${before} の品詞を埋めると、既にある ${after} と重なります`);
      index.delete(before);
      index.set(after, i);
      rekeys.push({ from: before, to: after });
    }
    updated++;
  }
  return { words, rekeys, added, updated };
}

/**
 * @param {Word} w
 * @returns {Word}
 */
function cloneWord(w) {
  const out = { ...w };
  if (w.tags) out.tags = [...w.tags];
  return out;
}

/**
 * 入力の語に取り込みの既定(出どころ・タグ)を足す。
 * @param {Word} word
 * @param {PlanOptions} opts
 * @returns {Word}
 */
function withOptions(word, opts) {
  const w = cloneWord(word);
  if (opts.exSrc && w.ex && !w.exSrc) w.exSrc = opts.exSrc;
  const extra = (opts.tags || []).map((t) => t.trim()).filter(Boolean);
  if (extra.length) w.tags = [...new Set([...(w.tags || []), ...extra])];
  return w;
}

/**
 * 単語帳の指紋(FNV-1a 32bit)。確認表を作ったときと保存するときで単語帳が同じかを見る。
 * @param {Word[]} words
 * @returns {string}
 */
function fingerprint(words) {
  const s = JSON.stringify(words);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return words.length + ':' + h.toString(16);
}

/**
 * @template T
 * @param {T} v
 * @returns {T}
 */
function deepFreeze(v) {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}
