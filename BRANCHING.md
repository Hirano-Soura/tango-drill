# ブランチ開発への切り替え手順(引き継ぎの前段)

> 対象: 今の管理者(リポジトリ `Hirano-Soura/tango-drill` の Owner)。
> `main` へ直接積む今の運用を、**「ブランチで作って Pull Request(PR)で提案 → 統合権限を持つ人が承認して `main` へ入れる」**
> 運用に切り替える。GitHub の画面での一度きりの設定。
>
> 全体は 2 段階で、本書は **段階 1** だけを扱う。
>
> | 段階 | 内容 | 手順 |
> | --- | --- | --- |
> | 1 | `main` を守る。ブランチでの開発は「本人の個人アカウント」と「学校メアドのアカウント」に限る。`main` へ入れる権限は本人(Owner)だけに残す | **本書** |
> | 2 | `main` へ入れる権限(Owner)を学校の Organization へ移す | [PUBLISHING.md](PUBLISHING.md) |

## 0. 設定後の形

| 役割 | アカウント | できること | できないこと |
| --- | --- | --- | --- |
| リーダー(統合権限) | `Hirano-Soura`(Owner) | ブランチ作成・PR・**PR の承認と `main` への統合**・設定の変更 | `main` への直接 push(自分の変更も PR を通す) |
| 開発者 | 学校メアドで作った GitHub アカウント(Collaborator) | ブランチ作成・push・PR の作成 | `main` への push と統合・PR を自分で `main` へ入れること・設定の変更 |
| それ以外の人 | — | 閲覧、fork して PR を送ること(公開リポジトリのため) | このリポジトリへの push 全般 |

- 個人アカウントのリポジトリでは、Collaborator の権限は **Write 固定**(Organization のような役割の細かい選択が無い)。
  Write のままだと `main` へ push できてしまうので、**ルールセット(Ruleset)で `main` を塞ぐ**のが本書の要
- `main` を更新できるのは「ルールセットを迂回できる人」= Repository admin = Owner だけ、という形にする
- 公開リポジトリなので、ルールセットは無料プランのまま使える

---

## 1. 学校メアドの GitHub アカウントを用意する

学校メアドの GitHub アカウントがまだ無ければ作る。**個人アカウントとは別のアカウント**にする(1 人が 2 アカウントを持つ形)。

1. 個人アカウントからログアウトした状態(またはブラウザのシークレットウィンドウ)で [github.com](https://github.com/) の「Sign up」
2. 学校のメールアドレスで登録し、届いた確認メールで認証する
3. **メールアドレスを公開しない設定にする**(公開リポジトリのコミットにはメールアドレスが残るため。CLAUDE.md §4)
   - 「Settings → Emails」で「Keep my email addresses private」をオン
   - 同じ画面の「Block command line pushes that expose my email」もオン
   - 同じ画面に出る `<数字>+<ユーザー名>@users.noreply.github.com` の形のアドレスを控える(§5 で使う)

個人アカウントの側も、同じ 3 の設定がオンになっているかを確かめておく。

---

## 2. 学校メアドのアカウントを Collaborator に招待する

**個人アカウント(Owner)で操作する。**

1. `https://github.com/Hirano-Soura/tango-drill` →「Settings」→ 左の「Collaborators」
2. 「Add people」→ 学校メアドのアカウントのユーザー名(またはメールアドレス)を入れて招待
3. **学校メアドのアカウントで**届いたメール(または `https://github.com/Hirano-Soura/tango-drill/invitations`)から「Accept invitation」

この時点では、学校メアドのアカウントは `main` へも push できてしまう。**§3 まで続けて行う。**

---

## 3. `main` にルールセットを掛ける

**個人アカウント(Owner)で操作する。**

1. 「Settings」→ 左の「Rules」→「Rulesets」→「New ruleset」→「New branch ruleset」
2. 次のとおり埋める

| 項目 | 設定値 | 理由 |
| --- | --- | --- |
| Ruleset Name | `main を守る` | 何の規則か判ればよい |
| Enforcement status | **Active** | Disabled / Evaluate では効かない |
| Bypass list | 「Add bypass」→ **Repository admin** を足し、横の選択肢を **For pull requests only** にする | Owner だけが PR を `main` へ入れられるようにする。「Always」にすると Owner の直接 push も通ってしまう |
| Target branches | 「Add target」→「Include default branch」 | `main` を対象にする |
| Restrict creations | オフ | — |
| **Restrict updates** | **オン** | 迂回できる人(Owner)以外は `main` を更新できない = **統合権限を Owner に絞る**本体。これが無いと、承認済みの PR を Collaborator が自分で統合できる |
| **Restrict deletions** | **オン**(既定でオン) | `main` の削除を防ぐ |
| Require linear history | オフ | 好みでよい |
| **Require a pull request before merging** | **オン**。展開して次のとおり | 変更は必ず PR を通す |
| └ Required approvals | `1` | 「承認して入れる」を記録に残す |
| └ Dismiss stale pull request approvals when new commits are pushed | オン | 承認後に中身が変わったら承認をやり直す |
| └ Require approval of the most recent reviewable push | オン | 同上 |
| └ Require conversation resolution before merging | オン | レビューの指摘を放置したまま入れない |
| └ Allowed merge methods | Squash だけ(好みで Merge / Rebase も) | 1 PR = `main` の 1 コミットにして履歴を読みやすくする |
| **Require status checks to pass** | **オン**。「Add checks」で `check` を選ぶ | CI(`.github/workflows/ci.yml` の job `check`。挙動・型・文書の 3 系統)が通らない変更を入れない |
| **Block force pushes** | **オン**(既定でオン) | `main` の履歴の書き換えを防ぐ |

3. 一番下の「Create」

- `check` が候補に出ないときは、直近 7 日に CI が走っていないのが原因。どこかのブランチへ push して CI を 1 回走らせてから選び直す
- 自分(Owner)の PR は承認者がいないので、統合の画面で「Merge without waiting for requirements to be met (bypass rules)」に
  チェックを入れて入れる。**CI が通っていることは自分の目で確かめてから**チェックする

---

## 4. リポジトリ全体の設定を揃える

「Settings → General」の「Pull Requests」:

- 「Automatically delete head branches」をオン(統合したブランチを自動で消す)
- §3 の Allowed merge methods と揃えて、使わない統合方法のチェックを外す

「Settings → Actions → General」:

- 「Workflow permissions」を「Read repository contents and packages permissions」にする
- 「Allow GitHub Actions to create and approve pull requests」はオフのまま(Actions が承認者の代わりにならないようにする)

---

## 5. 各端末の git を合わせる

学校メアドのアカウントで開発する端末では、clone した後にそのリポジトリだけの名前とメールアドレスを設定する
(**学校のメールアドレスそのものは書かない**。§1 で控えた noreply のアドレスを使う)。

```bash
git config user.name "<学校メアドのアカウントのユーザー名>"
```

```bash
git config user.email "<数字>+<ユーザー名>@users.noreply.github.com"
```

push のときの認証は、その端末で学校メアドのアカウントとしてログインする(Git Credential Manager のブラウザ認証、または `gh auth login`)。
個人アカウントと同じ端末で両方を使うときは、どちらでログインしているかを `gh auth status` で確かめてから push する。

---

## 6. 効いていることを確かめる(陽性対照)

設定は「効いているつもり」になりやすいので、**わざと禁止の操作をして弾かれること**を確かめる(UV-1 と同じ考え方)。

| # | 誰で | 操作 | 期待 |
| --- | --- | --- | --- |
| 1 | 学校メアド | `main` へ直接 push(下の手順) | `GH013: Repository rule violations` で拒否される |
| 2 | 個人(Owner) | 同じく `main` へ直接 push | 同じく拒否される(Bypass を「For pull requests only」にしたため) |
| 3 | 学校メアド | ブランチを push し、PR を作る | 通る。PR の画面で CI(`check`)が走る |
| 4 | 学校メアド | #3 の PR の統合ボタン | 押せない(承認が無い・更新の権限が無い) |
| 5 | 個人(Owner) | #3 の PR を「Approve」→ 統合 | 通る |

#1・#2 の直接 push は、空のコミットで試す(中身を変えないので、万一通っても害が無い):

```bash
git fetch origin
```

```bash
git switch -c ruleset-test origin/main
```

```bash
git commit --allow-empty -m "test: main への直接 push が拒否されることの確認"
```

```bash
git push origin ruleset-test:main
```

拒否されたら、試したブランチを消す(`main` へ移ってから):

```bash
git switch main
```

```bash
git branch -D ruleset-test
```

**#1 か #2 が通ってしまったら**、§3 の Enforcement status(Active か)・Target branches(`main` が入っているか)・
Bypass の選択肢(Always になっていないか)を見直す。`main` に入った空のコミットは害が無いのでそのままでよい。

---

## 7. 切り替え後の日々の流れ

1. `main` を最新にする: `git switch main` → `git pull`
2. 作業ブランチを切る: `git switch -c <種類>/<内容>`(例: `feat/quiz-timer`、`fix/import-blank-row`、`docs/branching`)
3. 書く → `npm run check` → 文書を触ったら `python Tools/DocAudit/doc_audit.py`(CLAUDE.md §1 の定型手順)
4. push して PR を作る(`gh pr create`、または GitHub の画面の「Compare & pull request」)
5. CI(`check`)が緑になるのを待つ
6. リーダー(段階 1 では Owner = 本人)が中身を見て承認し、Squash で統合する
7. 手元の `main` を `git pull` で最新にし、作業ブランチを消す

---

## 8. 段階 1 を終えたら直す文書

- **`CLAUDE.md` §4 の「公開前の立ち上げ期は `main` に直接積んでよい」を外す。** 設定後は `main` への直接 push が拒否されるため、
  Claude Code にもブランチ → PR の流れを指示する形に書き換える
- [PUBLISHING.md](PUBLISHING.md) の段階 5(公開版が壊れないようにする)は本書で済んでいる。段階 2 の引っ越しの後は、
  ルールセットが残っていることと、Bypass list の Repository admin が学校の Organization 側の管理者を指すようになったことを確かめるだけでよい

## 困ったときは

- Collaborator の招待画面が出ない → リポジトリの Owner のアカウントでログインしているか確かめる
- ルールセットを作ったのに学校メアドのアカウントで `main` へ push できる → §6 の「通ってしまったら」を見る
- 自分の PR が統合できない → 統合ボタン横の「bypass rules」のチェックを入れる(§3 の最後)。それでも出ないときは Bypass list に Repository admin が入っているかを見る
- `git push` で「Permission denied」や「Repository not found」 → 招待を Accept していない、または端末で別のアカウントでログインしている(§5)
