# ADR-0002: AIEijiペルソナ分割の現役扱い復帰

- **Status**: Accepted
- **Date**: 2026-04-27
- **Decider**: 三箇栄司
- **Amends**: ADR-0001

## Context（背景）

ADR-0001（2026-04-24）で「AIEijiチーム分割（COO/秘書/SE/Concierge）を廃止し、Eiji 1本に統合」と決定した。しかし2026-04-27に claude.ai を確認したところ、実際のProjectsは以下の通り**全て現役で残っていた**：

- AIEiji秘書
- AIEijiCFO（財務・経営分析）
- AIEijiConcierge（出張・手配担当）
- AIEijiSE（インフラ・自動化担当）
- さんかグループ経営

ADR-0001の「ペルソナ廃止」は概念上の決定にとどまり、実Projectsには反映されていなかった。にもかかわらずローカルメモリ上では「廃止済み」と記録されていたため、本日「Eijiってどこ？」という認識齟齬が発生した。

加えて、Projects単位での役割分離（CFOはMF会計MCP接続、Conciergeは出張系Knowledge等）は **claude.aiの仕組み上自然に機能している**ことが確認された。Knowledge・コネクター設定をProjectごとに分けられるため、概念的に統合する利点が薄い。

## Decision（決定）

**既存4 Projectsをそのまま現役として使い続ける。**

- **AIEiji秘書** = メイン窓口（会話の本拠地・旧構想の「Eiji」役を担う）
- **AIEijiCFO** = 財務・経営分析（MF会計MCP 8社接続）
- **AIEijiConcierge** = 出張・手配（将来的にApify MCP接続予定）
- **AIEijiSE** = インフラ・自動化（aieiji-ops連携）

ADR-0001のうち**「ペルソナ廃止」部分のみ撤回**し、インフラ廃止（3PC同期・GASパイプライン）は据え置く。

## Consequences（結果）

### 良い結果
- 実態とドキュメントが一致
- Project単位のKnowledge・コネクター分離を活用できる
- 「メイン窓口はAIEiji秘書」という運用上のシンプルさは維持

### トレードオフ
- 「Eiji 1本」という当初の単純化目標は達成しない
- ペルソナ間でやりとりが必要な場合、社長が手動でProject切り替え

### 副次的な学び
- **意思決定はメモリではなくADR/Issueに残すべき**だった。メモリは端末固有・点的記録なので「廃止した（つもり）」と「実態」がズレた
- 本ADRディレクトリ自体がこの学びの結果（ADR-README参照）

## Notes（補足・参考）

- ADR-0001 のステータスは「一部 ADR-0002 により改訂」に更新
- 関連メモリ更新: `MEMORY.md` / `project_aieiji_arch.md` / `project_claude_ai_projects_only.md` を本ADRへのポインタ化予定
