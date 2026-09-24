# 落とし穴

再発しうる罠だけを書く。一度きりの不具合の修正記録は書かない(UD-4)。

| # | 症状 | 原因 | 対処 |
| --- | --- | --- | --- |
| P-1 | `core/` にブラウザの API を書いても Node のテストでは気づけないことがある | 参照が実行されない分岐にあると、テストは通る | `INV-6` を `doc_audit.py` で機械検査し、`tsconfig.json` の `lib` に DOM を入れない(型検査でも `window` 等が未定義になる) |
| P-2 | Windows で子プロセスに `node` のフルパスを渡すと起動に失敗する | `shell: true` にすると、インストール先 `Program Files` の空白でパスが分割される | `Tools/check.mjs` では `node` を `shell` なしで起動し、`tsc.cmd` だけ `shell` を使う |
| P-3 | ソースに書いたつもりの Unicode エスケープ(バックスラッシュ + `u` + 16 進 4 桁)が、実際の文字として書き込まれる。見えない文字(BOM `U+FEFF` など)だと Read や `cat` では気づけない | Claude の Write / Edit ツールに渡した本文の中で、この並びが解釈される(`\n` `\r` `\t` はそのまま残る)。実測: `core/importFormat.js` の正規表現で起き、`tsc` は別の行の型エラーとして報告した。この表を書いたときにも再発した | 見える文字はそのまま書く。見えない文字は Python なら `chr(0xFEFF)`、JS なら `String.fromCharCode(0xfeff)` で作る。エスケープ表記が要るときは ASCII だけのスクリプトで書き換える。`doc_audit.py` の `P-3 invisible chars` が見えない文字と制御文字を FAIL にする |
| P-4 | JSDoc の説明文にバッククォート 3 つ(コードブロックの開き)を書くと、その後の `@param` が読まれず、`tsc` が「暗黙の any」と報告する | 閉じていないコードブロックが、後ろのタグを本文として飲み込む(波括弧や 1 つのバッククォートでは起きないことを実験で確認済み) | JSDoc の説明文にはバッククォート 3 つを書かず、「コードブロック」と言葉で書く。`tsc` の strict で検出される |
| P-5 | PowerShell 5.1 で読んで書き戻したファイルの日本語が文字化けする。逆に、PowerShell で書いた `CLAUDE.local.md` が起動確認で `no @import line found` になる | 5.1 の `Get-Content`(`-Raw` を含む)は BOM の無い UTF-8 を cp932 として読む。`Set-Content -Encoding utf8` は BOM を付けて書く。実測: 陽性対照のために退避・復元した `core/book.js` と `app/storage.js` が化けた。化けた文字も正しい UTF-8 なので `P-3 invisible chars` では検出できない | 日本語を含むファイルの退避・書き換えは Node か Python で行う(`PYTHONUTF8=1`)。書き戻したら `git diff` で化けていないかを見る |
| P-6 | 検査の結果を集めるスクリプトが、テストが落ちているのに「落ちていない」と読む | Node 24 の `node --test` は、出力先が端末でないときも TAP ではないレポーターで出す。`# fail N` の行が無く、失敗件数を読めない | 件数を読むときは `--test-reporter=tap` を明示する(`Tools/check.mjs` はそうしている)。新しい集計スクリプトは、わざと落とすテストで「落ちた」と読めることを先に確かめる |
| P-7 | 編集欄の `textarea` を Playwright の `getByLabel('例文', { exact: true })` で探せない(空の追加欄では探せる) | `label` で `textarea` を囲むと、入力中の文までラベルの名前(アクセシブルネーム)に含まれる。読み上げでも同じ名前になる | ラベルは `for` と `id` で結ぶ(`app/wordForm.js`)。画面の確認(`npm run e2e`)が編集欄をラベルで探すので、崩れれば落ちる |
