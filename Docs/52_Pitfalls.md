# 落とし穴

再発しうる罠だけを書く。一度きりの不具合の修正記録は書かない(UD-4)。

| # | 症状 | 原因 | 対処 |
| --- | --- | --- | --- |
| P-1 | `core/` にブラウザの API を書いても Node のテストでは気づけないことがある | 参照が実行されない分岐にあると、テストは通る | `INV-6` を `doc_audit.py` で機械検査し、`tsconfig.json` の `lib` に DOM を入れない(型検査でも `window` 等が未定義になる) |
| P-2 | Windows で子プロセスに `node` のフルパスを渡すと起動に失敗する | `shell: true` にすると、インストール先 `Program Files` の空白でパスが分割される | `Tools/check.mjs` では `node` を `shell` なしで起動し、`tsc.cmd` だけ `shell` を使う |
