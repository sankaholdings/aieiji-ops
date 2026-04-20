# Chatwork_Outbound.gs セットアップ手順（Phase 3）

> AIEiji秘書 ハイブリッド・ループ Phase 3
> 作成: 2026-04-13 AIEijiSE

---

## 前提条件

- Phase 1（Chatwork_Inbound.gs）が動作していること
- スクリプトプロパティに `CHATWORK_API_TOKEN` と `MY_ACCOUNT_ID` が設定済みであること
- Googleドライブ上に 05_Secretary_Outbox フォルダが存在すること

---

## 手順 1: 05_Secretary_Outbox のフォルダIDを取得

1. Googleドライブで `05_Secretary_Outbox` フォルダを開く
   - ClaudeSync のルートフォルダ直下にあるはず
2. ブラウザのアドレスバーからフォルダIDをコピー:
   ```
   https://drive.google.com/drive/folders/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          ここがフォルダID
   ```

---

## 手順 2: マイチャットの room_id を確認

マイチャットの room_id は **46076523** です。
（マイチャットを開くと概要欄に「マイチャット room_id: 46076523」と記載されています）

---

## 手順 3: コードを追加

1. https://script.google.com で Phase 1 のプロジェクト「AIEiji_Chatwork_Secretary」を開く
2. 左サイドバーの「ファイル」横の「＋」→「スクリプト」をクリック
3. ファイル名を `Chatwork_Outbound` に変更
4. `Chatwork_Outbound.gs` の内容をすべて貼り付け
5. Ctrl+S で保存

※ Inbound と Outbound は同一プロジェクト内に共存します

---

## 手順 4: スクリプトプロパティを追加

歯車アイコン（プロジェクトの設定）→「スクリプト プロパティ」に以下を追加:

| プロパティ名 | 値 | 備考 |
|---|---|---|
| `OUTBOX_FOLDER_ID` | 手順1で取得したフォルダID | 必須 |
| `MY_CHAT_ROOM_ID` | `46076523` | 必須 |

※ `CHATWORK_API_TOKEN` と `MY_ACCOUNT_ID` は Phase 1 で設定済みのため追加不要

---

## 手順 5: セットアップ確認

1. GASエディタで関数セレクタから `verifyPhase3Setup` を選択
2. 「実行」をクリック
3. 実行ログで以下を確認:
   - `CHATWORK_API_TOKEN: OK`
   - `OUTBOX_FOLDER_ID: OK`
   - `MY_CHAT_ROOM_ID: OK`
   - `MY_ACCOUNT_ID: OK`
   - `Outboxフォルダ: 05_Secretary_Outbox (アクセスOK)`
   - `マイチャットへのテスト投稿: OK`
4. Chatworkのマイチャットにテストメッセージが届くことを確認

---

## 手順 6: テスト実行（ブリーフィング配信）

1. Googleドライブの `05_Secretary_Outbox` フォルダに `chatwork_reply_draft_*.json` が存在することを確認
   - ローカルの `C:\ClaudeSync\05_Secretary_Outbox\` から同期されたファイル
2. GASエディタで `testDeliverBriefing` を実行
3. Chatworkのマイチャットにブリーフィングが届くことを確認
4. Googleドライブの `05_Secretary_Outbox/Sent` フォルダにJSONが移動していることを確認

---

## 手順 7: テスト実行（コマンド実行）

1. Chatworkのマイチャットで、ブリーフィングの下に以下のいずれかを入力:
   - `全部既読`
   - `Aは案の通り`
   - `Aはこう返して：ありがとうございます！`
   - `既読にして`
2. GASエディタで `testExecuteCommand` を実行
3. マイチャットに「処理完了」の報告が届くことを確認

---

## 手順 8: 定期実行トリガーを設定

時計アイコン（トリガー）→「トリガーを追加」で以下の2つを追加:

### トリガー 1: ブリーフィング配信

| 項目 | 設定値 |
|---|---|
| 実行する関数 | `deliverBriefing` |
| イベントのソース | 時間主導型 |
| 時間ベースのトリガーのタイプ | 分ベースのタイマー |
| 間隔 | **1分おき** |

### トリガー 2: コマンド実行

| 項目 | 設定値 |
|---|---|
| 実行する関数 | `executeBossCommand` |
| イベントのソース | 時間主導型 |
| 時間ベースのトリガーのタイプ | 分ベースのタイマー |
| 間隔 | **1分おき** |

---

## 社長の操作フロー（本番運用）

```
1. COOがローカルで返信案JSONを生成
   → 05_Secretary_Outbox に保存
   → Google Drive 同期

2. GAS（deliverBriefing）が検知
   → マイチャットにブリーフィング配信

3. 社長がスマホのChatworkアプリでマイチャットを確認
   → 指示を返信（例:「Aは案の通り。あとは既読」）

4. GAS（executeBossCommand）が検知
   → Chatwork APIで返信送信 / 既読処理
   → マイチャットに完了報告
```

---

## 使えるコマンド一覧

| コマンド例 | 動作 |
|---|---|
| `全部既読` | 全アイテムを既読にする |
| `既読にして` | 全アイテムを既読にする |
| `Aは案の通り` | Aの返信案をそのまま送信 |
| `Aはそのまま` | Aの返信案をそのまま送信 |
| `Aはこう返して：ありがとう！` | Aにカスタムテキストで返信 |
| `Aは既読のみ` | Aだけ既読にする |
| `Aは案の通り。あとは既読` | Aに返信、残りは既読 |
| `案の通り` | （1件のみの場合）その返信案で送信 |
| `了解` | （1件のみの場合）その返信案で送信 |

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| ブリーフィングが届かない | OutboxにJSONがない | COO側で生成・同期を確認 |
| コマンドが反応しない | MY_ACCOUNT_IDが未設定 | Phase 1の`verifySetup`でID取得→設定 |
| 「該当するコマンドなし」 | コマンド記法が不一致 | 上記コマンド一覧を参照 |
| ドラフトが残り続ける | 前回の処理が中断 | `clearActiveDraft`を実行 |
| 二重送信される | トリガー競合 | トリガー間隔を調整（1分→5分） |

---

## デバッグ関数

| 関数名 | 用途 |
|---|---|
| `debugActiveDraft` | 現在のアクティブドラフト状態を確認 |
| `clearActiveDraft` | アクティブドラフトを手動でクリア |
| `verifyPhase3Setup` | Phase 3プロパティとAPI接続を確認 |

---

*Phase 1〜3 が稼働すると、ハイブリッド・ループの基本サイクルが完成します。*
*Phase 4（LINE連携）は別途構築予定です。*
