// Tools/Migrate/legacyFiles.mjs: which files are read from the toeic-drill word-data folder, and the unwrapping.
// Keep this file ASCII-only (UE-1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLegacyDays, unwrapLegacy } from '../../Tools/Migrate/legacyFiles.mjs';

test('unwrapLegacy strips the window.__addVocab wrapper and a leading BOM', () => {
  assert.equal(unwrapLegacy('window.__addVocab({"words":[]});\n'), '{"words":[]}');
  assert.equal(unwrapLegacy('  window.__addVocab({"a":1})'), '{"a":1}');
  assert.equal(unwrapLegacy(String.fromCharCode(0xfeff) + 'window.__addVocab({"a":1});'), '{"a":1}');
  // positive control: text without the wrapper is left as it is
  assert.equal(unwrapLegacy('{"a":1}'), '{"a":1}');
});

test('readLegacyDays reads only the daily files, in date order, with the date from the name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tango-legacy-'));
  try {
    writeFileSync(join(dir, 'VOCAB_2026-07-19.js'), 'window.__addVocab({"words":[{"en":"b"}]});\n');
    writeFileSync(join(dir, 'VOCAB_2026-07-18.js'), 'window.__addVocab({"words":[{"en":"a"}]});\n');
    writeFileSync(join(dir, '_all.js'), 'window.__addVocab({"words":[{"en":"a"}]});\n');
    writeFileSync(join(dir, 'VOCAB_2026-7-20.js'), 'x');
    const days = readLegacyDays(dir);
    assert.deepEqual(days.map((d) => [d.name, d.date, JSON.parse(d.text).words[0].en]), [
      ['VOCAB_2026-07-18.js', '2026-07-18', 'a'],
      ['VOCAB_2026-07-19.js', '2026-07-19', 'b'],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
