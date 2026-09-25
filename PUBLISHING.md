# 公開の引き継ぎ手順(先生向け)

> 対象: GitHub を触ったことがない先生。今は生徒個人の GitHub アカウントで公開している
> `tango-drill` を、学校側が管理できる形に引っ越すための手順。
> 生徒(今の管理者)と一緒に、1 回だけ行えばよい作業。

## 0. 最初に知っておくこと

- **GitHub** = このアプリの中身(プログラムと文書)を置いてある場所。無料で使える
- **リポジトリ** = このアプリ 1 個分の置き場所。今は `hirano-soura.github.io/tango-drill` という
  生徒個人のアカウントの下にある
- **Organization(組織)** = 個人ではなく「学校」「部活」のような団体としてアカウントを持てる
  仕組み。これを学校用に 1 個作り、そこにリポジトリを引っ越す
- 引っ越しても中身(単語の登録・出題ロジックなど)は一切変わらない。**変わるのは「誰が管理者か」だけ**
- 引っ越し後は公開 URL が変わる(例: `https://<学校の組織名>.github.io/tango-drill/`)。
  生徒に案内していた URL は張り替えが必要

作業は大きく 3 段階。**段階 1・2 は生徒と画面を見ながら一緒に**、**段階 3 以降は先生だけで**できる。

---

## 段階 1 — 学校用の GitHub アカウント(Organization)を作る

1. ブラウザで [github.com](https://github.com/) を開く
2. 右上の「Sign up」から、**先生専用の新しいメールアドレス**(学校のメールなど、個人のプライベートアドレスではないもの)でアカウントを作る
   - ここで作るのは「先生個人の GitHub アカウント」。次にこのアカウントで Organization を作る
3. ログインした状態で右上のアイコン(自分の顔写真やアイコン)→「Your organizations」→「New organization」
4. プラン選択画面が出たら、無料の「Free」を選ぶ
5. 「Organization account name」に学校や部活を表す名前を入れる(例: `xx-koko-eigobu`。半角英数字とハイフンのみ)
   - **この名前がそのまま公開 URL の一部になる**ので、あとで変えにくい前提で決める
6. 連絡先メールアドレスを入れて「Next」
7. 「Add people」の画面は、今はスキップして「Complete setup」でよい(あとで段階 4 で招待する)

これで学校用の Organization が完成。以後、この Organization にログインした状態で作業する。

---

## 段階 2 — リポジトリを生徒のアカウントから学校の Organization へ引っ越す

**ここは生徒(今の管理者アカウントを持っている人)の操作が必要。** 先生の画面と生徒の画面、両方を使う。

1. 生徒が自分の GitHub アカウントで `https://github.com/Hirano-Soura/tango-drill` を開く
2. 「Settings」タブ(リポジトリ画面の上のほうのタブ。歯車マークではなく文字の「Settings」)を開く
3. 一番下までスクロールし、赤枠の「Danger Zone」内にある「Transfer」ボタンを押す
4. 「To confirm, type "Hirano-Soura/tango-drill" in the box below」と出るので、指示どおりに入力
5. 「New owner's GitHub username or organization name」に、段階 1 で作った Organization の名前(例: `xx-koko-eigobu`)を入れる
6. 「I understand, transfer this repository」を押す
7. 先生側(Organization の管理者)にメールで通知が届くので、リンクから「Accept」を押す

これでリポジトリの持ち主が学校の Organization に変わる。生徒のアカウントには自動的に
「Collaborator(共同作業者)」として権限が残るので、そのまま開発を続けられる。

---

## 段階 3 — 新しい場所で GitHub Pages を有効にする

引っ越し直後は公開ページが一時的に見られなくなっている。**先生の操作だけで**再度公開できる。

1. Organization にログインした状態で、リポジトリ `https://github.com/<学校の組織名>/tango-drill` を開く
2. 上のタブから「Settings」を押す
3. 左側のメニューから「Pages」を押す
4. 「Build and deployment」の「Source」が「Deploy from a branch」になっていることを確認する
5. その下の「Branch」で `main` を選び、フォルダは `/ (root)` のまま「Save」を押す
6. 1 分ほど待つと、同じ画面の上のほうに緑色で「Your site is live at `https://<学校の組織名>.github.io/tango-drill/`」と表示される
7. そのリンクをクリックし、実際にアプリが開くことを確認する

---

## 段階 4 — 開発を手伝う生徒を招待する(任意・必要なときに)

1. Organization のトップページ(`https://github.com/<学校の組織名>`)→「People」→「Invite member」
2. 招待したい生徒の GitHub ユーザー名かメールアドレスを入力して送る
3. 招待した生徒には、リポジトリの「Settings → Collaborators and teams」から役割を **Write** にする
   (**Admin にはしない**。設定変更やリポジトリ削除は先生の Organization アカウントだけができる状態を保つ)
4. 卒業・引退した生徒は同じ画面から「Remove」で外す(**これを定期的に見直す**。人が入れ替わる前提の運用にする)

## 段階 5 — 公開版が壊れないようにする(推奨・任意)

> 引っ越しの前に [BRANCHING.md](BRANCHING.md) を済ませていれば、この段階は設定済み。
> ルールセットが残っていることと、その Bypass list を確かめるだけでよい(BRANCHING.md §8)。

今は誰でも `main` に直接 push できる設定。生徒が複数人になったら、次を設定しておくと安全(この節は
今の管理者の生徒と一緒に行うとよい)。

1. リポジトリの「Settings → Branches → Add branch ruleset」(または「Add rule」)
2. 対象ブランチに `main` を指定
3. 「Require a pull request before merging」を有効にする(直接 push できなくなり、必ず変更内容を
   確認してから取り込む形になる)
4. 「Require status checks to pass」を有効にし、既存の CI(`.github/workflows/ci.yml` が回す
   挙動・型・文書の検査)を必須チェックに指定する

---

## 困ったときは

- 「Your site is live at」が出ない・404 になる → 数分待ってから再読み込み。それでも出なければ
  段階 3 の手順 4〜5 をやり直す
- Transfer のボタンが押せない → 生徒側のアカウントがそのリポジトリの Owner になっているか確認する
  (Collaborator 権限だけでは Transfer できない)
- 招待メールが届かない → 迷惑メールフォルダを確認する。それでも届かなければ、Organization の
  「People → Invite member」からもう一度送り直す
