# Chatwork MCP Server

ADR-0009 で定義された Chatwork 双方向操作の MCP サーバー実装。

## Status

**Phase 1 / Stage 4 + Issue #34 α（2026-04-30 自宅PC 実装）**: MVP 6 tools + kill switch (a)+(b) 実装完了。

| # | Tool | 承認方式 | 実装 |
|---|---|---|---|
| 1 | `chatwork_list_rooms` | 自動 | ✅ Stage 1 |
| 2 | `chatwork_get_my_mentions` | 自動 | ✅ Stage 4（`force=1` + `lookback_hours` 方式・サンプル3反映） |
| 3 | `chatwork_get_messages` | 自動 | ✅ Stage 4（`force=true` デフォルト・サンプル3反映） |
| 4 | `chatwork_send_message` | 対話確認 (`confirm: true` 必須) | ✅ Stage 4 |
| 5 | `chatwork_mark_as_read` | 自動 | ✅ Stage 4 |
| 6 | `chatwork_get_audit_log` | 自動 | ✅ Stage 4 |

### サンプル3 発見の反映（2026-04-30）

1106PC orchestrator が Issue #33 処理時に発見した重要な API 挙動:

> `?force=0`（未読のみ取得）は1回呼ぶと `last_read_message_id` が前進し、2回目以降の `force=0` は空を返す。すなわち実質「既読化」副作用あり。

これを受けて以下を修正:
- `getMessages(roomId, force=true)` をデフォルトに変更
- `chatwork_get_my_mentions` は `force=1` で叩き、`lookback_hours`（デフォルト 168 = 7日）で時間絞り込み
- `chatwork_get_messages` の `force` デフォルトを `true` に
- 故意の既読化は `chatwork_mark_as_read` を使う設計に統一

未実装（別タスク・[Issue #34](https://github.com/sankaholdings/aieiji-ops/issues/34) で追跡）:
- ~~STOP_KEYWORDS 監視ループ（kill switch (b) Chatwork経由方式）~~ → ✅ 実装完了（2026-04-30 自宅PC）
- ~~Issue #30 への監査ログ書き換えロジック（β）~~ → ✅ 実装完了（2026-04-30 自宅PC・本コミット）
- ~~orchestrator 改修：`processed` ラベル付与時に Issue 自動 close（γ）~~ → ✅ 実装完了（2026-04-30 自宅PC・本コミット）

## 監査ログ自動書き換え（Issue #34 β・2026-04-30 実装）

`src/issue-poster.ts` に実装。`audit.append()` のたびに非同期で GitHub Issue 本文を最新 N 件で上書き反映。

| 項目 | 内容 |
|---|---|
| 書き換え対象 | `AUDIT_GITHUB_REPO` / `AUDIT_GITHUB_ISSUE_NUMBER` (デフォルト `sankaholdings/aieiji-ops` #30) |
| 表示件数 | `AUDIT_GITHUB_POST_LIMIT` (デフォルト 50 件) |
| 実装方式 | `gh issue edit <num> --repo <repo> --body-file -` を `child_process.spawn` で呼び出し |
| 連続呼び出し | 直列化（書き換え中の場合は最後の状態のみが反映される・中間状態をスキップ） |
| 失敗時動作 | 例外握りつぶし・メイン送信フローへの影響なし（fire-and-forget） |
| 無効化 | `AUDIT_GITHUB_POST_ENABLED=false` （デフォルト `true`） |
| 認証 | gh CLI が PATH にあり認証済みの前提（reference_github_auth.md） |

書き換え時の本文構造（Markdown 表）:

```
## 用途
（書き換え方式の説明）

## 表示ルール
- 直近 50 件
- 永続OPEN（CLOSE禁止）
- 最終更新: <ISO timestamp>

## 直近の監査ログ
| timestamp | tool | room_id | status | message_id / reason |
|---|---|---|---|---|
| 2026-04-30T13:55:15.990Z | stop_monitor | 46076523 | blocked | STOP_KEYWORD_DETECTED... |
| 2026-04-30T13:55:07.105Z | chatwork_send_message | 46076523 | success | `2101697397255311360` |
...

## 関連 / 禁則
（Issue 本来の説明・CLOSE 禁止など）
```

## Kill switch (b) STOP_KEYWORDS 監視（Issue #34 α・2026-04-30 実装）

`src/stop-monitor.ts` に実装。MCP サーバー起動時に `StopMonitor` を起動し、マイチャット (room 46076523) を 30 秒間隔でポーリング。

| 項目 | 内容 |
|---|---|
| 監視対象 | `CHATWORK_MYCHAT_ROOM_ID` (= 46076523) |
| ポーリング間隔 | 30 秒 |
| API 呼び出し | `getMessages(roomId, force=true)` （READ-ONLY・既読化副作用なし） |
| 起動時動作 | 最新 message_id を baseline として捕捉。古いメッセージで誤停止しない。 |
| マッチング方式 | `STOP_KEYWORDS` 配列（15 件）と部分一致（大文字小文字無視・前後空白無視） |
| 検知時動作 | 監査ログに `tool: "stop_monitor", status: "blocked"` で記録 → `process.exit(0)` |
| エラー時動作 | 握りつぶしてループ継続（ネットワーク瞬断で停止しない） |
| プロセス生存 | `timer.unref()` で監視タイマーが Node を生存させない（SIGINT/SIGTERM 優先） |

STOP_KEYWORDS 配列（[`src/config.ts`](src/config.ts) で定義）:

```
STOP_AIEIJI / Stop_AIEiji / stop_aieiji / STOP AIEIJI
AIEIJIをとめて / AIEIJIを止めて / AIEijiをとめて / AIEijiを止めて
AIEIJIをストップ / AIEijiをストップ / AIEIJIストップ / AIEijiストップ
ストップAIEIJI / AIEIJI停止 / AIEiji停止
```

新キーワード追加は `src/config.ts` の `STOP_KEYWORDS` を編集して再起動で反映。

## ガード設計（ADR-0009 Decision C）

`chatwork_send_message` のみガード適用。`chatwork_mark_as_read` は監査ログ記録のみで自動承認。

| ガード | 内容 |
|---|---|
| 対話確認 | `confirm: true` を必須化（リテラル）。Claude Code 内で社長に yes/no 確認した上でのみ true を渡す。 |
| 重複防止 | 直近 10 件 (`DUPLICATE_LOOKBACK`) と完全一致する `room_id + body` をブロック。 |
| セッション上限 | プロセス起動から最大 10 件 (`MAX_SESSION_SENDS`)。再起動でリセット。 |
| 連続送信上限 | 同一ルームに連続 2 件まで (`MAX_ROOM_CONSECUTIVE`)。別ルームを挟めばリセット。 |
| Kill switch (a) | `C:\aieiji-ops\PAUSE` 配置で全停止（送信が即時 BLOCKED）。 |
| Kill switch (b) | ✅ 実装済（2026-04-30）。マイチャットに `STOP_AIEIJI` 等のキーワードを送信すると 30 秒以内に MCP プロセスが自己停止。詳細は下記 [Kill switch (b) セクション](#kill-switch-b-stop_keywords-監視issue-34-α2026-04-30-実装)。 |

ガード違反時は `isError: true` で `{ status: "blocked", code, message, hint }` を返し、監査ログに `status: "blocked"` で記録。

## 監査ログ

- ローカル: `C:\aieiji-ops\logs\chatwork_audit.jsonl` (JSONL 永続)
- 1 行 = 1 イベント（`chatwork_send_message` / `chatwork_mark_as_read` の success/blocked/error）
- フィールド: `timestamp` / `tool` / `room_id` / `body` / `message_id` / `status` / `reason`
- GitHub Issue #30 への書き換え反映は別タスク（未実装）

## 稼働環境

- **実行ホスト**: 1106PC（Tailscale IP `100.104.151.97`）
- **ポート**: 3000（HTTP Streamable）
- **アクセス経路**: Tailscale private network経由のみ
- **エンドポイント**: `http://100.104.151.97:3000/mcp`
- **ヘルスチェック**: `http://100.104.151.97:3000/health`

## セットアップ（1106PC側）

```powershell
cd C:\aieiji-ops\mcp-servers\chatwork

# .env 作成（既存 orchestrator/.env からトークンコピー）
copy .env.example .env
# → .env を編集して CHATWORK_API_TOKEN を実値に
#   CHATWORK_MY_ACCOUNT_ID は空でもOK（起動時に GET /me で自動取得）

# 依存インストール
npm install

# 開発起動（tsx watch）
npm run dev

# 本番起動
npm run build
npm start

# 型チェックのみ
npm run typecheck
```

## クライアント設定（自宅PC / 職場PC）

aieiji-ops repo ルートに `.mcp.json` を配置（Stage 5 で追加予定）:

```json
{
  "mcpServers": {
    "chatwork": {
      "type": "http",
      "url": "http://100.104.151.97:3000/mcp"
    }
  }
}
```

## 動作確認手順（疎通テスト）

1. 1106PC で `npm run dev` 起動
2. ヘルスチェック: `curl http://100.104.151.97:3000/health` → JSON 返却確認
3. 自宅/職場 PC の Claude Code で `.mcp.json` を読み込ませて `/mcp` で接続確認
4. `chatwork_list_rooms` でルーム一覧取得 → 既存 v3 と整合する内容か確認
5. `chatwork_get_my_mentions` で自分宛 To: 抽出 → 期待件数か確認
6. `chatwork_send_message` を **テスト用ルーム** で `confirm: true` で送信 → 送信成功 + 監査ログに `status: "success"` 記録確認
7. 同じ内容を再送 → DUPLICATE でブロックされ `status: "blocked"` 記録確認
8. `chatwork_get_audit_log` で監査ログ取得 → JSONL の中身が見えるか確認
9. **Kill switch (b) テスト**: マイチャット (room 46076523) に `STOP_AIEIJI` を送信 → 30 秒以内に 1106PC のサーバーログに `[stop-monitor] STOP_KEYWORD detected` が出力され `process.exit(0)` で停止することを確認。`/health` 応答が無くなる（接続拒否）ことで停止確認可能。

## 関連ドキュメント

- [ADR-0009](../../docs/ADR/0009-chatwork-bidirectional.md) — 設計の正本
- [Issue #30](https://github.com/sankaholdings/aieiji-ops/issues/30) — 監査ログ（書き換え運用）
- [Issue #28](https://github.com/sankaholdings/aieiji-ops/issues/28) — 体感サンプル蓄積チェックリスト
