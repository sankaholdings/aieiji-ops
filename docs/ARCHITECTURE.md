# AI EIJI アーキテクチャ

AI EIJI は、社長の指示を複数のAIエージェントに分担させ、1106PC上で自律実行する多重エージェント体制である。本ドキュメントはコンポーネント間の関係を Mermaid 図で可視化する。

## 1. コンポーネント一覧

| コンポーネント | 実体 | 役割 |
|---|---|---|
| AIEiji秘書 | claude.ai（スマホ/Web） | 社長との自然言語対話、GitHub Issue化 |
| AIEijiCFO | claude.ai + MF会計MCP | 会計・財務判断、仕訳起票 |
| AIEijiSE | 1106PC上の Claude Code（headless） | スクリプト実装、インフラ構築、自動化 |
| GitHub Issues | `sankaholdings/aieiji-ops` | 作業指示バス（キュー兼監査証跡） |
| 1106PC | 自宅・24h稼働 Windows機 | `orchestrator.ps1` 実行環境 |
| Chatwork | マイチャット（room 46076523） | 通知・承認要求・社長入力チャネル |

## 2. 全体構成

```mermaid
flowchart TD
    Pres([社長])
    CW[(Chatwork<br/>マイチャット)]
    Hisho[AIEiji秘書<br/>claude.ai]
    CFO[AIEijiCFO<br/>claude.ai + MF会計MCP]
    Issues[(GitHub Issues<br/>aieiji-ops)]
    PC[1106PC<br/>Windows・24h稼働]
    Orch[orchestrator.ps1<br/>10分毎ポーリング]
    SE[AIEijiSE<br/>Claude Code headless]
    Repo[(aieiji-ops<br/>リポジトリ)]
    MF[(MF会計API)]

    Pres -->|日本語指示| Hisho
    Pres -->|会計相談| CFO
    Pres <-->|通知・応答| CW

    Hisho -->|Issue作成| Issues
    CFO -->|仕訳起票| MF
    CFO -->|SE作業依頼| Issues

    PC --> Orch
    Orch -->|auto-process Issue取得| Issues
    Orch -->|プロンプト投入| SE
    SE -->|ファイル変更・commit・push| Repo
    SE -->|結果| Orch
    Orch -->|完了/失敗通知| CW
    Orch -->|コメント・ラベル更新| Issues
```

## 3. Issue処理フロー

`orchestrator.ps1` は 10 分毎にタスクスケジューラから起動され、`auto-process` ラベル付き Issue を処理する。

```mermaid
sequenceDiagram
    participant Sec as AIEiji秘書
    participant GH as GitHub Issues
    participant Orch as orchestrator.ps1
    participant CC as Claude Code (AIEijiSE)
    participant CW as Chatwork

    Sec->>GH: Issue作成 (auto-process)
    loop 10分毎
        Orch->>GH: Open Issue 取得
        alt PAUSE ファイル存在
            Orch-->>Orch: 即終了
        else needs-approval ラベル
            Orch->>CW: 承認待ち通知
        else 未処理
            Orch->>GH: in-progress ラベル付与
            Orch->>CC: プロンプト投入（Issue本文）
            CC->>CC: ファイル変更 / commit / push
            CC-->>Orch: 結果JSON
            alt 成功
                Orch->>GH: ✅コメント + processed ラベル
            else 失敗
                Orch->>GH: ❌コメント + failed ラベル
                Orch->>CW: [warn] 失敗通知
            end
        end
    end
```

## 4. ラベルのライフサイクル

```mermaid
stateDiagram-v2
    [*] --> auto_process: 秘書がIssue作成
    auto_process --> in_progress: orchestrator検知
    in_progress --> processed: 正常完了
    in_progress --> failed: 例外発生

    auto_process --> needs_approval_skip: needs-approval 同時付与
    needs_approval_skip --> [*]: Chatwork通知のみ

    processed --> [*]
    failed --> [*]
```

## 5. 責任分界

| レイヤ | 担当 | 代表成果物 |
|---|---|---|
| 指示 | 社長 → 秘書 | GitHub Issue |
| 分類・起票 | AIEiji秘書 / CFO | Issue 本文・ラベル |
| キュー | GitHub Issues | `auto-process` ラベル |
| 実行 | AIEijiSE（1106PC） | コミット・PR・スクリプト |
| 監視・通知 | orchestrator + Chatwork | `Action_Log.md`・Chatwork投稿 |

## 6. 安全装置

| 機構 | 実装場所 | 効果 |
|---|---|---|
| Kill switch | `C:\aieiji-ops\PAUSE` | ファイル存在で即終了 |
| ラベル制限 | `orchestrator.ps1` | `auto-process` のみ処理 |
| 承認フロー | `needs-approval` ラベル | 実行せず Chatwork 通知 |
| 冪等性 | `processed` / `in-progress` ラベル | 二重処理防止 |
| Mutex | `Global\AIEiji_AieijiOps_Mutex` | Action_Log 書込排他 |
| 監査証跡 | `logs/Action_Log.md` + Issue コメント | 全操作の追跡可能性 |

## 7. 参照

- [`README.md`](../README.md) — リポジトリ概要
- [`orchestrator/README.md`](../orchestrator/README.md) — orchestrator 詳細
- [`.github/ISSUE_TEMPLATE/se_workorder.md`](../.github/ISSUE_TEMPLATE/se_workorder.md) — SE作業指示テンプレ
