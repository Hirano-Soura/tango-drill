// 読み上げの規則(core/speech.js。Docs/24_Speech.md)。INV-1: インターネット経由の音声を選ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { englishVoices, pickVoice, remoteEnglishCount, speechText, normLang, isEnglish, RATES, DEFAULT_RATE } from '../../core/speech.js';

/** @typedef {import('../../core/speech.js').VoiceLike} VoiceLike */

/**
 * @param {string} name
 * @param {string} lang
 * @param {boolean} localService
 * @returns {VoiceLike}
 */
const v = (name, lang, localService) => ({ name, lang, localService, voiceURI: `uri:${name}` });

// 実際の一覧に近い並び(Windows の Edge・Chrome: 端末内の Microsoft の音声と、インターネット経由の音声が混ざる)
const WINDOWS_EDGE = [
  v('Microsoft Haruka - Japanese (Japan)', 'ja-JP', true),
  v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
  v('Microsoft Zira - English (United States)', 'en-US', true),
  v('Microsoft David - English (United States)', 'en-US', true),
  v('Google US English', 'en-US', false),
  v('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false),
];

test('INV-1: 使ってよい音声は端末内の英語の音声だけ。インターネット経由の音声と英語以外は入らない', () => {
  assert.deepEqual(englishVoices(WINDOWS_EDGE).map((x) => x.name), [
    'Microsoft Zira - English (United States)',
    'Microsoft David - English (United States)',
  ]);
  assert.equal(remoteEnglishCount(WINDOWS_EDGE), 3);
});

test('INV-1 の陽性対照: 先頭にあり名前に Natural を含む音声でも、インターネット経由なら選ばない', () => {
  // localService を見ない選び方なら、並びの先頭かつ高品質の名前の Aria が選ばれてしまう
  const picked = pickVoice(WINDOWS_EDGE);
  assert.equal(picked?.name, 'Microsoft Zira - English (United States)');
  // 設定でインターネット経由の音声を選んであっても(古い設定・手で書き換えた値)、それは使わない
  assert.equal(pickVoice(WINDOWS_EDGE, 'uri:Google US English')?.name, 'Microsoft Zira - English (United States)');
  // インターネット経由の音声しか無ければ、読まない(null)。言語だけを指定して読ませることもしない
  assert.equal(pickVoice(WINDOWS_EDGE.filter((x) => !x.localService)), null);
  // localService が欠けている(true と言っていない)ものも使わない
  assert.equal(pickVoice([{ name: 'x', lang: 'en-US', voiceURI: 'x', localService: /** @type {any} */ (undefined) }]), null);
});

test('設定で選んだ音声があればそれを使い、無ければ並びの先頭に戻る', () => {
  assert.equal(pickVoice(WINDOWS_EDGE, 'uri:Microsoft David - English (United States)')?.name, 'Microsoft David - English (United States)');
  assert.equal(pickVoice(WINDOWS_EDGE, 'uri:もう無い音声')?.name, 'Microsoft Zira - English (United States)');
  assert.equal(pickVoice([]), null);
});

test('並び: 米国 → 英国 → そのほかの地域。同じ地域では端末内の高品質版(Enhanced など)が先。同じ順位は一覧の順', () => {
  const mac = [
    v('Daniel', 'en-GB', true),
    v('Karen', 'en-AU', true),
    v('Samantha', 'en-US', true),
    v('Samantha (Enhanced)', 'en-US', true),
    v('Rishi', 'en-IN', true),
    v('Fred', 'en-US', true),
    v('Kyoko', 'ja-JP', true),
  ];
  assert.deepEqual(englishVoices(mac).map((x) => x.name), ['Samantha (Enhanced)', 'Samantha', 'Fred', 'Daniel', 'Karen', 'Rishi']);
});

test('Android の Chrome の下線区切り(en_US)と、地域の無い en も英語として扱う', () => {
  const android = [v('日本語 日本', 'ja_JP', true), v('English United Kingdom', 'en_GB', true), v('English United States', 'en_US', true)];
  assert.deepEqual(englishVoices(android).map((x) => x.name), ['English United States', 'English United Kingdom']);
  assert.equal(normLang('en_US'), 'en-us');
  assert.equal(isEnglish(v('English', 'en', true)), true);
  assert.equal(isEnglish(v('Eesti', 'et-EE', true)), false);
});

test('速さ: 既定は ふつう(0.9)で、選択肢に入っている', () => {
  assert.equal(DEFAULT_RATE, 0.9);
  assert.ok(RATES.some(([r]) => r === DEFAULT_RATE));
});

test('読む文: 単語はそのまま。句表現の目印は読まないか、読める語に置き換える', () => {
  assert.equal(speechText('itinerary'), 'itinerary');
  assert.equal(speechText('be aware of A'), 'be aware of');
  assert.equal(speechText('prevent A from -ing'), 'prevent from doing');
  assert.equal(speechText('not only A but also B'), 'not only but also');
  assert.equal(speechText('on behalf of A / on A\'s behalf'), 'on behalf of');
  assert.equal(speechText('look forward to ~ing'), 'look forward to doing');
  assert.equal(speechText('take care of sb'), 'take care of somebody');
  assert.equal(speechText('(be) eligible for'), 'be eligible for');
  assert.equal(speechText('in advance'), 'in advance');
  // 先頭の A は冠詞などかもしれないので残す
  assert.equal(speechText('A lot of'), 'A lot of');
  assert.equal(speechText(''), '');
});
