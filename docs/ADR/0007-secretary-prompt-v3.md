# ADR-0007: AIEiji秘書 Custom Instructions v2 → v3 改訂（ADR-0001以後の実態反映 + Chatwork READ自動化）

- **Status**: Accepted
- **Date**: 2026-04-28
- **Decider**: 三箇栄司
- **Related**: ADR-0001（Projects中心主義・GAS全廃）, ADR-0002（ペルソナ復活）

## Context（背景）

AIEiji秘書 Custom Instructions v2（最終更新 2026-04-20）は ADR-0001（2026-04-24・GAS全廃）と ADR-0002（2026-04-27・ペルソナ復活）より前に作成されたため、以下のドリフトが発生していた：

1. **モードA** が「00_Inbox に GAS 経由で自動投下されたファイル」を前提とする記述だったが、GAS パイプラインは ADR-0001 で全廃済み
2. **モードB** が「稼働中のGmailパイプライン (Gmail_Inbound.gs / process_inbox.py / Chatwork_Outbound.gs)」を前提知識として説明していたが、これも全廃済み
3. **モードB** の learned_rules_email.json への自動学習機構（旧 executeBossCommand）も停止済みだが v2 ではまだ運用前提
4. **Chatworkチェック対応** で「Chatworkアプリ/Webを直接開いてください」を第一案にしていたため、社長依頼に対する付加価値が薄く、「秘書としての価値がない」状態（2026-04-28 社長指摘）
5. **モードC** で READ 系（Chatwork通知履歴取得・ステータス確認等）の扱いが不明瞭で、自動化が進まなかった

これらは Issue #17（Chatwork混同バグ）の修正だけでは解決せず、v2 全体のリビジョンが必要だった。

## Decision（決定）

AIEiji秘書 Custom Instructions を v3 に全面改訂する。正本は Google Drive の `06_SE/aieiji_secretary_v2/system_prompt_v3.md`。claude.ai → Projects → 「AIEiji秘書」→ カスタム指示 に全文置換することで本番反映する。

### 主な変更点

| 項目 | v2 | v3 |
|---|---|---|
| モードA 入力元 | 「00_Inbox 自動投下」前提 | **手動アップロード専用**に再定義 |
| モードB 前提知識 | GAS Gmail パイプライン稼働中（誤） | **廃止明記**・手動相談ベース |
| モードB 学習機構 | learned_rules_email.json 自動学習 | **廃止**・手動メンテへ |
| モードC ラベル判定 | READ系の扱い曖昧 | **READ系は `auto-process` のみで OK** と明文化 |
| モードC 認証情報 | 記載なし | CHATWORK_API_TOKEN / GH_TOKEN 等の名称を明記 |
| Chatworkチェック | 第一案: アプリ案内 → 第二案: 起票（許可制） | **第一案: 許可不要で自動Issue起票（READ）、第二案: アプリ案内** |
| 共通禁則 | 死んだパイプライン名を個別列挙 | ADR-0001 参照に集約 |

### 範囲外（別ADR候補）

Chatwork **双方向操作の高度化**（リアルタイム対話・WRITE系の手早い送信・特定メッセージへの返信状態管理・自前 MCP コネクタ等）は v3 のスコープ外。v3 を1〜2週間運用して、社長が「足りない部分」を体感した後に **ADR-0008（仮）** で別途設計する。

想定される将来 Phase（参考）：
- Phase 2: WRITE系 Issue ワークフロー確立（needs-approval経由）
- Phase 3: orchestrator ポーリング高速化（10分→1分 or webhook化）
- Phase 4: メッセージID 状態管理 + 「特定メッセージへの返信」対応
- Phase 5: 自前 Chatwork MCP コネクタ → claude.ai 秘書から直接呼び出し

## Consequences（結果）

### 良い結果
- v2 のドリフト（廃止済みインフラを「稼働中」と教えていた問題）が解消
- 「Chatworkをチェックして」依頼が Issue 経由で自動処理されるようになり、秘書としての付加価値が向上（READ系のみ）
- READ 系タスクの自動化基準が明確化

### トレードオフ
- claude.ai 上の Custom Instructions の手動置換が必要（社長作業）
- Chatworkチェック自動化は **10分以内のレイテンシ**あり（orchestrator のポーリング周期に依存）
- v3 では実現しない理想形（リアルタイム対話完結）への期待値ギャップが残る
- WRITE系（Chatwork メッセージ送信）は引き続き `needs-approval` 必須

### 移行手順

1. ✅ **ローカル正本作成**: `06_SE/aieiji_secretary_v2/system_prompt_v3.md`（本ADR起票時に同時実施）
2. ✅ **退役**: `06_SE/aieiji_secretary_v2/system_prompt_v2.md` を `_Archive_2026-04-28/` へ移動
3. ✅ **メモリ更新**: `project_concierge_deployed.md` の正本ソース記述を v3 に更新
4. ✅ **MEMORY index**: 本ADR-0007 へのリンク追加
5. ✅ **社長手動作業**: claude.ai → Projects → 「AIEiji秘書」→ カスタム指示に v3 全文置換完了（2026-04-28夜 自宅Fujitsuセッションで確認）

### 中国モード考慮（ADR-0006）

Phase 1（v3）の Issue 経由方式は中国でも動作する：
- Chatwork は中国本土でブロックされない
- 1106PC 経由のため claude.ai 不在時でもオペレーション継続可能
- 将来 Phase 5 で MCP コネクタを自作しても、Phase 1-4 経路は中国フォールバックとして残す設計が望ましい

## Notes（補足・参考）

- 関連メモリ: `project_concierge_deployed.md`（v3 移行に伴い「未確認の懸念」セクションは解消）
- 関連 Issue: #17（Chatwork混同バグ・Closed）— v3 で恒久対策完了
- **v3稼働実績**（2026-04-28 動作確認）:
  - Issue #18: 「Chatworkマイチャット最新メッセージ10件取得」→ orchestrator経由で自動処理成功
  - Issue #19: 「Chatwork全166ルームから未読9ルーム72件抽出」→ 51KBレポート生成成功・トークン類は自動REDACTED処理
  - WRITE系（POST /messages）は呼ばれていない（READ専用ルール遵守）
  - 実行コスト: $1.38/セッション程度
  - これにより「Chatworkチェック依頼 → 自動Issue起票 → orchestrator処理 → コメント返信」の完全自動化が成立した
- v3 草案の検討経緯: 2026-04-28 セッション内（社長と対話）
- 次の検討事項: Chatwork 双方向操作の Phase 2-5 ロードマップ → 1〜2週間の運用後に ADR-0008（仮）で議論
