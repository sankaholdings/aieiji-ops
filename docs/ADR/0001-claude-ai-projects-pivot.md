# ADR-0001: Claude.ai Projects 中心主義への転換

- **Status**: Accepted（一部 ADR-0002 により改訂）
- **Date**: 2026-04-24
- **Decider**: 三箇栄司

## Context（背景）

2026-04-24時点で、AIEiji運用には以下の過剰設計が積み重なっていた：

1. **3PC同一環境化**: 自宅Fujitsu(D:) / 職場PC(E:) / 1106PC(G:) の `.claude` ディレクトリ・settings・memory を junction やコピーで揃える試み。複雑性が高く同期事故が頻発。
2. **GASパイプライン**: Chatwork_Inbound / Chatwork_Outbound / Gmail_Inbound の3つのGoogle Apps Scriptトリガー。2026-04-23に Chatwork連投事故 を引き起こした。
3. **AIEijiチーム分割（ペルソナ運用）**: COO / 秘書 / SE / CFO / Concierge という5ロールに分割し、引継書・Agent_Roster・ロール復帰プロトコルで橋渡しを試みていた。

根本原因: **Claude Code は「その場・そのPC・そのセッション」で完結する作業ツール**であり、会話の継続をPC間で引き継ぐ設計ではない。この限界を人力で埋めようとしていた。

一方で、Claude.ai Projects は**URLを開くだけで全端末同期**する仕組みを最初から持っており、目的（会話継続）を直接叶えられる。

## Decision（決定）

**Claude.ai Projects を会話の本拠地に据える**運用に転換する。

### 廃止
- 3PC同一環境化（junction・settings同期・WIP.md・引継書）
- GASパイプライン（Chatwork_Inbound / Outbound / Gmail_Inbound）— 完全停止・再構築しない
- Agent_Roster.md / ロール復帰プロトコル / 引継書文化
- AIEijiチームのペルソナ分割（※ ADR-0002 で部分的に巻き戻し）

### 残す（最小インフラ）
- Claude.ai Projects（会話の本拠地）
- Google Drive（ファイル置き場）
- 1106PC orchestrator + aieiji-ops（自律実行バス）
- Claude memory（Claude Code利用時の方針メモ用途のみ）

## Consequences（結果）

### 良い結果
- 端末間の同期コストがゼロに（Projects側で自動同期）
- Chatwork連投事故の再発リスク除去
- 引継書を書く手間が消滅

### トレードオフ
- Claude Code セッションは使い捨て前提となり、会話の継続は期待できない
- プッシュ通知（Chatwork経由のリマインド）は別途検討が必要

### 留意点
- Claude Code 利用時、社長は必要な文脈をその場で与える運用となる
- memory は「繰り返し使う方針・設定」のみ記録（会話ログ的記録はしない）

## Notes（補足・参考）

- Chatwork連投事故の経緯: memory `project_chatwork_spam_incident_20260423.md`
- 旧設計の正本: `docs/DESIGN_PRINCIPLES.md`（中国モード + 3PCパリティの2大原則は別レイヤーの話）
- **2026-04-27 改訂**: ADR-0002 により「ペルソナ分割の廃止」部分を撤回。インフラ廃止（3PC同期・GAS）は据え置き。
