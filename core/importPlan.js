// 取り込みの確認表(INV-2)。ブラウザの API に触れない(INV-6)。
// 解析結果と既存の単語帳を突き合わせ、行ごとに何が起きるかを示す。保存に渡す語の一覧を返すのは
// applyImport だけで、applyImport は confirmPlan を通った確認表しか受け付けない。
// 規則は Docs/20_ImportFormat.md §4。

import { keyOf, normPos, JA_SEP } from './word.js';

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
 * - join: 同じ入力の先の行で足す語と、同じ綴りで品詞の有無だけが違う。同じ語かもしれないので、既定ではその行の語に当てる
 * - ambiguous: 品詞が無く、同じ綴りの語(単語帳の語、または入力の先の行で足す語)が複数あって当て先を決められない。既定では取り込まない
 * - duplicate: 同じ入力の中で先に出た語と重なる。取り込まない
 * - error / skipped: 読めなかった行・語ではない行。取り込まない
 * @typedef {object} PlanRow
 * @property {number} ref 解析結果の ref(簡易形式なら行番号)
 * @property {string} raw
 * @property {'add' | 'merge' | 'same' | 'join' | 'ambiguous' | 'duplicate' | 'error' | 'skipped'} action
 * @property {Word} [word] 入力の語
 * @property {string} [target] 当てる語の鍵(merge / same は既存の語、join は先の行で足す語)
 * @property {number} [targetRef] 当てる先の行の ref(join)
 * @property {string[]} [candidates] 当て先の候補の鍵(ambiguous)
 * @property {{ target: string, ref?: number, fills: string[], conflicts: Conflict[] }[]} [previews] 候補ごとに、当てたら変わること(ambiguous。ref は候補が入力の先の行のとき)
 * @property {string[]} [fills] 空欄を埋める項目(merge / join)
 * @property {Conflict[]} [conflicts] 値が食い違う項目(merge / join。join の current は先の行の値)
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
 * - 'skip': 取り込まない(add / merge / join)
 * - 'overwrite': 食い違う項目も入力の値で上書きする(食い違いのある merge)
 * - 'sense': 意味を別の意味として「；」で並べる。他の食い違う項目は単語帳の値を残す(意味が食い違う merge)
 * - 'extend': 意味を既存の意味に「、」で足す。他の食い違う項目は単語帳の値を残す(意味が食い違う merge)
 * - 'add': 新しい語として足す(ambiguous / join)
 * - { target }: この語に当てる(ambiguous。candidates のどれか)
 * @typedef {Record<number, 'skip' | 'overwrite' | 'sense' | 'extend' | 'add' | { target: string }>} Choices
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
 * @property {{ from: string, to: string }[]} rekeys 品詞が埋まって鍵が変わった既存の語(記録の付け替えに使う。同じ取り込みで足した語は addedKeys の側を書き換える)
 * @property {string[]} addedKeys 新しく足した語の鍵(追加日を付けるのに使う)
 * @property {number} added
 * @property {number} updated 中身が実際に変わった既存の語の数(食い違いを残しただけの行は数えない)
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
    counts: { add: 0, merge: 0, same: 0, join: 0, ambiguous: 0, duplicate: 0, error: 0, skipped: 0 },
    base: fingerprint(existing),
  };
  if (parsed.fatal !== undefined) return register({ ...plan, fatal: parsed.fatal });

  const byKey = new Map(existing.map((w) => [keyOf(w), w]));
  /** 入力の中で既に使った鍵(足す語の鍵・当てた既存の語の鍵) */
  const used = new Set();
  /** @type {Map<string, Pending>} 入力の先の行で足す語のうち、まだどの行も当てていないもの */
  const pending = new Map();
  for (const r of parsed.rows) {
    const base = { ref: r.ref, raw: r.raw, warnings: [...r.warnings] };
    /** @type {PlanRow} */
    let row;
    if (r.error !== undefined) row = { ...base, action: 'error', message: r.error };
    else if (r.skipped !== undefined || !r.word) row = { ...base, action: 'skipped', message: r.skipped ?? '' };
    else row = planWord(base, withOptions(r.word, opts), existing, byKey, used, pending);
    if (row.action === 'add' && row.word) pending.set(keyOf(row.word), { ref: row.ref, word: row.word });
    if (row.action === 'join' && row.target) pending.delete(row.target);
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

/** @typedef {{ ref: number, word: Word }} Pending 入力の先の行で足す語 */

/**
 * @param {{ ref: number, raw: string, warnings: string[] }} base
 * @param {Word} word
 * @param {Word[]} existing
 * @param {Map<string, Word>} byKey
 * @param {Set<string>} used
 * @param {Map<string, Pending>} pending
 * @returns {PlanRow}
 */
function planWord(base, word, existing, byKey, used, pending) {
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
    // 入力の先の行で足す語のうち、同じ綴りで品詞の有無だけが違うもの。同じ語かもしれない
    const near = [...pending.values()].filter((p) => p.word.en === word.en && !normPos(p.word) !== !normPos(word));
    if (near.length === 1) {
      const t = near[0];
      const tk = keyOf(t.word);
      used.add(keyOf(mergeWord(t.word, word, 'keep')));
      const warn = `${t.ref} 行目の ${t.word.en}(${normPos(t.word) || '品詞なし'})と品詞の有無だけが違います。同じ語かもしれないので、既定ではその行に当てます`;
      return { ...base, warnings: [...base.warnings, warn], action: 'join', word, target: tk, targetRef: t.ref, ...diff(t.word, word) };
    }
    if (near.length > 1) {
      const previews = near.map((p) => ({ target: keyOf(p.word), ref: p.ref, ...diff(p.word, word) }));
      const warn = `品詞のある同じ綴りの行(${near.map((p) => p.ref).join('・')} 行目)があります。同じ語かもしれないので、当てる行を選んでください`;
      return { ...base, warnings: [...base.warnings, warn], action: 'ambiguous', word, candidates: previews.map((p) => p.target), previews };
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
  used.add(keyOf(mergeWord(cur, word, 'keep')));
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
 * sense / extend は意味だけを既存の意味に足し、他の食い違いは既存の値を残す。
 * 品詞は括弧書きの違いしか食い違わない(鍵が同じ語にしか当てない)ので上書きしない。
 * @param {Word} cur
 * @param {Word} inc
 * @param {'keep' | 'overwrite' | 'sense' | 'extend'} mode
 * @returns {Word}
 */
function mergeWord(cur, inc, mode) {
  const overwrite = mode === 'overwrite';
  const out = cloneWord(cur);
  for (const f of FIELDS) {
    const v = inc[f];
    if (!v) continue;
    if (!out[f] || (overwrite && f !== 'pos')) out[f] = v;
    else if (f === 'ja' && (mode === 'sense' || mode === 'extend')) out.ja = joinJa(/** @type {string} */ (out.ja), v, mode === 'sense' ? '；' : '、');
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
 * 既存の意味に入力の意味を足す。入力の語義のうち既存の意味に同じ文字列のあるものは足さない
 * (「走る」に「走る、経営する」を「；」で足すと「走る；経営する」)。
 * @param {string} cur
 * @param {string} inc
 * @param {string} sep
 * @returns {string}
 */
function joinJa(cur, inc, sep) {
  const split = (/** @type {string} */ s) => s.split(JA_SEP).map((x) => x.trim()).filter(Boolean);
  const have = new Set(split(cur));
  const parts = split(inc);
  const fresh = parts.filter((p) => !have.has(p));
  if (!fresh.length) return cur;
  return cur + sep + (fresh.length === parts.length ? inc.trim() : fresh.join('、'));
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
      (c === 'skip' && (row.action === 'add' || row.action === 'merge' || row.action === 'join')) ||
      (c === 'overwrite' && row.action === 'merge' && !!row.conflicts?.length) ||
      ((c === 'sense' || c === 'extend') && row.action === 'merge' && !!row.conflicts?.some((x) => x.field === 'ja')) ||
      (c === 'add' && (row.action === 'ambiguous' || row.action === 'join')) ||
      (typeof c === 'object' && row.action === 'ambiguous' && !!row.candidates?.includes(c.target));
    if (!ok) throw new Error(`${refText} 番の行(${row.action})には ${JSON.stringify(c)} を選べません`);
  }
  // 1 つの語に当てる行は 1 つだけ(ambiguous で選んだ当て先が、他の行・join の既定の当て先と重ならないこと)
  /** @type {Map<string, number>} */
  const targets = new Map();
  for (const row of plan.rows) {
    const c = choices[row.ref];
    const t =
      (row.action === 'merge' || row.action === 'same') && c !== 'skip' ? row.target
        : row.action === 'join' && c === undefined ? row.target
          : row.action === 'ambiguous' && typeof c === 'object' ? c.target
            : undefined;
    if (t === undefined) continue;
    const prev = targets.get(t);
    if (prev !== undefined) throw new Error(`${row.ref} 番の行の当て先 ${t} は、${prev} 番の行の当て先と重なります`);
    targets.set(t, row.ref);
  }
  // 入力の先の行で足す語に当てるなら、その行は外せない
  for (const row of plan.rows) {
    if (row.action !== 'add' || !row.word || choices[row.ref] !== 'skip') continue;
    const by = targets.get(keyOf(row.word));
    if (by !== undefined) {
      throw new Error(`${by} 番の行は ${row.ref} 番の行の語に当てるので、${row.ref} 番の行は外せません(${by} 番の行も外すか、別の語として足してください)`);
    }
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
  /** @type {string[]} */
  const addedKeys = [];
  let added = 0;
  let updated = 0;
  for (const row of plan.rows) {
    const c = choices[row.ref];
    if (c === 'skip' || !row.word) continue;
    if (row.action === 'add' || ((row.action === 'ambiguous' || row.action === 'join') && c === 'add')) {
      // 防御: planImport の重複判定を通った確認表では起きない
      if (index.has(keyOf(row.word))) throw new Error(`${keyOf(row.word)} は既にあります(INV-4)`);
      index.set(keyOf(row.word), words.length);
      words.push(cloneWord(row.word));
      addedKeys.push(keyOf(row.word));
      added++;
      continue;
    }
    let target = row.target;
    if (row.action === 'ambiguous') target = typeof c === 'object' ? c.target : undefined;
    else if (row.action !== 'merge' && row.action !== 'join') continue;
    if (target === undefined) continue;
    const i = index.get(target);
    // 防御: confirmPlan を通った確認表では起きない(当て先の行を外していれば確定しない)
    if (i === undefined) throw new Error(`${row.ref} 番の行の当て先 ${target} がありません`);
    const merged = mergeWord(words[i], row.word, c === 'overwrite' || c === 'sense' || c === 'extend' ? c : 'keep');
    // 食い違いだけで上書きを選ばなかった行は何も変えない。更新の数に入れない
    if (sameWord(merged, words[i])) continue;
    const before = keyOf(words[i]);
    words[i] = merged;
    const after = keyOf(words[i]);
    // 同じ取り込みで足した語に当てたなら、足した語の中身が変わっただけ。鍵が変わっても付け替えず(記録は鍵に付くので、
    // 消した語の記録が残っていれば最後の鍵のものが付く)、更新にも数えない
    const fresh = addedKeys.indexOf(before);
    if (after !== before) {
      if (index.has(after)) throw new Error(`${before} の品詞を埋めると、既にある ${after} と重なります`);
      index.delete(before);
      index.set(after, i);
      if (fresh >= 0) addedKeys[fresh] = after;
      else rekeys.push({ from: before, to: after });
    }
    if (fresh < 0) updated++;
  }
  return { words, rekeys, addedKeys, added, updated };
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
 * 2 つの語の中身が同じか(項目の並び順は問わない)。
 * @param {Word} a
 * @param {Word} b
 * @returns {boolean}
 */
function sameWord(a, b) {
  const ra = /** @type {Record<string, unknown>} */ (a);
  const rb = /** @type {Record<string, unknown>} */ (b);
  const ka = Object.keys(ra);
  return ka.length === Object.keys(rb).length && ka.every((k) => JSON.stringify(ra[k]) === JSON.stringify(rb[k]));
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
