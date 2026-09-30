import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, isValidVersion, isPreRelease } from '../../core/version.js';

/** @param {string} p */
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('isValidVersion: n.m.l の 3 区域だけを認める(陽性対照つき)', () => {
  for (const ok of ['0.0.1', '0.16.2', '1.0.0', '10.20.30']) assert.equal(isValidVersion(ok), true, ok);
  for (const bad of ['1', '1.0', '1.0.0.0', '01.0.0', '1.0.0-pre', 'v1.0.0', '1.a.0', '', ' 1.0.0'])
    assert.equal(isValidVersion(bad), false, bad);
});

test('isPreRelease: major が 0 の間だけ pre-release', () => {
  assert.equal(isPreRelease('0.16.2'), true);
  assert.equal(isPreRelease('1.0.0'), false);
  assert.equal(isPreRelease('0.x.1'), false);
});

test('VERSION は n.m.l で、package.json と Docs/53_Versions.md の先頭の行に一致する', () => {
  assert.equal(isValidVersion(VERSION), true);
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
  assert.equal(JSON.parse(read('package-lock.json')).version, VERSION);
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].version, VERSION);
  const rows = read('Docs/53_Versions.md').split('\n').filter((l) => /^\| `\d+\.\d+\.\d+` \|/.test(l));
  assert.ok(rows.length > 0, '履歴の表に行が無い');
  assert.match(rows[0], new RegExp(`^\\| \`${VERSION.replaceAll('.', '\\.')}\` \\|`), '表の先頭が今のバージョンでない');
});

test('履歴の表: 版は新しい順に重複なく並ぶ', () => {
  const vs = read('Docs/53_Versions.md').split('\n')
    .map((l) => l.match(/^\| `(\d+)\.(\d+)\.(\d+)` \|/)).filter((m) => m !== null)
    .map((m) => m.slice(1).map(Number));
  for (let i = 1; i < vs.length; i++) {
    const [a, b] = [vs[i - 1], vs[i]];
    const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    assert.ok(newer > 0, `${a.join('.')} の次が ${b.join('.')}`);
  }
});
