# Chatwork MCP Server

ADR-0009 で定義された Chatwork 双方向操作の MCP サーバー実装。

## Status

**Phase 1 / Stage 4（2026-04-30 サンプル3 発見反映後）**: MVP 6 tools 実装完了（ガード・監査ログ込み）。

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

未実装（別タスク）:
- STOP_KEYWORDS 監視ループ（kill switch (b) Chatwork経由方式）
- Issue #30 への監査ログ書き換えロジック

## ガード設計（ADR-0009 Decision C）

`chatwork_send_message` のみガード適用。`chatwork_mark_as_read` は監査ログ記録のみで自動承認。

| ガード | 内容 |
|---|---|
| 対話確認 | `confirm: true` を必須化（リテラル）。Claude Code 内で社長に yes/no 確認した上でのみ true を渡す。 |
| 重複防止 | 直近 10 件 (`DUPLICATE_LOOKBACK`) と完全一致する `room_id + body` をブロック。 |
| セッション上限 | プロセス起動から最大 10 件 (`MAX_SESSION_SENDS`)。再起動でリセット。 |
| 連続送信上限 | 同一ルームに連続 2 件まで (`MAX_ROOM_CONSECUTIVE`)。別ルームを挟めばリセット。 |
| Kill switch (a) | `C:\aieiji-ops\PAUSE` 配置で全停止（送信が即時 BLOCKED）。 |
| Kill switch (b) | STOP_KEYWORDS 監視（**未実装**・別タスク）。 |

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

## 関連ドキュメント

- [ADR-0009](../../docs/ADR/0009-chatwork-bidirectional.md) — 設計の正本
- [Issue #30](https://github.com/sankaholdings/aieiji-ops/issues/30) — 監査ログ（書き換え運用）
- [Issue #28](https://github.com/sankaholdings/aieiji-ops/issues/28) — 体感サンプル蓄積チェックリスト
