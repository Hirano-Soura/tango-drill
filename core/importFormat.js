// 取り込み形式(簡易形式・JSON)の解析と検証。ブラウザの API に触れない(INV-6)。
// 仕様は Docs/20_ImportFormat.md。版を足す・変えるときの手順は同 §1(INV-3)。

/** @typedef {import('./word.js').Word} Word */

/**
 * 1 行(簡易形式)または 1 項目(JSON)の解析結果。
 * word / error / skipped のうちちょうど 1 つを持つ。
 * @typedef {object} ParsedRow
 * @property {number} ref 簡易形式なら行番号、JSON なら語の通し番号(どちらも 1 始まり)
 * @property {string} raw 元の行(JSON なら項目を JSON に戻したもの)
 * @property {Word} [word] 読めた語
 * @property {string} [error] 語として読もうとしたが読めなかった理由
 * @property {string} [skipped] 語ではないと判断した理由(前置きの文・見出し行など)
 * @property {string[]} warnings 取り込みはするが知らせること
 */

/**
 * 入力全体の解析結果。fatal があれば rows は空。
 * @typedef {object} ParseResult
 * @property {string} format 読んだ版(SIMPLE_FORMAT / LEGACY_FORMAT / JSON の format 欄)
 * @property {ParsedRow[]} rows
 * @property {string[]} warnings 入力全体に関する注意
 * @property {string} [fatal] 入力全体が読めなかった理由
 */

/** 簡易形式の版。見出し行を持たないので、列の並びを変えるときは別の版として見分けられる形にする */
export const SIMPLE_FORMAT = 'simple/v1';
/** format 欄を持たない JSON。toeic-drill の単語データ(words / phrases)の形 */
export const LEGACY_FORMAT = 'toeic-drill';
/** 書き出すときに使う JSON の版 */
export const CURRENT_JSON_FORMAT = 'tango-drill/v1';

/** JSON の版ごとの読み手。過去の版の読み手を消さない(INV-3) */
const JSON_READERS = /** @type {Record<string, (data: Record<string, unknown>) => ParseResult>} */ ({
  'tango-drill/v1': readV1,
});

/** 読める版のすべて(INV-3 のテストがこの一覧と見本を突き合わせる) */
export const READABLE_FORMATS = Object.freeze([SIMPLE_FORMAT, LEGACY_FORMAT, ...Object.keys(JSON_READERS)]);

/** 語が持ってよい項目 */
const WORD_KEYS = ['en', 'pos', 'trans', 'ja', 'ex', 'exJa', 'note', 'kind', 'tags', 'exSrc'];
/** 文字列で持つ項目(en を除く) */
const TEXT_KEYS = /** @type {const} */ (['pos', 'trans', 'ja', 'ex', 'exJa', 'note', 'kind', 'exSrc']);
const TRANS = ['vt', 'vi', 'vt/vi'];
const EX_SRC = ['self', 'ai', 'set'];

/** かな・漢字・全角記号 */
const JAPANESE = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;
/** 簡易形式の区切り(半角・全角の縦棒) */
const BAR = /[|｜]/;
/** 行頭の箇条書き記号・番号 */
const BULLET = /^(?:[-*+]\s+|[・•●◦▪]\s*|\d{1,3}\s*[.)．、]\s*|[(（]\d{1,3}[)）]\s*|[①-⑳]\s*)/;
/** Markdown の表の区切り行 */
const TABLE_RULE = /^[|｜]?\s*:?-{2,}:?\s*([|｜]\s*:?-{2,}:?\s*)*[|｜]?$/;
/** 区切りの無い行を見出し語とみなす語数の上限(仮) */
const MAX_BARE_WORDS = 6;
/** 見出し行の項目名。2 つ以上が並んだ行を見出し行として読み飛ばす */
const HEADER_LABELS = new Set([
  '見出し語', '英単語', '単語', '品詞', '日本語の意味', '意味', '訳', '英語の例文', '例文',
  '例文の和訳', '和訳', '補足', '備考', 'headword', 'word', 'pos', 'part of speech', 'meaning',
  'japanese', 'example', 'translation', 'note', 'en', 'ja', 'ex', 'exja',
]);
/** 品詞として読める値(1 字の略号か「〜句」を区切りで並べたもの) */
const POS_LIKE = /^(?:[名動形副前接代間冠助]|\S*句)(?:[\/・,、](?:[名動形副前接代間冠助]|\S*句))*$/;
/** 品詞の別名。区切り(/ ・ , 、)の間の 1 つずつを置き換える */
const POS_ALIASES = /** @type {Record<string, string>} */ ({
  noun: '名', n: '名', '名詞': '名',
  verb: '動', v: '動', '動詞': '動',
  adjective: '形', adj: '形', '形容詞': '形',
  adverb: '副', adv: '副', '副詞': '副',
  preposition: '前', prep: '前', '前置詞': '前',
  conjunction: '接', conj: '接', '接続詞': '接',
  pronoun: '代', pron: '代', '代名詞': '代',
  interjection: '間', '間投詞': '間',
  phrase: '句',
});

/**
 * 貼り付けられた文字列・読み込んだファイルの中身を解析する。保存はしない(INV-2)。
 * 先頭が波括弧の入力と、json の囲み(コードブロック)を含む入力は JSON としてその版の読み手で読む。
 * それ以外は簡易形式として読む。
 * @param {string} text
 * @returns {ParseResult}
 */
export function parseImport(text) {
  const src = String(text ?? '').replace(/^\ufeff/, '');
  if (!src.trim()) return fatal(SIMPLE_FORMAT, '入力が空です');
  const json = extractJson(src);
  return json === null ? parseSimple(src) : parseJson(json);
}

/**
 * 入力から JSON 部分を取り出す。JSON でなければ null。
 * @param {string} src
 * @returns {string | null}
 */
function extractJson(src) {
  const t = src.trim();
  if (t.startsWith('{')) return t;
  // コードブロックのうち、言語名が json か、中身が波括弧で始まる最初のもの
  for (const m of src.matchAll(/^[ \t]*(```|~~~)[ \t]*(\w*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*\r?$/gm)) {
    if (m[2].toLowerCase() === 'json' || m[3].trim().startsWith('{')) return m[3].trim();
  }
  return null;
}

// --- JSON ----------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {ParseResult}
 */
function parseJson(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return fatal('json', 'JSON として読めません: ' + (e instanceof Error ? e.message : String(e)));
  }
  if (!isObject(data)) return fatal('json', 'JSON の最上位が { } ではありません');
  if (!('format' in data)) return readLegacy(data);
  const fmt = data.format;
  if (typeof fmt !== 'string') return fatal('json', 'format が文字列ではありません');
  const reader = JSON_READERS[fmt];
  if (reader) return reader(data);
  const m = /^tango-drill\/v(\d+)$/.exec(fmt);
  const newest = Math.max(...Object.keys(JSON_READERS).map((k) => Number(k.split('/v')[1])));
  if (m && Number(m[1]) > newest) {
    return fatal(fmt, `この版(${fmt})はこのアプリより新しいため読めません。アプリを更新してください`);
  }
  return fatal(fmt, `不明な形式です: ${fmt}`);
}

/**
 * tango-drill/v1: { "format": "tango-drill/v1", "words": [ 語, ... ] }
 * @param {Record<string, unknown>} data
 * @returns {ParseResult}
 */
function readV1(data) {
  const format = 'tango-drill/v1';
  if (!Array.isArray(data.words)) return fatal(format, 'words が配列ではありません');
  // 空の単語帳を書き出したファイルも読めるよう、語 0 件は拒否せず警告にとどめる(INV-3)
  const warnings = unknownKeys(data, ['format', 'words']);
  if (data.words.length === 0) warnings.push('語が 1 つもありません');
  return { format, rows: data.words.map((item, i) => readItem(item, i + 1)), warnings };
}

/**
 * toeic-drill の単語データ: { "words": [...], "phrases": [...] }(format 欄なし)。
 * phrases の語は kind を "phrase" にする。date / level / theme は使わない。
 * @param {Record<string, unknown>} data
 * @returns {ParseResult}
 */
function readLegacy(data) {
  const format = LEGACY_FORMAT;
  const words = data.words === undefined ? [] : data.words;
  const phrases = data.phrases === undefined ? [] : data.phrases;
  if (!Array.isArray(words) || !Array.isArray(phrases)) {
    return fatal(format, 'words / phrases が配列ではありません');
  }
  if (data.words === undefined && data.phrases === undefined) {
    return fatal(format, 'format 欄が無く、words / phrases も無いため読めません');
  }
  const rows = words.map((item, i) => readItem(item, i + 1));
  phrases.forEach((item, i) => {
    rows.push(readItem(isObject(item) ? { ...item, kind: 'phrase' } : item, words.length + i + 1));
  });
  const warnings = unknownKeys(data, ['words', 'phrases', 'date', 'level', 'theme']);
  if (rows.length === 0) warnings.push('語が 1 つもありません');
  return { format, rows, warnings };
}

/**
 * @param {Record<string, unknown>} data
 * @param {string[]} known
 * @returns {string[]}
 */
function unknownKeys(data, known) {
  return Object.keys(data)
    .filter((k) => !known.includes(k))
    .map((k) => `未知の項目 ${k} を無視しました`);
}

/**
 * JSON の 1 項目を語として読む。
 * @param {unknown} item
 * @param {number} ref
 * @returns {ParsedRow}
 */
function readItem(item, ref) {
  const raw = JSON.stringify(item) ?? String(item);
  if (!isObject(item)) return { ref, raw, error: '語が { } ではありません', warnings: [] };
  const warnings = unknownKeys(item, WORD_KEYS);
  if (typeof item.en !== 'string') return { ref, raw, error: '見出し語(en)がありません', warnings };
  /** @type {Record<string, string>} */
  const fields = { en: item.en };
  for (const k of TEXT_KEYS) {
    const v = item[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') fields[k] = v;
    else warnings.push(`${k} が文字列ではないため無視しました`);
  }
  /** @type {string[] | undefined} */
  let tags;
  if (Array.isArray(item.tags) && item.tags.every((t) => typeof t === 'string')) tags = item.tags;
  else if (item.tags !== undefined && item.tags !== null) warnings.push('tags が文字列の配列ではないため無視しました');
  return buildRow(fields, tags, ref, raw, warnings);
}

// --- 簡易形式 --------------------------------------------------------------------

/**
 * 1 行 1 語。項目は「見出し語 | 品詞 | 意味 | 例文 | 例文の和訳 | 補足」。後ろの項目は省略できる。
 * @param {string} src
 * @returns {ParseResult}
 */
function parseSimple(src) {
  /** @type {ParsedRow[]} */
  const rows = [];
  src.split(/\r\n|\r|\n/).forEach((line, i) => {
    const t = line.trim();
    // 空行・コードブロックの囲み・表の区切り行は、行として数えない
    if (!t || /^(```|~~~)/.test(t) || TABLE_RULE.test(t)) return;
    rows.push(readLine(t, i + 1));
  });
  return { format: SIMPLE_FORMAT, rows, warnings: [] };
}

/**
 * @param {string} line 前後の空白を落とした 1 行
 * @param {number} ref
 * @returns {ParsedRow}
 */
function readLine(line, ref) {
  const raw = line;
  // 先頭と末尾の縦棒(Markdown の表の行)は項目を持たないので落とす
  let body = line.replace(/^[|｜]/, '').replace(/\s*[|｜]\s*$/, '');
  body = body.replace(BULLET, '');
  const sep = BAR.test(body) ? /\s*[|｜]\s*/ : body.includes('\t') ? /\s*\t\s*/ : null;
  const cells = (sep ? body.split(sep) : [body]).map(stripMarkup);

  if (isHeader(cells)) return { ref, raw, skipped: '見出し行', warnings: [] };
  const en = cells[0];
  if (!sep) {
    // 区切りの無い行は「見出し語だけの行」か「前置きの文」のどちらか
    if (!looksEnglish(en)) return { ref, raw, skipped: '英語の見出し語ではありません(前置きの文など)', warnings: [] };
    const n = collapse(en).split(' ').length;
    if (/[:!?]/.test(en) || (/\.$/.test(en) && n > 2) || n > MAX_BARE_WORDS) {
      return { ref, raw, skipped: '文のように見えます(前置きの文など)', warnings: [] };
    }
  }
  if (cells.length > 6) return { ref, raw, error: `項目が多すぎます(${cells.length} 個。6 個まで)`, warnings: [] };
  const [, pos, ja, ex, exJa, note] = cells;
  /** @type {Record<string, string>} */
  const fields = { en };
  for (const [k, v] of /** @type {const} */ ([['pos', pos], ['ja', ja], ['ex', ex], ['exJa', exJa], ['note', note]])) {
    if (v) fields[k] = v;
  }
  return buildRow(fields, undefined, ref, raw, []);
}

/**
 * 項目を囲む Markdown の強調・コード記号を落とす。
 * @param {string} s
 * @returns {string}
 */
function stripMarkup(s) {
  let t = s.trim();
  for (const m of ['**', '__', '`']) {
    if (t.length > 2 * m.length && t.startsWith(m) && t.endsWith(m)) t = t.slice(m.length, -m.length).trim();
  }
  return t;
}

/**
 * 見出し行か。項目名が 2 つ以上並び、2 つ目の項目が空でも品詞(POS_LIKE)でもない行
 * (`meaning | 名 | 意味` のような本物の語を見出し行と取り違えないため)。
 * @param {string[]} cells
 * @returns {boolean}
 */
function isHeader(cells) {
  /** @param {string} s */
  const key = (s) => s.replace(/[（(][^）)]*[）)]/g, '').trim().toLowerCase();
  const labels = cells.filter((c) => HEADER_LABELS.has(key(c))).length;
  const second = key(cells[1] ?? '');
  return labels >= 2 && second !== '' && !POS_LIKE.test(normalizePos(second));
}

// --- 共通 ----------------------------------------------------------------------

/**
 * 読み出した項目を検証して 1 語にする。見出し語の不備だけを error にし、
 * 他の項目の不備はその項目を捨てて warnings に残す(1 項目のために語ごと落とさない)。
 * @param {Record<string, string>} fields
 * @param {string[] | undefined} tags
 * @param {number} ref
 * @param {string} raw
 * @param {string[]} warnings
 * @returns {ParsedRow}
 */
function buildRow(fields, tags, ref, raw, warnings) {
  const en = collapse(fields.en);
  if (!en) return { ref, raw, error: '見出し語が空です', warnings };
  if (!looksEnglish(en)) return { ref, raw, error: `見出し語が英語ではありません: ${en}`, warnings };

  /** @param {string} k */
  const pick = (k) => (fields[k] === undefined ? '' : fields[k].trim());

  /** @type {Word} */
  const word = { en };
  const pos = pick('pos');
  if (pos) word.pos = normalizePos(pos);
  for (const k of /** @type {const} */ (['ja', 'ex', 'exJa', 'note'])) {
    const v = pick(k);
    if (v) word[k] = v;
  }
  const trans = pick('trans');
  if (trans) {
    const t = trans.toLowerCase().replace(/\s/g, '');
    const v = t === 'vi/vt' ? 'vt/vi' : t;
    if (TRANS.includes(v)) word.trans = v;
    else warnings.push(`trans の値 ${trans} は使えないため無視しました(vt / vi / vt/vi)`);
  }
  if (word.exJa && !word.ex) {
    warnings.push('例文の無い和訳(exJa)は無視しました');
    delete word.exJa;
  }
  const kind = pick('kind');
  if (kind && kind !== 'phrase') warnings.push(`kind の値 ${kind} は使えないため無視しました(phrase のみ)`);
  if (kind === 'phrase' || (word.pos && word.pos.includes('句'))) word.kind = 'phrase';
  const exSrc = pick('exSrc');
  if (exSrc && isExSrc(exSrc)) {
    if (word.ex) word.exSrc = exSrc;
    else warnings.push('例文の無い出どころ(exSrc)は無視しました');
  } else if (exSrc) {
    warnings.push(`exSrc の値 ${exSrc} は使えないため無視しました(self / ai / set)`);
  }
  const cleanTags = [...new Set((tags || []).map((t) => t.trim()).filter(Boolean))];
  if (cleanTags.length) word.tags = cleanTags;
  return { ref, raw, word, warnings };
}

/**
 * 品詞の別名(noun / 名詞 など)を 1 字の略号に揃える。句(動詞句など)や括弧書きはそのまま残す。
 * @param {string} pos
 * @returns {string}
 */
export function normalizePos(pos) {
  return pos.replace(/[^\/・,、]+/g, (tok) => {
    const k = tok.trim().toLowerCase().replace(/\.$/, '');
    return POS_ALIASES[k] ?? tok.trim();
  });
}

/**
 * @param {string} v
 * @returns {v is 'self' | 'ai' | 'set'}
 */
function isExSrc(v) {
  return EX_SRC.includes(v);
}

/**
 * 英語の見出し語として読めるか(英字を含み、かな・漢字・全角文字を含まない)。
 * @param {string | undefined} s
 * @returns {boolean}
 */
export function looksEnglish(s) {
  return !!s && /[A-Za-z]/.test(s) && !JAPANESE.test(s);
}

/**
 * @param {string} s
 * @returns {string}
 */
function collapse(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {string} format
 * @param {string} message
 * @returns {ParseResult}
 */
function fatal(format, message) {
  return { format, rows: [], warnings: [], fatal: message };
}
