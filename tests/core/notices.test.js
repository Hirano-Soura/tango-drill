// 通知タブのお知らせ(core/notices.js)。規則は Docs/25_Notices.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTICES, unreadImportant, unreadIds } from '../../core/notices.js';
import { VERSION, isValidVersion } from '../../core/version.js';

/**
 * n.m.l を比べる。a が b より前なら負。
 * @param {string} a
 * @param {string} b
 */
const cmp = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

test('お知らせは id が重ならず、日付と版の形が正しく、新しい順に並び、今の版より新しい版を名乗らない', () => {
  assert.ok(NOTICES.length > 0);
  assert.equal(new Set(NOTICES.map((n) => n.id)).size, NOTICES.length, 'id の重複');
  for (const n of NOTICES) {
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/, n.id);
    assert.ok(isValidVersion(n.version), `${n.id}: ${n.version}`);
    assert.ok(cmp(n.version, VERSION) <= 0, `${n.id} の版 ${n.version} が今の版 ${VERSION} より新しい`);
    assert.ok(n.title && n.body.length, n.id);
  }
  for (let i = 1; i < NOTICES.length; i++) {
    assert.ok(cmp(NOTICES[i - 1].version, NOTICES[i].version) >= 0 && NOTICES[i - 1].date >= NOTICES[i].date, `${NOTICES[i - 1].id} と ${NOTICES[i].id} の順`);
  }
});

test('自他の変更は重要なお知らせで、自他を補う操作を持つ(0.22.0)', () => {
  const n = NOTICES.find((x) => x.id === '2026-10-07-trans');
  assert.ok(n);
  assert.equal(n.important, true);
  assert.equal(n.action, 'trans');
  assert.equal(n.version, '0.22.0');
});

test('赤い点: 読んでいない重要なお知らせがあるときだけ。読めば消え、重要でないものは点を出さない', () => {
  const list = [
    { id: 'a', date: '2026-10-02', version: '0.2.0', title: 'A', important: true, body: ['a'] },
    { id: 'b', date: '2026-10-01', version: '0.1.0', title: 'B', important: false, body: ['b'] },
  ];
  assert.deepEqual(unreadImportant(list, []).map((n) => n.id), ['a']);
  assert.deepEqual(unreadImportant(list, ['a']), []);
  assert.deepEqual(unreadImportant(list, ['b']).map((n) => n.id), ['a'], '重要でないものを読んでも点は消えない');
  // 既読にするのは、重要でないものも含めたまだ読んでいないもの全部
  assert.deepEqual(unreadIds(list, []), ['a', 'b']);
  assert.deepEqual(unreadIds(list, ['a', 'b', '消したお知らせ']), []);
});
