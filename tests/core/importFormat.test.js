import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImport, normalizePos, looksEnglish } from '../../core/importFormat.js';

/** @param {string} name */
const read = (name) => readFileSync(new URL('./fixtures/import/' + name, import.meta.url), 'utf8');

/** @param {import('../../core/importFormat.js').ParseResult} r */
const words = (r) => r.rows.flatMap((x) => (x.word ? [x.word] : []));
/** @param {import('../../core/importFormat.js').ParseResult} r */
const errors = (r) => r.rows.filter((x) => x.error !== undefined);
/** @param {import('../../core/importFormat.js').ParseResult} r */
const skipped = (r) => r.rows.filter((x) => x.skipped !== undefined);

// --- 見本 ----------------------------------------------------------------------

test('簡易形式: 見本を項目ごとに読む', () => {
  const r = parseImport(read('simple_v1.txt'));
  assert.equal(r.format, 'simple/v1');
  assert.deepEqual(words(r), [
    {
      en: 'allocate', pos: '動', ja: '割り当てる', ex: 'The manager allocated the budget to each team.',
      exJa: '部長は各チームに予算を割り当てた。', note: 'allocate A to B の形で使う',
    },
    { en: 'tentative', pos: '形', ja: '仮の', ex: 'We have a tentative schedule for the launch.', exJa: '発売の仮の予定がある。' },
    { en: 'reimburse', pos: '動', ja: '払い戻す' },
    { en: 'itinerary' },
    {
      en: 'on behalf of A', pos: '前置詞句', kind: 'phrase', ja: 'A を代表して',
      ex: 'I am writing on behalf of the sales team.', exJa: '営業チームを代表して書いています。',
    },
  ]);
  assert.deepEqual(errors(r), []);
  assert.deepEqual(r.rows.map((x) => x.ref), [1, 2, 3, 4, 5]);
});

test('JSON v1: 見本を項目ごとに読む', () => {
  const r = parseImport(read('tango-drill_v1.json'));
  assert.equal(r.format, 'tango-drill/v1');
  assert.deepEqual(words(r), [
    {
      en: 'allocate', pos: '動', trans: 'vt', ja: '割り当てる', ex: 'The manager allocated the budget to each team.',
      exJa: '部長は各チームに予算を割り当てた。', note: 'allocate A to B の形で使う', exSrc: 'ai', tags: ['第3週'],
    },
    { en: 'tentative', pos: '形', ja: '仮の' },
    { en: 'on behalf of A', pos: '前置詞句', kind: 'phrase', ja: 'A を代表して', tags: ['第3週', 'Part 5'] },
    { en: 'itinerary' },
  ]);
  assert.deepEqual(r.rows.flatMap((x) => x.warnings), []);
});

test('toeic-drill の単語データ: phrases は句表現になり、空の note は持たない', () => {
  const r = parseImport(read('toeic-drill.json'));
  assert.equal(r.format, 'toeic-drill');
  const w = words(r);
  assert.equal(w.length, 4);
  assert.equal(w[1].trans, 'vt');
  assert.equal(w[2].note, undefined);
  assert.deepEqual([w[3].en, w[3].kind], ['in possession of A', 'phrase']);
});

// --- AI の返答に似せた入力(寛容な解析) ------------------------------------------------

test('寛容な解析: 前置き・囲み・見出し行・番号・強調・全角の縦棒・タブ・英語の品詞名を読み飛ばす', () => {
  const r = parseImport(read('ai_like_list.txt'));
  assert.equal(r.format, 'simple/v1');
  assert.deepEqual(words(r).map((w) => [w.en, w.pos]), [
    ['allocate', '動'], ['reimburse', '動'], ['tentative', '形'], ['itinerary', undefined],
  ]);
  assert.equal(words(r)[0].note, 'allocate A to B');
  assert.deepEqual(errors(r), []);
  assert.equal(skipped(r).length, 3); // 前置き・見出し行・結びの文
});

test('寛容な解析: Markdown の表と英語の前置きを読む', () => {
  const r = parseImport(read('ai_like_table.txt'));
  assert.deepEqual(words(r).map((w) => w.en), ['allocate', 'reimburse']);
  assert.equal(words(r)[0].note, undefined);
  assert.deepEqual(errors(r), []);
  assert.deepEqual(skipped(r).map((x) => x.ref), [1, 3, 8]);
});

test('寛容な解析: 前置きつきの ```json の囲みを JSON として読む', () => {
  const r = parseImport(read('ai_like_json.txt'));
  assert.equal(r.format, 'tango-drill/v1');
  assert.deepEqual(words(r).map((w) => w.en), ['allocate', 'reimburse']);
});

test('区切りの無い行: 短い英語は見出し語、文に見えるものは読み飛ばす', () => {
  const r = parseImport('Here are the sentences.\nInc.\nset up\nWhat do you think\n');
  assert.deepEqual(words(r).map((w) => w.en), ['Inc.', 'set up', 'What do you think']);
  assert.deepEqual(skipped(r).map((x) => x.ref), [1]);
});

// --- 壊した見本(陽性対照: 読めないものを「読めない」と言えること。UV-1) -------------------

test('陽性対照: 構文の壊れた JSON は全体を拒否し、簡易形式として読み直さない', () => {
  const r = parseImport(read('broken/syntax.json'));
  assert.match(r.fatal ?? '', /JSON として読めません/);
  assert.deepEqual(r.rows, []);
});

test('陽性対照: 新しすぎる版・不明な形式・words が配列でない JSON を拒否する', () => {
  assert.match(parseImport(read('broken/future_version.json')).fatal ?? '', /新しいため読めません/);
  assert.match(parseImport(read('broken/unknown_format.json')).fatal ?? '', /不明な形式/);
  assert.match(parseImport(read('broken/words_not_array.json')).fatal ?? '', /words が配列ではありません/);
  assert.match(parseImport('{"format": 1, "words": []}').fatal ?? '', /format が文字列ではありません/);
  const arr = parseImport('[{"en": "allocate"}]');
  assert.equal(arr.format, 'simple/v1', '先頭が [ の入力は JSON として扱わない');
  assert.deepEqual(words(arr), []);
  assert.match(parseImport('{"date": "x"}').fatal ?? '', /words \/ phrases も無いため読めません/);
});

test('陽性対照: 空の入力を拒否する', () => {
  assert.match(parseImport('').fatal ?? '', /入力が空/);
  assert.match(parseImport(' \n\t\n').fatal ?? '', /入力が空/);
});

test('陽性対照: JSON の壊れた語だけを error にし、他の語は読む', () => {
  const r = parseImport(read('broken/bad_items.json'));
  assert.deepEqual(r.rows.map((x) => (x.word ? 'word' : x.error)), [
    'word',
    '見出し語(en)がありません',
    '見出し語が英語ではありません: 割り当てる',
    '語が { } ではありません',
    '見出し語が空です',
    'word',
  ]);
  const last = r.rows[5];
  assert.deepEqual(last.word, { en: 'reimburse' });
  assert.deepEqual(last.warnings, [
    '未知の項目 star を無視しました',
    'ja が文字列ではないため無視しました',
    'tags が文字列の配列ではないため無視しました',
    'trans の値 transitive は使えないため無視しました(vt / vi / vt/vi)',
    'kind の値 idiom は使えないため無視しました(phrase のみ)',
    'exSrc の値 book は使えないため無視しました(self / ai / set)',
  ]);
});

test('陽性対照: 簡易形式の壊れた行だけを error にし、他の行は読む', () => {
  const r = parseImport(read('broken/bad_lines.txt'));
  assert.deepEqual(r.rows.map((x) => (x.word ? 'word' : x.error)), [
    'word',
    '見出し語が英語ではありません: 割り当てる',
    '見出し語が空です',
    '項目が多すぎます(7 個。6 個まで)',
  ]);
});

// --- 項目の正規化 ------------------------------------------------------------------

test('normalizePos: 別名を略号に揃え、句と括弧書きは残す', () => {
  assert.equal(normalizePos('noun'), '名');
  assert.equal(normalizePos('v.'), '動');
  assert.equal(normalizePos('名詞/動詞'), '名/動');
  assert.equal(normalizePos('Adj・adv'), '形・副');
  assert.equal(normalizePos('動詞句'), '動詞句');
  assert.equal(normalizePos('動(自)'), '動(自)');
});

test('looksEnglish: 英字を含み、日本語を含まない', () => {
  assert.equal(looksEnglish('in possession of A'), true);
  assert.equal(looksEnglish('cutting-edge'), true);
  assert.equal(looksEnglish('割り当てる'), false);
  assert.equal(looksEnglish('allocate(割り当てる)'), false);
  assert.equal(looksEnglish('123'), false);
  assert.equal(looksEnglish(''), false);
});

// --- 仕様書 §2 / §3 の細則 ----------------------------------------------------------

test('区切りの無い行の境目: 6 語までは見出し語、7 語は前置きの文(仮の上限)', () => {
  const r = parseImport('a b c d e f\na b c d e f g');
  assert.deepEqual(words(r).map((w) => w.en), ['a b c d e f']);
  assert.deepEqual(skipped(r).map((x) => x.ref), [2]);
});

test('区切りの無い行の境目: : ! ? はどれか 1 つで前置き。. で終わるのは 2 語まで見出し語、3 語から前置き', () => {
  const r = parseImport('Note:\nWow!\nReady?\nCo. Ltd.\nThat is all.');
  assert.deepEqual(words(r).map((w) => w.en), ['Co. Ltd.']);
  assert.deepEqual(skipped(r).map((x) => x.ref), [1, 2, 3, 5]);
});

test('行頭の記号・番号と、項目を囲む強調・コード記号を落とす', () => {
  const r = parseImport('* aa\n・bb\n•cc\n1) dd\n(2) ee\n③ ff\n__gg__ | 名\n`hh` | 名');
  assert.deepEqual(words(r).map((w) => w.en), ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh']);
});

test('縦棒とタブがどちらもある行は縦棒で区切り、先頭に縦棒の無い行の末尾の縦棒は落とす', () => {
  const r = parseImport('set up | 動詞句\t| 設置する\nreimburse | 動 | 払い戻す | We will. | します。 | 補足 |');
  assert.deepEqual(words(r).map((w) => [w.en, w.pos, w.ja]), [['set up', '動詞句', '設置する'], ['reimburse', '動', '払い戻す']]);
  assert.deepEqual(errors(r), []);
});

test('見出し行: 項目名が並んでいても、2 つ目が品詞や空の行は本物の語として読む', () => {
  const r = parseImport('word | 品詞 | 意味\nmeaning | 名 | 意味\nword | | 単語\nmeaning | noun | 意味\nword | 代名詞 | 単語');
  assert.deepEqual(skipped(r).map((x) => x.skipped), ['見出し行']);
  assert.deepEqual(words(r).map((w) => [w.en, w.pos]), [['meaning', '名'], ['word', undefined], ['meaning', '名'], ['word', '代']]);
});

test('コードブロック: ~~~ の囲み・言語名の無い JSON の囲み・2 つ目の json の囲みを読む', () => {
  assert.deepEqual(words(parseImport('~~~\nallocate | 動\n~~~')).map((w) => w.en), ['allocate']);
  const bare = parseImport('こちらです。\n```\n{"format": "tango-drill/v1", "words": [{"en": "allocate"}]}\n```');
  assert.equal(bare.format, 'tango-drill/v1');
  const second = parseImport('例:\n```text\nallocate | 動\n```\nJSON:\n```json\n{"format": "tango-drill/v1", "words": [{"en": "tentative"}]}\n```');
  assert.deepEqual(words(second).map((w) => w.en), ['tentative']);
});

test('JSON の項目: タグの空白と重複を落とし、見出し語の連続する空白を 1 つにし、null は無いのと同じ', () => {
  const r = parseImport(JSON.stringify({
    format: 'tango-drill/v1',
    words: [{ en: '  in   charge  of  A ', tags: [' 第3週 ', '第3週', ''], ja: null, note: null }, { en: 'x y', tags: null }],
  }));
  assert.deepEqual(words(r), [{ en: 'in charge of A', tags: ['第3週'] }, { en: 'x y' }]);
  assert.deepEqual(r.rows.flatMap((x) => x.warnings), []);
});

test('JSON の最上位: 未知の項目に警告を出す', () => {
  const v1 = parseImport('{"format": "tango-drill/v1", "name": "第3週", "words": [{"en": "allocate"}]}');
  assert.deepEqual(v1.warnings, ['未知の項目 name を無視しました']);
  const legacy = parseImport('{"date": "x", "extra": 1, "words": [{"en": "allocate"}]}');
  assert.deepEqual(legacy.warnings, ['未知の項目 extra を無視しました']);
});

test('INV-3: 空の単語帳を書き出したファイルも読める(語 0 件は拒否せず警告)', () => {
  for (const text of ['{"format": "tango-drill/v1", "words": []}', '{"words": [], "phrases": []}']) {
    const r = parseImport(text);
    assert.equal(r.fatal, undefined, text);
    assert.deepEqual([r.rows, r.warnings], [[], ['語が 1 つもありません']]);
  }
});

test('句表現: phrases の語は品詞に「句」が無くても句になり、使えない kind は捨てたうえで品詞から補う', () => {
  const legacy = parseImport(JSON.stringify({
    phrases: [{ en: 'take over', pos: '動' }, { en: 'set up', kind: '' }, { en: 'carry out', kind: 'idiom' }],
  }));
  assert.deepEqual(words(legacy).map((w) => w.kind), ['phrase', 'phrase', 'phrase']);
  const v1 = parseImport(JSON.stringify({ format: 'tango-drill/v1', words: [{ en: 'set up', pos: '動詞句', kind: 'idiom' }] }));
  assert.equal(words(v1)[0].kind, 'phrase');
  assert.equal(v1.rows[0].warnings.length, 1);
});

test('例文の無い和訳は捨てる(和訳は例文に付いて動く)', () => {
  const r = parseImport(JSON.stringify({ format: 'tango-drill/v1', words: [{ en: 'allocate', exJa: '訳だけ' }] }));
  assert.deepEqual(words(r), [{ en: 'allocate' }]);
  assert.deepEqual(r.rows[0].warnings, ['例文の無い和訳(exJa)は無視しました']);
});

test('trans の表記ゆれ vi/vt を vt/vi に揃え、例文の無い語の exSrc は捨てる', () => {
  const r = parseImport(JSON.stringify({
    format: 'tango-drill/v1',
    words: [{ en: 'operate', trans: 'VI/VT', exSrc: 'ai' }],
  }));
  assert.deepEqual(words(r), [{ en: 'operate', trans: 'vt/vi' }]);
  assert.deepEqual(r.rows[0].warnings, ['例文の無い出どころ(exSrc)は無視しました']);
});
