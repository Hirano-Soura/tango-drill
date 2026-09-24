// 乱数を使う純粋関数。ブラウザの API に触れない(INV-6)。
// 乱数は呼び出し側から渡せるようにし、テストで種を固定できるようにする。

/**
 * 0 以上 1 未満を返す乱数。
 * @typedef {() => number} Rng
 */

/**
 * 並びを混ぜた写しを返す(Fisher–Yates)。元の配列は変えない。
 * 出自: toeic-drill の 単語ドリル.html(shuffleArr)。乱数を引く回数と順序も同じにしてあり、
 * 同じ乱数を渡せば同じ並びになる(復習ミックスの比較テストが頼っている)。
 * @template T
 * @param {readonly T[]} a
 * @param {Rng} rng
 * @returns {T[]}
 */
export function shuffle(a, rng) {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
