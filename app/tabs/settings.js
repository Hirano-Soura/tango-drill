// 設定タブ: 端末ごとの設定。バックアップの書き出し・読み込み(T-5.2)はここに足す。

/** @typedef {import('../dom.js').Ctx} Ctx */

/** @param {Ctx} ctx */
export function render(ctx) {
  ctx.root.innerHTML = `<section class="panel">
    <h2>設定</h2>
    <div class="check"><input type="checkbox" id="useBuiltin"${ctx.settings.useBuiltin ? ' checked' : ''}>
      <label for="useBuiltin">4 択の誤答に内蔵の語彙を使う</label></div>
    <p class="hint">単語帳の語が少ないうちは、誤答の選択肢を内蔵の語彙で補います。内蔵の語彙が問題に出ることはありません。
      切ると、語が 4 語未満のあいだはカードで出題します。</p>
  </section>
  <section class="panel">
    <h2>データについて</h2>
    <p class="hint">単語帳と学習の記録は、この端末のブラウザの中にだけ保存され、外部には送信されません。
      ブラウザのデータを消すと単語帳も消えます。</p>
  </section>`;
  const box = /** @type {HTMLInputElement} */ (ctx.root.querySelector('#useBuiltin'));
  box.onchange = () => ctx.setSettings({ ...ctx.settings, useBuiltin: box.checked });
}
