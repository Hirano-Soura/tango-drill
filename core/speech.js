// 読み上げの規則(Docs/24_Speech.md): どの音声で読むかと、何を読むか。
// ブラウザの音声の一覧は画面の側(app/speech.js)が取り、ここは渡された一覧から選ぶだけにする(INV-6)。
// INV-1: 端末内の音声(localService が true)だけを選ぶ。インターネット経由の音声は、読む文(単語・例文)を外部へ送るので選ばない。

/**
 * 音声の一覧の 1 件。ブラウザの SpeechSynthesisVoice のうち、選ぶのに使う項目だけ。
 * @typedef {object} VoiceLike
 * @property {string} name
 * @property {string} lang BCP 47 の言語タグ。Android の Chrome は en_US のように下線で区切る
 * @property {boolean} localService 端末内の音声か(false はインターネット経由)
 * @property {string} voiceURI
 */

/** 読み上げの速さの選択肢(値は SpeechSynthesisUtterance の rate)。既定は ふつう */
/** @type {readonly [number, string][]} */
export const RATES = Object.freeze([[0.7, 'ゆっくり'], [0.9, 'ふつう'], [1.1, 'はやい']]);
export const DEFAULT_RATE = 0.9;

/**
 * 保存してある速さを、選択肢の値にそろえる。選択肢に無い値(手で書き換えた値・選択肢を変える前の値)は既定にする
 * (画面の選択と、実際に読む速さをずらさないため)。
 * @param {unknown} rate
 * @returns {number}
 */
export function rateOf(rate) {
  return RATES.some(([r]) => r === rate) ? /** @type {number} */ (rate) : DEFAULT_RATE;
}

/**
 * 言語タグをそろえる(下線をハイフンに、小文字に)。
 * @param {string} lang
 * @returns {string}
 */
export function normLang(lang) {
  return String(lang ?? '').replace(/_/g, '-').toLowerCase();
}

/**
 * 英語の音声か。
 * @param {VoiceLike} v
 * @returns {boolean}
 */
export function isEnglish(v) {
  return /^en(-|$)/.test(normLang(v.lang));
}

/** 地域の並び(TOEIC の音声に合わせて米国を先にする)。ここに無い地域はこの後ろ */
const REGIONS = ['en-us', 'en-gb', 'en-ca', 'en-au', 'en-nz', 'en-ie'];

/**
 * @param {VoiceLike} v
 * @returns {number}
 */
function rank(v) {
  const i = REGIONS.indexOf(normLang(v.lang));
  // 端末内の高品質版(macOS・iOS の Enhanced / Premium など)を同じ地域の中で先にする
  const quality = /enhanced|premium|natural|neural/i.test(v.name) ? 0 : 1;
  return (i < 0 ? REGIONS.length : i) * 2 + quality;
}

/**
 * 使ってよい英語の音声を、選ぶ順に並べる。インターネット経由の音声は入れない(INV-1)。
 * 同じ順位のものは一覧の順を保つ。
 * @template {VoiceLike} V
 * @param {readonly V[]} voices
 * @returns {V[]}
 */
export function englishVoices(voices) {
  return voices
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.localService === true && isEnglish(v))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map(({ v }) => v);
}

/**
 * インターネット経由の英語の音声の数(使わない理由を画面で知らせるため)。
 * @param {readonly VoiceLike[]} voices
 * @returns {number}
 */
export function remoteEnglishCount(voices) {
  return voices.filter((v) => v.localService !== true && isEnglish(v)).length;
}

/**
 * 読み上げに使う音声。選んである音声(voiceURI)が使える英語の音声にあればそれ、無ければ並びの先頭。
 * 使える音声が無ければ null(そのときは読まない。言語だけを指定して読ませると、ブラウザがインターネット経由の音声を選ぶことがある)。
 * @template {VoiceLike} V
 * @param {readonly V[]} voices
 * @param {string} [chosen] 設定で選んだ音声の voiceURI。空なら自動
 * @returns {V | null}
 */
export function pickVoice(voices, chosen = '') {
  const list = englishVoices(voices);
  return (chosen && list.find((v) => v.voiceURI === chosen)) || list[0] || null;
}

/**
 * 見出し語から読む文を作る。句表現の目印(A・B・~・-ing など)は、そのまま読むと
 * 「エー」「チルダ」「マイナス」になるので、読まないか、読める語に置き換える。言い換えが「/」で並ぶときは最初だけを読む。
 * @param {string} en
 * @returns {string}
 */
export function speechText(en) {
  let s = String(en ?? '').split(/\s+\/\s+/)[0];
  s = s.replace(/(^|\s)(?:[~\u301c\uff5e]|-)ing\b/g, '$1doing')
    .replace(/[~\u301c\uff5e\u2026]/g, ' ')
    .replace(/[()\uff08\uff09[\]]/g, ' ')
    .replace(/\bsb\b/g, 'somebody')
    .replace(/\bsth\b/g, 'something');
  // 目印の A・B(先頭の語は冠詞などの A かもしれないので残す)。所有の A's も読まない
  const words = s.split(/\s+/).filter(Boolean);
  const kept = words.filter((w, i) => i === 0 || !/^[AB](['’]s)?[,.;]?$/.test(w));
  return kept.join(' ').trim();
}
