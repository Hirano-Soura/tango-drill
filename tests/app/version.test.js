// アプリの版の形(CLAUDE.md §6)。版の上げ忘れは機械では見ない(実行完了時の報告で前後の版を述べる)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_VERSION } from '../../app/version.js';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

test('APP_VERSION は MAJOR.MINOR.PATCH の形', () => {
  assert.match(APP_VERSION, SEMVER);
});

test('陽性対照: 形の崩れた版を弾く', () => {
  for (const bad of ['0.2', 'v0.2.0', '0.02.0', '0.2.0-beta', '']) assert.doesNotMatch(bad, SEMVER);
});
