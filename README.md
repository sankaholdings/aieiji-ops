# aieiji-ops

AIEiji多重エージェント（秘書 / CFO / SE）の作業指示・スクリプト管理バス。

## 役割

GitHub Issues を作業指示バスとして、1106PC（自宅・24h稼働）上の `orchestrator.ps1` が自律的にタスクを処理する。

```
社長（スマホ・どこでも）
    ↓ 日本語で指示
claude.ai AIEiji秘書
    ↓ GitHub Issue 作成
aieiji-ops（Issues = 作業指示バス）
    ↓ 10分毎ポーリング
1106PC（Claude Code headless）
    ↓ 実ファイル変更・コミット・API操作
Chatwork マイチャット（完了通知）
```

## ディレクトリ構造

```
aieiji-ops/
├── scripts/
│   ├── gas/          Google Apps Script（Gmail/Chatwork 連携）
│   ├── python/       Python スクリプト（MF会計・Inbox処理）
│   └── powershell/   PowerShell（パイプライン・経費計算）
├── orchestrator/     自律処理エンジン（orchestrator.ps1 予定）
├── docs/             設計メモ・手順書
└── .github/
    └── ISSUE_TEMPLATE/
        ├── se_workorder.md   SE作業指示
        └── bug_report.md     バグ報告
```

## 安全装置

| 仕組み | 内容 |
|---|---|
| ラベル制限 | `auto-process` のみ自動処理 |
| 承認フロー | `needs-approval` → 停止＋Chatwork通知 |
| 禁止操作 | `git reset --hard`, `rm -rf`, `postJournals` 等 |
| Kill switch | `C:\aieiji-ops\PAUSE` ファイルで全停止 |
| ログ | 全操作を Action_Log.md ＋ Issue コメントに記録 |
| 冪等性 | Issue あたり1回のみ処理 |
