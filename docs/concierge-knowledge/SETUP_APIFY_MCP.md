# AIEijiConcierge への Apify MCP 接続手順

最終更新: 2026-04-27
対象Project: **AIEijiConcierge**（claude.ai Projects）
追跡Issue: #15

---

## 全体フロー

```
[1] Apifyアカウント作成
  ↓
[2] APIトークン取得
  ↓
[3] AIEijiConcierge に Apify MCPコネクタ追加
  ↓
[4] Knowledge 4ファイル + 本書をアップロード
  ↓
[5] 動作確認（TripAdvisor検索テスト）
```

---

## [1] Apifyアカウント作成

1. https://apify.com/ にアクセス
2. 「Sign up」→ メールアドレス登録（Googleアカウント連携可）
3. プラン選択:
   - **Free**: 月$5クレジット相当（試運転に十分）
   - Personal: $49/月（本格運用時）
   - 推奨: まずFreeで動作確認 → 利用頻度を見て判断

## [2] APIトークン取得

1. Apifyログイン後、右上アイコン → **Settings** → **API & Integrations**
2. 「Personal API tokens」→ **Create new token**
3. 名前: `AIEijiConcierge`
4. **トークンをコピー**（表示は1度だけ。1Passwordに保管推奨）

## [3] AIEijiConcierge に Apify MCPコネクタ追加

### A) Apify公式MCPの場合

Apify は MCP サーバーを公式提供しています:
- エンドポイント: `https://mcp.apify.com/`（要確認・公式ドキュメント参照）
- 認証: 上記APIトークン

### B) Claude.ai Projects での設定手順

1. claude.ai を開き、左サイドバー「**プロジェクト**」 → **AIEijiConcierge** を選択
2. プロジェクト画面右側「コネクター」セクション → **コネクタを追加**
3. **Apify** を選択（または「カスタムMCP」でURL/トークン手入力）
4. APIトークンを貼り付け
5. 接続確認 → 利用したいActor（TripAdvisor / Booking.com等）を有効化

### C) 利用するActor候補

| Actor | 用途 | 検索キーワード |
|---|---|---|
| TripAdvisor Reviews Scraper | 観光地・レストラン評価 | `tripadvisor` |
| Booking.com Hotels Scraper | 海外ホテル検索 | `booking` |
| 楽天トラベル系Actor | 国内ホテル | `rakuten travel` |
| OpenTable Scraper | レストラン予約 | `opentable` |

※ Actor名・利用条件は時期により変わるため、Apify Storeで都度確認: https://apify.com/store

## [4] Knowledge アップロード

AIEijiConcierge プロジェクト画面の **Knowledge** セクションに以下4ファイルをアップロード:

- `01_memberships.md`
- `02_travel_prefs.md` ← **記入後アップロード**
- `03_tower_mission.md` ← **記入後アップロード**
- `04_companies.md` ← **追記後アップロード**

> 02-04 は社長記入待ちのテンプレ。空のままアップロードしてもConciergeは動くが、提案精度が下がる。

## [5] 動作確認

AIEijiConcierge を開き、新規チャットで以下を試す:

```
広島市内でTripAdvisor評価4.5以上のレストラン、夜営業しているところを5つ教えて
```

期待動作:
- Apify Actor 経由でTripAdvisorをスクレイプ
- 評価・営業時間・価格帯を整理して提示
- 私の好み（02_travel_prefs.md）に合わせた絞り込み

エラー時:
- コネクタ認証エラー → APIトークン再確認
- Actor実行エラー → Apifyダッシュボードでクレジット残高確認

---

## トラブルシューティング

### コネクタが追加できない
- claude.ai のPro/Max プランが必要な可能性あり（要確認）
- ブラウザキャッシュクリア → 再ログイン

### Apifyクレジット枯渇
- Free $5は月初リセット
- 高頻度実行時は$49/月のPersonalプラン検討

### Actor が古い・動かない
- Apify Storeで代替Actorを検索（同じサービス対応版が複数ある）

---

## 関連ドキュメント

- ADR-0003: `docs/ADR/0003-concierge-phase2.md`
- 進捗追跡: Issue #15
- 全体方針: ADR-0001 / ADR-0002
