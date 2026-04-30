# AIEijiConcierge Phase 2 — Knowledge アップロード手順

最終更新: 2026-04-27
追跡Issue: #15

---

## 結論：既存ファイルをそのまま使う

`05_Concierge/` に既に充実したコンテンツがあるため、**新規作成せず既存をアップロード**します。

## アップロード対象（最小構成）

claude.ai Projects「AIEijiConcierge」の Knowledge セクションに以下をアップロード:

| ローカルパス | 役割 | 必須度 |
|---|---|---|
| `05_Concierge/Membership_Master.json` | 会員ステータス・特典・予約予定の正本 | 🔴 必須 |
| `05_Concierge/Concierge_Rules.md` | 運用ルール（v1.0） | 🔴 必須 |

## 任意（事例参考）

- `05_Concierge/20260422_東京出張_提案書.md` — 旅程書のフォーマット例
- `05_Concierge/空包射撃_香港_20260615-17.md` — 趣味系旅程の事例

## アップロードしないもの

- `SYSTEM_PROMPT_AIEijiConcierge.md` — これはProject「Custom instructions」欄に貼るもの（Knowledge ではない）
- `Inbox/` `Outbox/` `Scripts/` — 旧パイプライン用、Phase 2では不要

---

## Apify接続

別紙参照: [SETUP_APIFY_MCP.md](SETUP_APIFY_MCP.md)

## 注意

`Membership_Master.json` 内の `C:\ClaudeSync\...` パスは ADR-0001 で退役した旧環境の名残です。Phase 2 運用上は影響なし（Knowledge として読み込まれた時点で内容が参照可能）。

旅行嗜好・タワーミッション等の追加Knowledgeが必要になったら、その時点で別途追加すれば十分です（先回りして空テンプレを作らない）。
