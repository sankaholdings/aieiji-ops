# Architecture Decision Records (ADR)

このディレクトリは、AIEiji運用に関する**意思決定の永続記録**です。

## 目的

Claude のローカルメモリ（`.claude/memory/`）は端末固有・揮発的で、人間が後から確認しにくい。重要な方針判断は本ディレクトリにADRとして残し、**どの端末・どの人からも参照可能**にする。

## 命名規則

```
NNNN-kebab-case-title.md
```

- `NNNN`: 4桁連番（0001から）
- 小文字ハイフン区切り
- 例: `0001-claude-ai-projects-pivot.md`

## テンプレート

```markdown
# ADR-NNNN: タイトル

- **Status**: Proposed / Accepted / Superseded by ADR-XXXX / Deprecated
- **Date**: YYYY-MM-DD
- **Decider**: 三箇栄司

## Context（背景）
何が問題だったか。何が起きていたか。

## Decision（決定）
何を決めたか。

## Consequences（結果）
良い結果・悪い結果・トレードオフ。

## Notes（補足・参考）
関連Issue・関連ADR・参考資料。
```

## Status の遷移

- **Proposed**: 提案中（未確定）
- **Accepted**: 受諾・実行中
- **Superseded by ADR-XXXX**: 後続ADRに置き換えられた
- **Deprecated**: 廃止（後継なし）

ADRは**追記型**であり、過去の判断を書き換えない。方針が変わった場合は新ADRを起こし、旧ADRのStatusを `Superseded by ADR-XXXX` に更新する。
