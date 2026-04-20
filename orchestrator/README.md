# orchestrator

GitHub Issues を10分毎にポーリングして、`auto-process` ラベル付きIssueを自律処理する。

## ファイル構成

```
orchestrator/
├── orchestrator.ps1       メインループ
├── lib/
│   ├── config.ps1         定数・パス・ラベル名
│   ├── log.ps1            Action_Log.md 打刻（Mutex排他）
│   ├── chatwork.ps1       Chatwork REST 通知
│   ├── github.ps1         gh CLI ラッパー
│   └── claude.ps1         Claude Code 呼び出し（MVPスタブ）
├── .env.example           環境変数テンプレ
└── README.md
```

## セットアップ

```powershell
cd C:\aieiji-ops\orchestrator
Copy-Item .env.example .env
# .env を編集してトークンを入れる
notepad .env
```

## 動作確認

### Dry-run（ラベル変更・コメント・通知を全てスキップ）

```powershell
pwsh -File C:\aieiji-ops\orchestrator\orchestrator.ps1 -DryRun
```

### 本実行

```powershell
pwsh -File C:\aieiji-ops\orchestrator\orchestrator.ps1
```

## ログ

`C:\aieiji-ops\logs\Action_Log.md` に追記（gitignore済み、ローカルのみ）。

## 安全装置

| 仕組み | 内容 |
|---|---|
| Kill switch | `C:\aieiji-ops\PAUSE` ファイル存在で即終了 |
| ラベル制限 | `auto-process` ラベル付きのみ処理 |
| 冪等性 | `processed` / `in-progress` ラベル付きはスキップ |
| 承認フロー | `needs-approval` ラベル → Chatwork通知して処理スキップ |
| 失敗時 | `failed` ラベル付与＋Chatwork警告通知 |
| Mutex | Action_Log書き込みはプロセス間排他 |

## Issue ラベルのライフサイクル

```
(なし)
  ↓ 社長がIssue作成・auto-processラベル付与
auto-process
  ↓ orchestrator検知・処理開始
auto-process + in-progress
  ↓ 正常完了
auto-process + processed

または
  ↓ 失敗
auto-process + failed

または最初から
auto-process + needs-approval → スキップ＋Chatwork通知
```

## Claude Code 統合（本実装時）

現在はMVPスタブ。`lib/claude.ps1` の `Invoke-ClaudeCode` 関数を以下のように書き換える：

```powershell
$result = claude -p $Prompt --cwd $WorkingDirectory --output-format json 2>&1
# 結果パース・返却
```

本実装後は、Issue本文を読んで実際にファイル変更・コミット・プッシュまで行う。
