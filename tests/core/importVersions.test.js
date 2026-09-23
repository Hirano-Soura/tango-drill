// INV-3: 取り込み形式は版を持ち、過去の版をすべて読める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImport, READABLE_FORMATS, CURRENT_JSON_FORMAT } from '../../core/importFormat.js';

/**
 * 一度でも読めるようにした版と、その見本。**行を消さない。** 版を足す手順は Docs/20_ImportFormat.md §1。
 * @type {Record<string, string>}
 */
const EVER_READABLE = {
  'simple/v1': 'simple_v1.txt',
  'toeic-drill': 'toeic-drill.json',
  'tango-drill/v1': 'tango-drill_v1.json',
};

/** @param {string} name */
const read = (name) => readFileSync(new URL('./fixtures/import/' + name, import.meta.url), 'utf8');

test('INV-3: 過去に読めた版は、今も読める版の一覧に残っている', () => {
  for (const f of Object.keys(EVER_READABLE)) assert.ok(READABLE_FORMATS.includes(f), `${f} が読めなくなっている`);
});

test('INV-3: 読める版にはすべて見本がある', () => {
  for (const f of READABLE_FORMATS) assert.ok(f in EVER_READABLE, `${f} の見本が EVER_READABLE に無い`);
  assert.ok(READABLE_FORMATS.includes(CURRENT_JSON_FORMAT), '書き出しに使う版が読めない');
});

for (const [format, file] of Object.entries(EVER_READABLE)) {
  test(`INV-3: ${format} の見本(${file})を、その版として 1 語も落とさず読める`, () => {
    for (const eol of ['\n', '\r\n']) {
      const r = parseImport(read(file).replace(/\r?\n/g, eol));
      assert.equal(r.fatal, undefined, String(r.fatal));
      assert.equal(r.format, format);
      assert.ok(r.rows.length > 0, '見本が空で、何も確かめていない');
      for (const row of r.rows) assert.ok(row.word, `${file} の ${row.ref} 番が読めない: ${row.error ?? row.skipped}`);
    }
  });
}

test('INV-3 陽性対照: 見本の版を読めない版に書き換えると、読めないと報告される', () => {
  const r = parseImport(read('tango-drill_v1.json').replace('"tango-drill/v1"', '"tango-drill/v2"'));
  assert.match(r.fatal ?? '', /新しいため読めません/);
});
