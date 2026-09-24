// Behavior (node --test) + type (tsc) checks. Report: Temp/tango-drill_check.txt (UV-4).
// Exit code 1 if anything FAILs. Zero tests or zero checked files is a FAIL, not a PASS (UV-1).
// Keep this file ASCII-only (UE-1).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(root, 'Temp', 'tango-drill_check.txt');
const lines = [];
let fail = 0;

function run(cmd, args, shell = false) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}

// --- behavior ---
// Collect test files ourselves so the report can show what the runner was given.
const files = readdirSync(join(root, 'tests'), { recursive: true, encoding: 'utf8' })
  .map((f) => 'tests/' + f.split('\\').join('/'))
  .filter((f) => f.endsWith('.test.js'))
  .sort();
const t = run(process.execPath, ['--test', '--test-reporter=tap', ...files]);
const num = (k) => Number((t.out.match(new RegExp('^# ' + k + ' (\\d+)', 'm')) || [])[1] ?? -1);
const tests = num('tests'), pass = num('pass'), failed = num('fail');
if (t.code !== 0 || failed !== 0) {
  fail++; lines.push(`[FAIL] behavior: exit=${t.code} tests=${tests} pass=${pass} fail=${failed}`);
} else if (tests <= 0) {
  fail++; lines.push('[FAIL] behavior: 0 tests ran (runner did not see any test file)');
} else {
  lines.push(`[PASS] behavior: tests=${tests} pass=${pass} fail=${failed}`);
}
const notOk = t.out.split('\n').filter((l) => /^\s*not ok /.test(l));
for (const l of notOk) lines.push('    ' + l.trim());

// --- type ---
// tsconfig.json: core/ without the DOM lib (Docs/52_Pitfalls.md P-1). tsconfig.app.json: app/ with DOM.
const tscBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const ownAll = new Set();
for (const project of ['tsconfig.json', 'tsconfig.app.json']) {
  const listed = run(tscBin, ['-p', project, '--listFilesOnly'], process.platform === 'win32');
  const own = listed.out.split(/\r?\n/).map((s) => s.trim())
    .filter((s) => s && !/node_modules/.test(s) && /\.(js|mjs|ts)$/.test(s));
  for (const f of own) ownAll.add(f);
  const tc = run(tscBin, ['-p', project], process.platform === 'win32');
  if (listed.code !== 0 && own.length === 0) {
    fail++; lines.push(`[FAIL] type(${project}): tsc not runnable (run npm install)`);
    lines.push('    ' + listed.out.trim().split('\n').slice(0, 5).join('\n    '));
  } else if (own.length === 0) {
    fail++; lines.push(`[FAIL] type(${project}): tsc checked 0 project files`);
  } else if (tc.code !== 0) {
    fail++; lines.push(`[FAIL] type(${project}): tsc exit=${tc.code}, files=${own.length}`);
    for (const l of tc.out.trim().split('\n')) lines.push('    ' + l);
  } else {
    lines.push(`[PASS] type(${project}): tsc files=${own.length}`);
  }
}
const own = [...ownAll];

const out = [
  'tango-drill check report',
  `generated: ${new Date().toISOString()}`,
  `result: ${fail ? 'FAIL' : 'PASS'} (fail=${fail})`,
  '',
  ...lines,
  '',
  'test files given to the runner:',
  ...files.map((f) => '  ' + f),
  '',
  'type-checked files:',
  ...own.map((f) => '  ' + f.replace(/\\/g, '/').replace(root.replace(/\\/g, '/') + '/', '')),
  '',
];
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, out.join('\n'), 'utf8');
process.exit(fail ? 1 : 0);
