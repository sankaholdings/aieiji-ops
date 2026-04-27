# ADR-0006: 中国運用時のフォールバック戦略（5月遠征準備）

- **Status**: Accepted（実装は社長作業＋追加検討あり）
- **Date**: 2026-04-27
- **Decider**: 三箇栄司
- **Related**: `docs/DESIGN_PRINCIPLES.md` 原則1（中国モード前提）, ADR-0003, ADR-0005

## Context（背景）

DESIGN_PRINCIPLES.md 原則1により、すべての重要システムは Plan A（VPN）/ Plan B（VPN死亡時）の二段構えを持つことが要求されている。

しかし2026-04-27に完成した AIEijiConcierge Phase 2 は **Plan A 完全依存**である。Plan B が存在しない:

| 構成要素 | 中国本土からの可用性（VPN死亡時） |
|---|---|
| claude.ai（Concierge本体） | ❌ 完全ブロック |
| Google Drive（Knowledge参照） | ❌ 完全ブロック |
| Booking.com / Tripadvisor / Resy / Viator コネクタ | ❌ claude.ai経由のため使用不可 |
| GitHub（ADR・ドキュメント） | ⚠️ 不安定 |

社長は2026-05-08〜05-19に中国遠征（11泊・5都市）を予定。期間中にVPN障害が発生すれば、Conciergeは完全に機能停止する。

## Decision（決定）

5月遠征に向けて以下のフォールバック戦略を採用する。**Conciergeの中国ネイティブ再構築は行わず**、既存資産＋運用工夫で乗り切る。

### Plan B-1: 出発前準備（Pre-Trip Bundle）

中国渡航前（5/7まで）に、Conciergeで以下を生成してローカル保存：

- **完全旅程書**（11日分・各日のホテル・移動・推奨レストラン・観光プラン）
- **Membership_Master.json のオフライン版**（PDF or Markdown）
- **Concierge_Rules.md の現行版コピー**
- **緊急時連絡先リスト**（各ホテルの公式予約番号・領事館等）

保存先: 自宅Fujitsu（中国持参PC）の `D:\Gドライブ\さんか経営会議（経営分析）\05_China_Trip_2026.05_Offline\`
（Google Drive同期前提だが、**ローカル実体**で持参すること。Drive不可状態でも `D:` ドライブから読める）

### Plan B-2: 中国滞在中の代替AI（Qwen運用）

claude.ai が使えない期間は **Qwen（通义千问）** で代替:

- 上記オフラインバンドルの内容をQwenに貼り付けて文脈構築
- 例: 「以下の旅程と会員ステータスを前提に、上海で評価の高い和食レストランを5つ提案して」
- 中国国内ローカル知識はむしろQwenの方が強い領域もある

### Plan B-3: 1106PC を Chatwork経由で叩く（最後の砦）

VPN・Qwen両方ダメな緊急時：

- Chatwork（中国本土でも基本動く）→ 1106PC orchestrator
- aieiji-ops に Issue を発行（`auto-process` ラベル）
- 1106PC が claude.ai（日本側VPN不要）を叩いて結果をChatworkに返す
- 既存 orchestrator インフラがそのまま使える

ただし1106PC への Tailscale接続自体がGFWの影響を受ける可能性があるため、**最後の砦扱い**で常用しない。

### 範囲外（今回はやらない）

- ❌ Concierge を Qwen + 中国クラウドで再構築（コスト過大・効果不明）
- ❌ Gitee へのADRミラー（GitHub不安定だが完全ブロックではないため当面不要）
- ❌ Apify利用（ADR-0003で保留決定済み）

これらは将来必要性が顕在化したら別ADRで再検討。

## Consequences（結果）

### 良い結果
- 5月遠征で VPN障害が起きても**最低限の業務継続**が可能
- 既存資産（1106PC orchestrator・Chatwork・Qwen）の活用
- 新規開発コストゼロ

### トレードオフ
- 完全な Concierge体験は中国では得られない（リアルタイム検索不可・予約UI不可）
- 出発前準備の手間（Plan B-1）が発生
- 緊急時の Chatwork → 1106PC ルートは未テスト

### 必須前提条件の確認状況（2026-04-27時点）

- [x] **良之助VPN**: ✅ 全PC・全用途で設定済み（社長確認済）
- [x] **Chatwork**: ✅ 中国本土で問題なく使用可能（過去実績）
- [ ] **Qwen アプリ**: ⚠️ 要追加検討
  - 国際版（Qwen International）と中国国内版で**機能・回答品質に差**がある
  - どちらをメインにするか・併用するかは別途検討が必要
  - 5月遠征前に使い比べての方針確定が望ましい
- [x] **1106PC Tailscale接続**: ✅ 動作確認済（2026-04-27 自宅Fujitsuから疎通確認）
  - Tailscale IP: 100.104.151.97（1106miniPCforTV）
  - SSH鍵認証ログイン成功（sshuser@）
  - ping RTT: 102-442ms（変動あり、Tailscale経由で安定接続）
  - **注意**: 職場PC（desktop-829prkv / 100.79.138.25）は4日offline。出張時はFujitsu持参のため影響なし
  - **中国本土からの接続は未テスト**（5月遠征時に実機検証必要）

## Notes（補足・参考）

- 関連ドキュメント:
  - `docs/DESIGN_PRINCIPLES.md` 原則1
  - memory `project_china_mode_principle.md`
  - ADR-0003: Concierge Phase 2構成（Plan A本体）
  - ADR-0005: Google Drive直読み（Plan A前提）
- 5月遠征の詳細は claude.ai Knowledge の「2026.05 中国遠征：戦略実行マスターマニュアル」参照
- 帰国後（5/20以降）に本ADRの実効性をレトロスペクティブし、必要なら ADR-0007 で改善版を策定
