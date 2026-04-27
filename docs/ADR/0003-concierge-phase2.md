# ADR-0003: AIEijiConcierge Phase 2 着手

- **Status**: Accepted
- **Date**: 2026-04-27
- **Decider**: 三箇栄司
- **Tracked by**: Issue #15

## Context（背景）

ADR-0002 で AIEijiConcierge は既存Projectとして現役運用が確定した。しかし現状は Phase 1（Eiji秘書が内包する形での運用）にとどまり、以下が実装されていない:

- 外部サービス（TripAdvisor / Booking.com / 楽天トラベル / OpenTable）への実データ接続
- 旅行嗜好・タワーミッション等のKnowledge整備
- リアルタイム予約可能性の調査

社長は Hilton Diamond / Eastern Platinum 等の上位ステータスを保有しており、出張・旅行が多い。Phase 2移行による具体的便益が期待できる:

- 上位ステータス維持に必要な「Accor ALL」「Eastern Miles」の予約・搭乗の優先選択判断
- タワーミッションの未訪問リスト管理と移動経路最適化
- 海外出張時の現地レストラン・観光地リアルタイム評価取得

## Decision（決定）

AIEijiConcierge を Phase 2 に昇格させる。具体的には:

### 接続する外部サービス（Apify Actor経由）

- **TripAdvisor** — 観光地・ホテル・レストラン評価
- **Booking.com** — 海外ホテル予約
- **楽天トラベル** — 国内ホテル
- **OpenTable** — レストラン予約

### 別途検討（Phase 2では未着手）

- **Duffel API** — フライト検索・発券（Apify外）
- **中国東方航空** — 公式MCP/APIなし。Qwenアプリ併用継続

### Knowledge 4ファイル

```
01_memberships.md    — 会員ステータス・維持条件
02_travel_prefs.md   — ホテルランク帯・食事嗜好・移動の好み
03_tower_mission.md  — タワー登頂ミッション・既訪問リスト・次の目標
04_companies.md      — よく使う航空会社・ホテルチェーン・優先OTA
```

## Consequences（結果）

### 良い結果
- Conciergeが「考える」から「実データで動く」に進化
- 上位ステータス維持の判断材料がリアルタイム取得可能に
- タワーミッションが構造化される

### トレードオフ
- Apify月額コスト発生（無料枠〜$49/月）
- Apify Actor の維持依存（外部サービスのUI変更で壊れるリスク）

### 役割分担
- **Claude側で完結する作業**: Knowledge下書き作成、ADR記録、Issue追跡
- **社長手作業**: Apifyアカウント作成、APIトークン取得、AIEijiConcierge への MCPコネクタ追加、Knowledgeアップロード

## Notes（補足・参考）

- 追跡Issue: https://github.com/sankaholdings/aieiji-ops/issues/15
- Apify公式: https://apify.com/
- 上位ステータス: memory `user_membership_statuses.md`
- Phase 3（秘書を独立Project分離）は Gmail/Calendar MCP整備のタイミングで再検討（時期未定）
- Phase 4（プッシュ通知 via 1106PC orchestrator → Chatwork）はPhase 2完了後に再着手
