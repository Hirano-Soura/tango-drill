# tango-drill

英単語を**自分の単語帳**として登録し、4 択・カードで復習する Web アプリ(開発中)。
授業での利用を想定し、サーバーを持たず、学習記録は利用者の端末の中だけに保存する方針。

設計と進捗は [Docs/00_Index.md](Docs/00_Index.md) から辿れる。

## 開発

必要なもの: Node.js 20 以上、Python 3.10 以上。

```bash
npm install
```

```bash
npm run check
```

挙動(`node --test`)と型(`tsc`)を検査し、結果を `Temp/tango-drill_check.txt` に書く。

```bash
python Tools/DocAudit/doc_audit.py
```

文書を検査し、結果を `Temp/tango-drill_doc_audit.txt` に書く。

## 手元で動かす

ビルド工程は無い。静的サーバーを立てて `http://127.0.0.1:8765/` を開く。

```bash
node Tools/Dev/serve.mjs
```

画面の通し確認(Playwright。端末に入っている Edge を使う)は次のとおり。結果は `Temp/tango-drill_e2e.json` に書く。

```bash
npm run e2e
```

Edge の無い端末では、別のブラウザを指定する(`PW_CHANNEL=chrome npm run e2e`)か、
入っている Chromium の実行ファイルを指定する(`PW_EXECUTABLE=<Chromium のパス> npm run e2e`)。
