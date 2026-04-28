# ADR-0003: AIEijiConcierge Phase 2 着手

- **Status**: Accepted（2026-04-27 改訂: Apifyから公式コネクタ路線に変更）
- **Date**: 2026-04-27
- **Decider**: 三箇栄司
- **Tracked by**: Issue #15
- **Related**: ADR-0004（本ADR策定中に発生した実態確認漏れへの対策）

## Context（背景）

ADR-0002 で AIEijiConcierge は既存Projectとして現役運用が確定した。Phase 2への移行で外部サービス連携を計画した。

当初想定: Apify Actor経由で TripAdvisor / Booking.com / 楽天トラベル / OpenTable に接続。

**2026-04-27 実態確認結果**: claude.ai にはAnthropic公式の以下コネクタが既に提供されていた:

- **Booking.com**（インタラクティブ）
- **Tripadvisor**（インタラクティブ）
- **Resy**（インタラクティブ）— レストラン予約
- **Viator**（インタラクティブ）— ツアー・体験予約

これらは Apify経由のスクレイピングより安定・高速・無料・UIリッチ。よってApifyは不要となった。

## Decision（決定）

Phase 2 は**公式コネクタのみで構築**する。Apifyは保留（将来必要になった時のため、取得済みトークンは1Passwordに保管）。

### 接続する公式コネクタ

| コネクタ | 用途 |
|---|---|
| Booking.com | 海外ホテル予約 |
| Tripadvisor | 観光地・ホテル・レストラン評価 |
| Resy | レストラン予約 |
| Viator | 観光体験・ツアー予約 |

### Knowledge（既存資産活用）

- `05_Concierge/Membership_Master.json` ← 必須・アップロード済
- `05_Concierge/Concierge_Rules.md` ← 必須・アップロード済
- `2026.05 中国遠征：戦略実行マスターマニュアル` ← 既存・残す

### 公式コネクタで対応できない場合の保険

- **楽天トラベル / OpenTable / Duffel API**: 必要になった時点で再検討
- **Apifyトークン**: 保管継続（楽天トラベル等が必要になった時に活用）
- **中国東方航空**: 公式コネクタなし。Qwenアプリ併用継続

## Consequences（結果）

### 良い結果
- Apify月額コスト発生せず（無料枠ですら使わない）
- 設定がシンプル（ボタンクリックのみ・Bearerトークン管理不要）
- Anthropic保証で動作安定
- インタラクティブUIで提案品質が高い

### トレードオフ
- 公式コネクタの仕様変更時、回避策がない（Anthropic依存）
- 楽天トラベル等は当面手動

### 副次的な学び
- 当初Apify路線で提案・実行を進めたのは**実態確認漏れ**が原因
- ADR-0004（Reality Check Protocol）を本日同時策定し、再発防止

## Notes（補足・参考）

- 追跡Issue: https://github.com/sankaholdings/aieiji-ops/issues/15
- 関連ADR:
  - ADR-0001 / 0002: Projects中心主義とペルソナ復活
  - ADR-0004: 実態確認プロトコル
- Phase 3（秘書を独立Project分離）は Gmail/Calendar MCP整備のタイミングで再検討
- Phase 4（プッシュ通知 via 1106PC orchestrator → Chatwork）はPhase 2完了後
