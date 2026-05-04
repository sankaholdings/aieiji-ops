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
- [x] **Qwen アプリ**: ✅ 評価完了（2026-05-04 govcheck セッション）
  - 国際版（Qwen International）と中国国内版で**機能・回答品質に差**がある
  - **採用方針**: **併用・国際版メイン**
  - 詳細: 後述「Qwen 評価結果サマリ（2026-05-04）」
- [x] **1106PC Tailscale接続**: ✅ 動作確認済（直近2026-04-28夜 自宅Fujitsu再確認）
  - Tailscale IP: 100.104.151.97（1106miniPCforTV）
  - SSH鍵認証ログイン成功（sshuser@）
  - ping RTT: 102-442ms（変動あり、Tailscale経由で安定接続）
  - 1106PCは ADR-0008 監査で2タスク稼働中と判明（Orchestrator + GmailThreadWatcher）
  - **注意**: 職場PC（desktop-829prkv / 100.79.138.25）は業務終了で適宜offline。出張時はFujitsu持参のため影響なし
  - **中国本土からの接続は未テスト**（5月遠征時に実機検証必要）

## Notes（補足・参考）

- 関連ドキュメント:
  - `docs/DESIGN_PRINCIPLES.md` 原則1
  - memory `project_china_mode_principle.md`
  - ADR-0003: Concierge Phase 2構成（Plan A本体）
  - ADR-0005: Google Drive直読み（Plan A前提）
- 5月遠征の詳細は claude.ai Knowledge の「2026.05 中国遠征：戦略実行マスターマニュアル」参照
- 帰国後（5/20以降）に本ADRの実効性をレトロスペクティブし、必要なら ADR-0007 で改善版を策定

---

## 中国遠征中の障害判断フロー（2026-05-04 govcheck セッション追加）

中国滞在中（2026-05-08〜2026-05-20）に何かが落ちた時の **症状 → 切り分け → 対処** マッピング。疎通テスト手順は別ファイル `Claude(SANKA)/05_Concierge/China_Trip_2026.05_Prep/From_China_Connectivity_Test.md` を参照（Phase 1-4 の段階的検証手順）。

### 症状別判断表

| # | 症状 | 切り分け | 対処 |
|---|---|---|---|
| 1 | claude.ai が応答しない | スマホ別経路で claude.ai → 良之助 VPN ON/OFF・別 VPN 試行 | Plan A 死亡 → Plan B-2 (Qwen 国際版) へ切替・Plan B-1 出発前バンドル参照・緊急時 Plan B-3 |
| 2 | Tailscale で 1106PC `/health` NG | ① 良之助 VPN ON で再試行 → ② `tailscale status` 再確認 → ③ Phase 1-3 順次 (`From_China_Connectivity_Test.md`) | GFW 影響なら VPN ON で回避・Tailscale 完全死なら Plan B-3 (Chatwork → orchestrator)・全部 NG なら Plan B-1 単独 |
| 3 | nssm `AIEijiChatworkMCP` 応答なし | SSH ejsan@100.104.151.97 で `Get-Service AIEijiChatworkMCP` | `Stopped` なら `Restart-Service AIEijiChatworkMCP`・SSH 自体 NG なら #4 へ |
| 4 | 1106PC orchestrator も応答なし | Tailscale 不通 + Chatwork Issue も 10 分以内に処理されない | 1106PC 完全死 = 帰国まで諦め・Plan B-1 + Qwen のみ運用・帰国後 RDP/物理アクセスで復旧 |
| 5 | claude.ai アカウントロック | account.anthropic.com で「異常アクセス検知」表示 | 中国遠征中はよくある（DESIGN_PRINCIPLES 原則1）・Plan B-2 (Qwen 国際版) でしのぐ・帰国後ロック解除 |
| 6 | Chatwork も中国本土でブロック | 滞在地 ISP 切替・WeChat/DingTalk が通るか | Plan B-1 ローカルバンドルのみで凌ぐ・連絡は WeChat 経由・帰国まで業務メール閲覧のみ |
| 7 | Gmail/Drive のみブロック | claude.ai は通る + Gmail/Drive のみ NG → Google 中国 IP 検知 | Google security ページで「最近のセキュリティイベント」確認・SMS 2 段階認証 SMS が中国 SIM に届くか別経路で確保 |

### 中国遠征中の SSH ワンライナー（暗記推奨）

```bash
# 1106PC chatwork-mcp 状態確認
ssh ejsan@100.104.151.97 'powershell -NoProfile -Command "Get-Service AIEijiChatworkMCP | Select Name,Status,StartType"'

# nssm 再起動（chatwork-mcp 復旧）
ssh ejsan@100.104.151.97 'powershell -NoProfile -Command "Restart-Service AIEijiChatworkMCP"'

# orchestrator のラスト処理確認
ssh ejsan@100.104.151.97 'powershell -NoProfile -Command "Get-Content C:\aieiji-ops\logs\Action_Log.md -Tail 20"'

# Tailscale 状態（1106PC 側）
ssh ejsan@100.104.151.97 'tailscale status'
```

### 持参すべきローカルファイル（D: ドライブ・2026-05-04 Reality Check 済の正確なパス）

中国遠征出発前 (5/7) までに D: ドライブ実体で確保（Drive 同期前提でもローカル実体必須）:

| パス | 用途 |
|---|---|
| `D:\Gドライブ\さんか経営会議（経営分析）\00_System (システム設定)\Claude(SANKA)\05_Concierge\China_Trip_2026.05_Prep\` | Plan B-1 出発前バンドル本体（PlanB1_Bundle.md / 2026.05_China_Master_Manual.md / From_China_Connectivity_Test.md / Qwen_Evaluation_Checklist.md / PlanB1_Concierge_Prompt.md） |
| 同上 `\.claude-memory\` | memory junction の Drive 実体（Plan B 中も memory 参照可） |
| 同上 `\CLAUDE.md` | ガバナンス原則・接続経路一覧 |
| 同上 `\05_Concierge\Membership_Master.json` | 会員ステータス（Concierge Phase 2 知識ベース）⚠️ パスは `05_Concierge/` 配下（`02_CFO/` ではない・Reality Check 済） |
| 同上 `\05_Concierge\Concierge_Rules.md` | Concierge 運用ルール |

### Plan B-3 緊急時の Chatwork 経由 1106PC 操作

1. 中国側 PC・スマホから Chatwork でマイチャット (room_id 46076523) を開く
2. aieiji-ops に Issue を発行（自動 Issue 起票構成は ADR-0009 参照）
3. もしくは GitHub web (まれに通る) から直接 `auto-process` ラベル付き Issue 起票
4. 1106PC orchestrator が 10 分以内に拾って処理・コメント返信
5. 結果を Chatwork で受信

## Qwen 評価結果サマリ（2026-05-04 govcheck セッション）

実旅程（5/8〜5/19 上海→西寧→敦煌→ウルムチ→成都→上海）ベースの 5 テスト（高鉄予約 / MUプラチナ升艙券 / 天山天池視察 / 広島ヒルトン既知答え / 上海長寧区居留許可管理局）を国際版・中国版両方に投入し比較評価。

### 採用方針: **併用・国際版メイン**

| 用途 | 採用版 |
|---|---|
| ルール解釈・予約手続き・公式手順理解 | **国際版**（出典付・公式準拠） |
| 既知情報のクロスチェック・前提誤認の訂正 | **国際版** |
| 固有名詞・住所・ホテル名の確定 | **両版とも単独使用禁止** — 艶艶氏 / 各社公式アプリ / 物理現場で確認 |
| 現地アプリ操作方法（12306/MU/Hilton/Accor） | **中国版**サブ + 国際版でクロス検証 |
| 旅程提案・選択肢生成（発想出し） | 両版併用 + 必ず別ソース検証 |
| 業務情報（顧客・財務）入力 | **禁止**（本ADR既定方針） |

### 国際版の優位

- 公式情報源リンク多数（ceair.com / hiltonjapan.co.jp / 中国政府网 等）
- 升艙券ルール解釈が東航公式準拠（テスト2）
- ハルシネーション抑制が効く（テスト4 で「2023年開業」前提を「2022年10月開業・2023年5月会議施設稼働」と訂正）
- フライト情報の数値正確性（MU6411 15:05→18:40 はマスターマニュアル記載と一致）

### 中国版の致命的弱点

- **ユーザー前提に引きずられて事実を捏造する傾向**: テスト4 で「2023年開業の広島ヒルトン」を聞かれ、ヒルトン広島の正解（2022年）を知っているのに**シェラトン広島・架空住所・架空開業日を捏造**して回答
- 出典なしで断定（テスト3「5/15 雨予報」「2026年入場料無料キャンペーン」など、未来情報をハルシネーション）
- 升艙券ルール誤認（テスト2「7日前〜3時間前で即時アップグレード」「ビジネスクラス枠 40kg/2個」は東航規約と異なる）
- 価格情報の食い違い（テスト1 西寧→敦煌1等座が国際版¥441 vs 中国版¥866）

### 中国版の強み

- 現地アプリ機能の細部（12306 座席選択 A/F席窓側、状態表示灯）
- 元建価格を明示（国際版は通貨単位「¥」が円か元か曖昧）
- 現地名所固有名詞（馬牙山、定海神針、西王母伝説など）

### VPN 死亡時の運用

- 中国版に切替・**ただし業務判断には使わず、現地アプリ操作確認程度に絞る**
- 緊急時は Plan B-1 出発前バンドル + 1106PC orchestrator + Chatwork

### 詳細評価

ローカル `Claude(SANKA)/05_Concierge/China_Trip_2026.05_Prep/Qwen_Evaluation_Checklist.md` 評価実施記録欄に全テスト結果を記録済み（gitignored・3PC junction で共有）。
