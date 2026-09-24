# CLAUDE.md — tango-drill

> 共通ルール(AI 駆動開発_共通ルール)を継承する。**本書は差分だけ**を持つ。
> ID(`US-n` `UV-n` `UD-n` `UE-n` `UT-n`)の意味は共通ルール側。

## 共通ルールの読み込み

共通ルールは **`CLAUDE.local.md`(git 管理外)から import する。** このリポジトリは複数の端末で clone して使い、
共通ルールの置き場所が端末ごとに違うため、共有する本書には絶対パスを書かない(UD-8)。

- 各端末のリポジトリ直下に `CLAUDE.local.md` を作り、その端末での共通ルールの場所を `@<絶対パス>` の 1 行で書く
- `CLAUDE.local.md` の有無と、import 先の実在は `Tools/Startup/check_env.py` が検査する
- **セッションの冒頭で「`US-1` は何か」に答えられることを確かめる。** 答えられなければ共通ルールは効いていない

---

## 0. セッション開始(US-1 の本プロジェクト版)

### 段 1 — 環境の起動確認

```bash
python Tools/Startup/check_env.py > /dev/null 2>&1; cat Temp/tango-drill_startup_check.txt
```

FAIL があれば本人に伝えて止まる。

### 段 2 — 機械では判らない疎通

現時点では無い(サーバー・MCP・外部 API に依存しない静的アプリのため)。
ブラウザで確かめるときの静的サーバーは `node Tools/Dev/serve.mjs`(127.0.0.1:8765)。
画面の確認(`npm run e2e`)に要るもの(`@playwright/test` と Edge)は段 1 の `check_env.py` が見る。WARN なら画面の確認は回せない。

---

## 1. 検証(UV-2 / UV-3 の本プロジェクト版)

| 系統 | 手段 | 本体の起動 | 回数無制限か |
| --- | --- | --- | --- |
| 挙動 | `npm test`(`node --test`。対象は `core/` と `app/` の保存層。IndexedDB は `fake-indexeddb` で代える) | 不要 | 無制限 |
| 型 | `npm run typecheck`(`tsc --noEmit`。JSDoc の型注釈を検査。`core/` は DOM なしの `tsconfig.json`、`app/` は DOM ありの `tsconfig.app.json`) | 不要 | 無制限 |
| 文書 | `python Tools/DocAudit/doc_audit.py`(レポートは `Temp/tango-drill_doc_audit.txt`) | 不要 | 無制限 |
| 画面(三本立ての外) | `npm run e2e`(Playwright の通し確認。端末の Edge を使う。`Docs/23_Screens.md` §6)+ 実機での目視 | 必要(Playwright が静的サーバーを立てる) | 節目のみ |

- 挙動と型の結果は `npm run check` がまとめて `Temp/tango-drill_check.txt` へ書く(UV-4)
- 文書検査の陽性対照は `python Tools/DocAudit/doc_audit.py --self-test`(わざと壊した文書を検出できることを確かめる。UV-1)
- 同じ 3 系統を GitHub Actions が push ごとに回す(`.github/workflows/ci.yml`)

### 変更後の定型手順

1. ファイルを書く
2. `npm run check` → `Temp/tango-drill_check.txt` を読む
3. 文書を触ったら `doc_audit.py` → レポートを読む
4. 検査を触ったら `--self-test` と、テストに入れた陽性対照を通す

---

## 2. 文書

- 全文書は `Docs/`。索引は `Docs/00_Index.md`(UD-1)
- **進捗の唯一の真実は `Docs/50_Tasks.md`**(UD-3)
- 意味の齟齬はサブエージェント `tango-drill-doc-audit`(読み取り専用)へ。
  機械検査(`Tools/DocAudit`)と**両方を回して初めて塞がる**

### 共通ルールの読み替え

- `README.md` は `Docs/` の外に置く。理由: GitHub のリポジトリ画面で最初に表示される操作手順のため(UD-1 補足の「操作手順」に当たる)

---

## 3. 本プロジェクト固有の不変条件

| ID | 内容 | 破った場合 | 検査手段 |
| --- | --- | --- | --- |
| `INV-1` | 学習記録・単語を外部へ送信しない | 個人情報を扱わない前提が崩れ、授業で使えなくなる | 機械検査(`doc_audit.py` の `INV-1 no send`。配布するコードに出る送信 API と外部 URL を、同じファイルの許可リスト `INV1_ALLOW` と照合) |
| `INV-2` | 取り込みは必ず確認表を経てから保存する | AI の誤出力で単語帳が壊れる | `core/` の関門(確定した確認表しか保存用の一覧にしない)は挙動テスト(`tests/core/importPlan.test.js`)。画面が確認表を通すことは T-5.1 で Playwright。追加タブで手で入れる 1 語も確認表を通し、「足す」行だけを確定する(`addOneWord`。`tests/core/book.test.js`)。バックアップの読み込みは語の取り込みではなく、確認表を通さずに件数を見せて置き換える(`Docs/22_Storage.md` §3)。バックアップを語の取り込みに渡すと拒否することは挙動テスト(`tests/core/backup.test.js`) |
| `INV-3` | 取り込み形式とバックアップ形式は版を持ち、過去の版をすべて読める | 利用者のバックアップが読めなくなる | 挙動テスト(`tests/core/importVersions.test.js` と `tests/core/backup.test.js` が各版の見本を読ませる) |
| `INV-4` | 語の同一性は `見出し語 + 品詞` | 同綴り別品詞の記録が混ざる | 挙動テスト(`tests/core/word.test.js`、取り込みでの重複は `tests/core/importPlan.test.js`、バックアップの中の重複と `duplicateKeys` は `tests/core/backup.test.js` と `tests/core/book.test.js`) |
| `INV-5` | 内蔵語彙は誤答にだけ使い、問題には出さない | 登録していない語が出題される | 挙動テスト(誤答の側は `tests/core/distractors.test.js`、出題集合の側は `tests/core/review.test.js`。どちらも内蔵語彙を 1 件混ぜた入力を検出する陽性対照つき。単語帳から作った回の出題集合で違反が無いことは `tests/core/book.test.js`) |
| `INV-6` | `core/` はブラウザの API(`window` `document` `indexedDB` `localStorage` 等)に触れない | Node だけで回す検証経路(UV-3)が失われる | 機械検査(`doc_audit.py` の `INV-6 core purity`) |

---

## 4. git の裁量

- `add` / `commit` / ブランチ操作 / **`push` は自由に行ってよい**
- 履歴の書き換え(`rebase` / `commit --amend` / `push --force`)と `reset --hard` は、実行前に本人へ確認する
- `main` は授業で使う安定版。公開後の開発は別ブランチで行う(公開前の立ち上げ期は `main` に直接積んでよい)
- 個人情報(氏名・学籍番号・個人の学習状況)をリポジトリに入れない。**公開リポジトリである**

---

## 5. コーディング規則(追加分のみ)

- ビルド工程を持たない。ブラウザが直接読める ES モジュールで書く
- 型は JSDoc で書き、`tsc` は検査にだけ使う(配布物に TypeScript を入れない)
- 画面に依存しない処理は `core/` に置く。画面側から `core/` を呼ぶ向きだけを許す
