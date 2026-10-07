// アプリのバージョン。規則と履歴は Docs/53_Versions.md。
// 上げるときは package.json の "version" と Docs/53_Versions.md の先頭の行も同じ値にする
// (tests/core/version.test.js が 3 か所の一致を検査する)。

/** 今のバージョン(n.m.l。0 から始まる間は公開前の pre-release) */
export const VERSION = '0.22.1';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * n.m.l の形か。先頭ゼロの数(01 など)と、桁の足りない・多い形は認めない。
 * @param {string} text
 * @returns {boolean}
 */
export function isValidVersion(text) {
  return SEMVER.test(text);
}

/**
 * 公開前(major が 0)の pre-release か。
 * @param {string} text n.m.l
 * @returns {boolean}
 */
export function isPreRelease(text) {
  return isValidVersion(text) && text.startsWith('0.');
}
