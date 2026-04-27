# CLAUDE.md — aieiji-ops プロジェクトのClaude Code向け指示

> このファイルは Claude Code が当リポジトリ配下で動作する際に**必ず最初に読む**ファイルです。
> 1106PC上のorchestrator経由で実行されるClaude Codeも含みます。

## 必読ドキュメント（順序厳守）

1. **[docs/DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md)** — 全システム設計の前提原則
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — システム全体構成
3. 該当Issueの内容と関連コメント

## 行動原則

- **設計原則を守らない実装を作らない**。設計原則違反に気づいたら、実装を止めて社長に報告する
- 不確実なことは「不明」と明示し、推測で進めない
- 過剰設計を避ける。シンプルな解決策を選ぶ
- 完了報告には「中国モードで動くか」「3PC全てで動くか」を必ず含める

## リポジトリの役割

- GitHub Issuesによる業務指示バス
- 1106PCのorchestrator.ps1が10分毎にpolling
- `auto-process` ラベル付きIssueを自動処理
- 処理結果は `processed` ラベル + コメントで報告
