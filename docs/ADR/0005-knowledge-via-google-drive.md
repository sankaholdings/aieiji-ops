# ADR-0005: AIEijiConcierge Knowledge を Google Drive 直読み運用に切り替え

- **Status**: Accepted（実装完了 2026-04-27）
- **Date**: 2026-04-27
- **Decider**: 三箇栄司
- **Related**: ADR-0003（Concierge Phase 2）, Issue #16

## Context（背景）

ADR-0003 で AIEijiConcierge の Knowledge に以下の静的ファイルをアップロードする方針とした:

- `Concierge_Rules.md`
- `Membership_Master.json`

しかし運用してみて以下の問題が判明:

### 問題1: Knowledge更新の手作業負荷
Issue #16（広島ヒルトン誤回答バグ）の修正で `Concierge_Rules.md` を更新した際、claude.ai Knowledge側は手動で旧版削除→新版アップロードが必要。**ファイル更新の度にこの作業を要求するのは現実的でない**。

### 問題2: スナップショット劣化
`Membership_Master.json` には予約予定（`upcoming_flights` / `upcoming_stays`）やポイント残高が含まれる。これらは時間と共に古くなる。Knowledge形式ではローカル更新が反映されず、Conciergeは古いデータで判断するリスクがある。

### Knowledge形式の特性
- claude.ai のファイルKnowledge = アップロード時点のスナップショット
- ローカルの自動同期機能なし
- 容量・件数制限あり

## Decision（決定）

**Knowledge への静的アップロードを廃止し、Google Drive コネクタ経由で直接読み込む運用に切り替える。**

### 実装方針

#### A. Knowledge から既存ファイルを削除
- `Concierge_Rules.md` をKnowledgeから外す
- `Membership_Master.json` をKnowledgeから外す
- **例外**: 中国遠征マニュアル等の固定資料は当面Knowledgeに残す（参照頻度が高く更新頻度が低いため）

#### B. システムプロンプト（手順）に Drive 読込指示を追記
新規チャット起動時に必ず以下のGoogle Driveパスを読み込むよう明記:

```
さんか経営会議（経営分析）/00_System (システム設定)/Claude(SANKA)/05_Concierge/Concierge_Rules.md
さんか経営会議（経営分析）/00_System (システム設定)/Claude(SANKA)/05_Concierge/Membership_Master.json
```

#### C. 前提条件
- AIEijiConcierge に Google Drive コネクタが接続済みであること
- 上記パスが社長のGoogleアカウントから読み取り可能であること

### 残置するKnowledge

- 中国遠征マニュアル（イベント特化・更新頻度低）
- 過去旅程書（事例参考）

これらは更新を意図しないため、Knowledgeのスナップショット運用で問題ない。

## Consequences（結果）

### 良い結果
- **ローカル編集が即座に反映** — `D:\Gドライブ\...` で保存 → Drive同期 → 次回チャットで最新適用
- 手動再アップロード不要
- `Membership_Master.json` のスナップショット劣化問題も同時解決
- 将来 Membership_Master.json をスクリプト等で自動更新する場合もシームレス

### トレードオフ
- 起動時に毎回Drive読込が走るため**応答開始がわずかに遅延**（数秒）
- Drive接続が切れた場合に Concierge が機能不全になる
- システムプロンプトに具体的パス記載が必要（パス変更時はプロンプト更新必須）

### 代替案との比較
- ADR-0003で言及していた **案D（自前MCP構築）** より低コスト・短期実装
- ADR-0003の **案A（手動再アップロード）** より運用負荷が劇的に低い

## Notes（補足・参考）

- 関連: Issue #15（Phase 2追跡）, Issue #16（誤回答バグ修正）
- 実装は社長手作業（A/Bのclaude.ai操作）を伴う。Reality Check（ADR-0004）として、AIEijiConciergeへのDrive接続状況を確認した上で着手すること。
- Phase 4（プッシュ通知）以降、`Membership_Master.json` を自動更新する機構が整えば、本ADRの恩恵が最大化される。
