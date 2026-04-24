# Gmail スレッド監視 → Chatwork通知

GitHub Issue [#14](https://github.com/sankaholdings/aieiji-ops/issues/14) 対応。

## 概要

Gmail 上で **`AIEiji/Watch` ラベル**を付けたスレッドへの新着返信を 30〜60 分毎に検知し、Chatwork マイチャット (Room `46076523`) に通知する。

```
Task Scheduler (30〜60min)
   ↓ 起動
run_gmail_thread_watcher.ps1
   ↓ 子プロセス
gmail_thread_watcher.py
   ↓ Gmail API (OAuth2)
新着返信検知 → Chatwork REST API
```

## ファイル

| パス | 役割 |
|---|---|
| `scripts/python/gmail_thread_watcher.py` | Gmail API 呼び出し本体（OAuth2 + 状態管理 + Chatwork 投稿） |
| `scripts/powershell/run_gmail_thread_watcher.ps1` | Task Scheduler 起動用ラッパー |
| `scripts/powershell/gmail_thread_watcher.log` | 実行ログ（gitignore 済み） |
| `bridge/state/gmail_thread_watcher_state.json` | 状態ファイル（最終チェック時刻＋既読 message_id 一覧、gitignore 済み） |
| `orchestrator/gmail_credentials.json` | OAuth クライアント secret（**gitignore 済み・絶対にコミットしない**） |
| `orchestrator/gmail_token.json` | OAuth 認可済みトークンキャッシュ（**gitignore 済み**） |

## 初期セットアップ（1106PC で 1 回だけ）

### 1. Google Cloud Console で OAuth クライアントを作成

1. https://console.cloud.google.com/ を開く
2. プロジェクト作成（既存の AIEiji 用プロジェクトでも可）
3. **APIs & Services → Library** で **Gmail API** を有効化
4. **APIs & Services → OAuth consent screen** で「外部」を選択し、自分のアドレス (`ejsanka@gmail.com`) をテストユーザに追加
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Name: `AIEiji Gmail Thread Watcher`
6. JSON をダウンロードし、`C:\aieiji-ops\orchestrator\gmail_credentials.json` として保存

### 2. Gmail で監視ラベルを作成

Gmail Web UI → 左サイドバー → 「ラベルを作成」→ 名前: **`AIEiji/Watch`**

監視したいスレッドにこのラベルを手動で付与する（複数可）。

### 3. 初回認証（デスクトップで対話的に実行）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File C:\aieiji-ops\scripts\powershell\run_gmail_thread_watcher.ps1
```

ブラウザが起動して Google 同意画面が出る → 承認すると `orchestrator\gmail_token.json` が生成される。
以降は無人実行可能。

### 4. Task Scheduler に登録

```powershell
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\aieiji-ops\scripts\powershell\run_gmail_thread_watcher.ps1"

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 30) `
  -RepetitionDuration ([TimeSpan]::MaxValue)

Register-ScheduledTask -TaskName "AIEiji_GmailThreadWatcher" `
  -Action $action -Trigger $trigger -RunLevel Highest -Force
```

## 動作仕様

- **監視対象**: ラベル `AIEiji/Watch` が付いた Gmail スレッド全部
- **新着判定**: 状態ファイルの `last_check_at` 以降に届き、かつ `seen_message_ids` に未登録のメッセージ
- **通知内容**: 件名 / 送信者 / 受信時刻（JST）/ Gmail スレッドへの直接リンク
- **冪等性**: `seen_message_ids` を最大 500 件キャッシュして重複通知を防止
- **失敗時の復旧**: Chatwork 送信に失敗した場合は `last_check_at` を更新せず、次回起動時に再送可能

## 環境変数（オプション）

| 名前 | 既定値 | 説明 |
|---|---|---|
| `CHATWORK_API_TOKEN` | （必須） | `orchestrator/.env` から自動ロード |
| `GMAIL_CREDENTIALS_FILE` | `orchestrator/gmail_credentials.json` | OAuth client secret パス |
| `GMAIL_TOKEN_FILE` | `orchestrator/gmail_token.json` | トークンキャッシュパス |
| `GMAIL_WATCH_LABEL` | `AIEiji/Watch` | 監視対象 Gmail ラベル名 |
| `CHATWORK_ROOM_ID` | `46076523` | 通知先 Chatwork Room ID |
| `GMAIL_WATCH_STATE_FILE` | `bridge/state/gmail_thread_watcher_state.json` | 状態ファイルパス |
| `GMAIL_WATCH_LOOKBACK_DAYS` | `1` | 初回起動時の遡及日数 |

## トラブルシュート

| 症状 | 対処 |
|---|---|
| `[FATAL] OAuth クライアント secret が見つかりません` | 上記 Step 1 で credentials.json を所定パスに配置 |
| `[FATAL] ラベルが見つかりません: AIEiji/Watch` | Gmail UI でラベル作成 |
| `[FATAL] CHATWORK_API_TOKEN 未設定` | `orchestrator/.env` に `CHATWORK_API_TOKEN=...` を追記 |
| トークン期限切れ | Python 側で自動リフレッシュ。失敗した場合は `gmail_token.json` を削除して Step 3 を再実行 |
| 通知が来すぎる | Gmail の `AIEiji/Watch` ラベルから不要スレッドを外す |
