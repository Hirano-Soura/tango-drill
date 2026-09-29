// Read the toeic-drill word-data folder: one VOCAB_YYYY-MM-DD.js per day, each wrapped in window.__addVocab( ... ).
// Shared by the T-8 migration (toeic_to_backup.mjs) and the built-in vocabulary generator (Tools/Builtin).
// The aggregate _all.js is skipped: it repeats the daily files. core/ never sees the wrapper (INV-6), only the JSON.
// Keep this file ASCII-only (UE-1).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A daily word-data file; group 1 is the date. */
export const VOCAB_FILE = /^VOCAB_(\d{4}-\d{2}-\d{2})\.js$/;

/**
 * Strip the window.__addVocab( ... ) wrapper. A leading BOM is whitespace for \s, so it goes too.
 * @param {string} text
 * @returns {string}
 */
export function unwrapLegacy(text) {
  return String(text).replace(/^\s*window\.__addVocab\(/, '').replace(/\)\s*;?\s*$/, '');
}

/**
 * Every daily file in the folder, sorted by name (= by date), with the wrapper removed.
 * @param {string} folder
 * @returns {{ name: string, date: string, text: string }[]}
 */
export function readLegacyDays(folder) {
  return readdirSync(folder)
    .filter((f) => VOCAB_FILE.test(f))
    .sort()
    .map((name) => ({
      name,
      date: /** @type {RegExpExecArray} */ (VOCAB_FILE.exec(name))[1],
      text: unwrapLegacy(readFileSync(join(folder, name), 'utf8')),
    }));
}
