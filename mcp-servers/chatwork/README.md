# Chatwork MCP Server

ADR-0009 で定義された Chatwork 双方向操作の MCP サーバー実装。

## Status

**Phase 1 / Stage 1（2026-04-29）**: スケルトン + 1 tool（`chatwork_list_rooms`）疎通確認版。

残り5 tools（`get_my_mentions` / `get_messages` / `send_message` / `mark_as_read` / `get_audit_log`）は次回セッションで実装予定。

## 稼働環境

- **実行ホスト**: 1106PC（Tailscale IP `100.104.151.97`）
- **ポート**: 3000（HTTPストリーマブル）
- **アクセス経路**: Tailscale private network経由のみ
- **エンドポイント**: `http://100.104.151.97:3000/mcp`

## セットアップ（1106PC側）

```powershell
cd C:\aieiji-ops\mcp-servers\chatwork

# .env 作成（既存 orchestrator/.env からトークンコピー）
copy .env.example .env
# → .env を編集して CHATWORK_API_TOKEN を実値に

# 依存インストール
npm install

# 開発起動（tsx watch）
npm run dev

# または本番起動
npm run build
npm start
```

## クライアント設定（自宅PC / 職場PC）

aieiji-ops repo ルートの `.mcp.json`（後で追加）に：

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

## 関連ドキュメント

- [ADR-0009](../../docs/ADR/0009-chatwork-bidirectional.md) — 設計の正本
- [Issue #30](https://github.com/sankaholdings/aieiji-ops/issues/30) — 監査ログ（書き換え運用）
