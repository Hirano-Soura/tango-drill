// T-8: make a tango-drill backup file from the toeic-drill word data (and, optionally, its records).
//
// Usage (from the repository root):
//   node Tools/Migrate/toeic_to_backup.mjs <word-data folder> [records.json] [--out <file>] [--expect-words <n>]
//
// Reads every VOCAB_YYYY-MM-DD.js in the folder (legacyFiles.mjs: the aggregate _all.js is skipped) and builds
// the book with core/migrate.js (Docs/22_Storage.md section 6): words through the legacy reader, the added date
// from the file name, records and stars moved to the new keys. records.json is what the snippet in that section
// saves from the old app ({ hist, self, weak }). Without it the book has no records.
// The output is a tango-drill-backup file; load it in the app (settings tab) to replace the book.
// The script then reads the written file back with parseBackup and checks it against the sources
// (missingAfterMigration): every word with its oldest date, every record and star. --expect-words makes a
// different word count a failure.
// Output: Temp/tango-drill_migrated_backup.json unless --out is given. Report: Temp/tango-drill_migrate.txt (UV-4).
// Exit code 1 on any problem. Keep this file ASCII-only (UE-1).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookFromLegacy, missingAfterMigration } from '../../core/migrate.js';
import { readLegacyDays } from './legacyFiles.mjs';
import { backupText, parseBackup } from '../../core/backup.js';
import { countBook, sessionsOf } from '../../core/book.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reportPath = join(root, 'Temp', 'tango-drill_migrate.txt');

const args = process.argv.slice(2);
/** @param {string} name */
function option(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
const outPath = resolve(option('--out') ?? join(root, 'Temp', 'tango-drill_migrated_backup.json'));
const expectWords = option('--expect-words');
const [src, recordsPath] = args;

const lines = [];
let fail = 0;

function finish() {
  mkdirSync(dirname(reportPath), { recursive: true });
  const head = ['tango-drill migration from toeic-drill', `generated: ${new Date().toISOString()}`,
    `result: ${fail ? 'FAIL' : 'PASS'} (fail=${fail})`, ''];
  writeFileSync(reportPath, [...head, ...lines, ''].join('\n'), 'utf8');
  process.exit(fail ? 1 : 0);
}

if (!src) {
  fail++;
  lines.push('[FAIL] usage: node Tools/Migrate/toeic_to_backup.mjs <word-data folder> [records.json] [--out <file>] [--expect-words <n>]');
  finish();
}

const days = readLegacyDays(src);
if (!days.length) { fail++; lines.push(`[FAIL] no VOCAB_*.js in ${src}`); finish(); }

let records = {};
if (recordsPath) {
  try {
    // trim() also drops a leading BOM (JSON.parse rejects it)
    records = JSON.parse(readFileSync(recordsPath, 'utf8').trim());
  } catch (e) {
    fail++; lines.push(`[FAIL] records: cannot read ${recordsPath}: ${e instanceof Error ? e.message : e}`);
    finish();
  }
}

const r = bookFromLegacy(days, records);
for (const p of r.problems) { fail++; lines.push(`[FAIL] ${p}`); }
if (!r.book) finish();

const exportedAt = new Date().toISOString();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, backupText(/** @type {any} */ (r.book), exportedAt), 'utf8');

// Check what the user will load: read the written file back, independently of the in-memory book.
const back = parseBackup(readFileSync(outPath, 'utf8'), { today: exportedAt.slice(0, 10) });
if (back.fatal !== undefined || !back.book) {
  fail++; lines.push(`[FAIL] the written file cannot be read back: ${back.fatal}`);
  finish();
}
const book = /** @type {import('../../core/book.js').Book} */ (back.book);
const missing = missingAfterMigration(book, r, records);
for (const m of missing) { fail++; lines.push(`[FAIL] missing: ${m}`); }
const c = countBook(book);
if (expectWords !== undefined && c.words !== Number(expectWords)) {
  fail++; lines.push(`[FAIL] words=${c.words}, expected ${expectWords}`);
}
if (!missing.length) {
  lines.push(`[PASS] every source item is in the book with its oldest date (items=${r.sources.length} words=${c.words})`);
  if (recordsPath) lines.push(`[PASS] every record and star moved (record keys=${Object.keys(/** @type {any} */ (records).hist ?? {}).length})`);
}
lines.push(
  '',
  `output: ${outPath}`,
  `records: ${recordsPath ?? '(none: the book has no records)'}`,
  `counts shown when restoring: words=${c.words} answers=${c.answers} recordedWords=${c.recordedWords} starred=${c.starred}`,
  '',
  `files read (${days.length}):`,
  ...sessionsOf(book).map((s) => `  ${s.date}: ${s.items.length} words`),
  '',
  `keys changed by the reader (${r.rekeys.length}):`,
  ...r.rekeys.map((k) => `  ${k.from} -> ${k.to}`),
  '',
  `warnings (${r.warnings.length + back.warnings.length}):`,
  ...[...r.warnings, ...back.warnings].map((w) => `  ${w}`),
);
finish();
