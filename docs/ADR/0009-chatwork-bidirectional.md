# ADR-0009: Chatwork双方向操作の段階導入（Phase 2-5 + リアクション）

- **Status**: **Accepted**（2026-04-29 設計フェーズ完了・実装着手待ち）
- **Date**: 2026-04-29
- **Decider**: 三箇栄司（draft段階・論点議論後にAccepted化）
- **Related**:
  - ADR-0001（Projects中心主義・GAS全廃）
  - ADR-0006（中国モードフォールバック）
  - ADR-0007（秘書 v3・Chatwork READ自動化）— 本ADRはPhase 2-5の予告を引き継ぐ
  - ADR-0008（Master Tracker・本ADRをP1へ前倒し）
  - `feedback_premise_check.md`（体感サンプル不足を認識した上で前倒し決定）

## Context（背景）

### 経緯
ADR-0007 で AIEiji秘書 v3 を 2026-04-28 にリリースし、Chatwork **READ系の自動化**（Issue起票→1106PC orchestratorによるAPI取得→コメント返信）が稼働開始。1日経過時点で社長から以下の理想形が提示された：

> チャットボットのやりとりをすることにより、**返信、リアクション付け、スルーを簡単にやりたい**。
> 自分だけにTo:があるものを第一優先し、要約文を提示し、返信するべきものは返信。既読だけでいいのであればリアクションをつけたい。

これは ADR-0007 が予告した「Phase 2-5（双方向化）」+ **リアクション機能（新規追加）** に該当する。ADR-0008 Master Tracker では当初 P2（帰国後5/20以降）に位置付けられていたが、2026-04-29 社長判断で P1（中国遠征中も並行可）へ前倒し決定。

### 既存資産
| 機能 | 状態 | 経路 |
|---|---|---|
| READ（取得・要約）| ✅ 稼働中（Issue #18, #19実証） | claude.ai秘書 → Issue起票 → 1106PC orchestrator(10分poll) → Chatwork API → Issueコメント |
| 既読化（マーク既読）| ✅ 実証済（Issue #21）| 同上 |
| WRITE（メッセージ送信）| ⚠️ `needs-approval` 必須・未実証 | 同上＋承認後に手動でラベル外す |
| リアクション付与 | ❌ 未対応 | - |
| 対話型UI | ❌ ポーリング型のみ | claude.ai秘書では10分待ち発生 |

### 認証情報
- 1106PC: `CHATWORK_API_TOKEN` を保持（READ/WRITE可能）
- マイチャット room_id: 46076523

### 体感サンプル不足の認識（重要）
v3稼働1日のため、READ系で本当にどこが不便かの体感サンプルは未蓄積。本ADRはDraftとして起票し、運用しながら論点を確定させる方針。

---

## Open Questions（議論中の論点・Draft段階）

論点ごとに別Issueを起票して並行議論する（本ADRは議論結果を集約する場）。

### 論点A: 実装アーキテクチャ（WHO + WHERE + HOW）

**問**: 対話型UIをどこで成立させるか？

候補：
1. **claude.ai秘書（Projects）**: 既存だが10分polling不可避
2. **Claude Code（自宅/職場PC）**: 対話即時・但し常駐性なし
3. **1106PC orchestrator拡張**: 既存資産活用・但し対話型でない
4. **自前Chatwork MCPサーバー（1106PC常駐）**: 全要件満たすが実装工数大

→ **議論Issue: #27**

### 論点B: 段階性（Phase 2-5 + リアクション統合方針）

**問**: ADR-0007が予告した5段階（Phase 2/3/4/5）と、新規追加の「リアクション」をどう統合するか？

ADR-0007が予告した順序：
- Phase 2: WRITE系 Issue ワークフロー確立（needs-approval経由）
- Phase 3: orchestrator ポーリング高速化（10分→1分 or webhook化）
- Phase 4: メッセージID 状態管理 + 「特定メッセージへの返信」対応
- Phase 5: 自前 Chatwork MCP コネクタ → claude.ai 秘書から直接呼び出し

新規スコープ（社長要望）：
- リアクション付与（既存Phase順序のどこに入れるか）
- 対話型UI（Phase 5相当だが、Claude Codeで先取り可能か）

→ **議論Issue: #28**

### 論点C: ガード設計（過去事故の再発防止）

**問**: GAS連投事故（2026-04-23）の再発を防ぐためのガードをどう設計するか？

必須要素：
- 重複送信防止（同一内容の連投検知）
- セッション単位の送信上限
- 人間確認（社長承認）の必須化基準
- 監査ログ（送信履歴の永続記録）

→ **議論Issue: #29**

### 論点D: 中国モード考慮（ADR-0006）

**問**: 中国遠征中の制約（claude.ai 不安定 / VPN必要）下でも動作する設計か？

- 1106PC経由の既存READ系: ✅ 中国でも動作（Chatworkは中国でブロックされない）
- 新規対話型UI: claude.ai依存なら中国で詰む可能性
- フォールバック: Phase 1（既存Issue経由）を中国モードとして残す

→ 論点AおよびBの結論に依存するため、別Issueは起票せず本ADRで集約。

---

## Decision（決定・段階的に確定中）

論点A・B・C議論完了後、本セクションに最終決定を記述する。

### Decision A: 実装アーキテクチャ ✅ 確定（2026-04-29）

**採用**: 候補4「自前Chatwork MCPサーバー（1106PC常駐）」

#### 判断根拠
- 社長理想形「対話即時性 + 常駐性」を**単独で両立できる唯一の候補**
- 社長判断: 「Chatworkの社内投稿はかなりあるので、1〜2週間はかからない気がする」（体感サンプル蓄積期間が短い見込み）
- `feedback_premise_check.md` の観点: 体感サンプル不足の懸念は社長判断の根拠（社内投稿量）で打ち消される

#### 採用しなかった候補と理由
- 候補1（claude.ai秘書）: 10分polling不可避・即時性なし
- 候補2（Claude Code）: 常駐性なし
- 候補3（orchestrator拡張）: poll型のため対話即時性なし
- 候補X（1106PC + Claude Code役割分担）: 工数小だが「対話の途中で常駐側を呼ぶ」ような統合が困難

#### 含意
- ADR-0007のPhase 5「自前Chatwork MCPコネクタ」を**最初から実装する**形になる
- Phase 2-4（WRITE系Issue化・polling高速化・メッセージID状態管理）は MCP内部実装として包含される
- 1106PC上で常駐MCPサーバーとして稼働
- Claude Code（自宅/職場PC）から MCP経由で呼び出し可能になる
- claude.ai秘書からの呼び出しは将来検討（Phase 5延長線）

### 暫定的な合意事項（B/C議論前）
- v3 READ系（既存orchestrator経由）は維持・拡張する（破壊しない）
- 既存WRITE系ルール（`needs-approval`）の精神は MCP内部にも引き継ぐ
- リアクションは「既読の代替・軽量スルー」として実装

### Decision B: 段階性 ✅ 確定（2026-04-29）

**採用**: (a) 機能水平展開MVP

#### MVP範囲
| # | 機能 | API | MVP内 |
|---|---|---|---|
| 1 | メッセージ取得 | `GET /rooms/{id}/messages`, `GET /rooms` | ✅ |
| 2 | To:検出（自分宛のみ）| ローカル処理 | ✅ |
| 3 | 要約生成 | LLM経由 | ✅ |
| 4 | メッセージ送信（返信）| `POST /rooms/{id}/messages` | ✅ |
| 5 | 既読化（「スルー」表現）| `PUT /rooms/{id}/messages/read` | ✅ |

#### スコープ外（諦め・将来検討）
- **リアクション機能**: Chatwork公式APIに該当機能なし。社長判断（2026-04-29）で「既読化のみで『スルー』を表現する」方針に確定。リアクション風メッセージ送信（`(thumbsup)` 等）も採用しない。
- メッセージ編集・削除
- ファイル添付
- Webhook通知監視

#### 段階順序
- 機能(1)〜(5) を**最小実装で並行展開** → 全て動かす → 不満ポイントを磨く
- 既存v3 READ系（orchestrator経由）は維持・並存

### Decision C: ガード設計 ✅ 確定（2026-04-29）

#### 操作別の承認方針
| 操作 | 承認方式 | 根拠 |
|---|---|---|
| READ（取得・要約）| 自動OK | 既存v3踏襲・読み取り操作はリスク低 |
| **既読化（マーク既読）** | **自動OK** | 社長理想形「軽量にスルー」を優先（Q1=i） |
| **メッセージ送信（返信）** | **対話確認方式** | Claude Code内で「この返信文で送りますか？ [yes/no]」→ 社長が `yes` と答えた時のみ送信。既存v3 `needs-approval` ラベル方式は不採用（対話即時性優先・Q2=ii）|

#### 重複送信防止 + 送信上限（中程度）
- 直近10件と完全一致をブロック
- セッション最大10件
- 同一ルーム連続2件まで（連続送信検知）

#### 監査ログ（ローカル + GitHub Issue 1本書き換え方式）
- **ローカル**: `1106PC: C:\aieiji-ops\logs\chatwork_audit.jsonl`（JSONL形式・全送信を追記永続）
- **GitHub Issue**: 「Chatwork監査ログ」Issueを **1本だけ** 起票し、本文を**最新N件で書き換える**（Issue増やさない方針・Q4社長指定）
  - 書き換え頻度: 送信時 or 定期
  - ローテーション: 古いログはローカルJSONLに保持、Issueには直近N件のみ表示
  - N の値は実装計画（Round 4）で決定

#### Kill switch（両方併用・実運用ではChatwork経由が主）
- **(a) PAUSEファイル方式**（既存orchestrator方式継承）: `C:\aieiji-ops\PAUSE` 配置で全停止
- **(b) Chatwork経由方式**（実運用での主流）: マイチャット（room 46076523）に `STOP_AIEIJI` を送信 → MCPがpollingで検知して自身を停止
  - 検知間隔は実装計画で決定（10秒〜1分想定）
  - 社長判断: 「実際上はChatwork側からの停止指示が多いと思う」→ (b)を主・(a)を保険として残す

---

## Implementation Plan（2026-04-29 Round 4 確定）

### 技術スタック
- **TypeScript + Node.js**（社長判断）
- `@modelcontextprotocol/sdk`（MCP公式SDK）
- Chatwork API は素のfetch / undici で叩く（軽量化）

### ディレクトリ構造（aieiji-ops repo内）

```
C:\aieiji-ops\
  mcp-servers\
    chatwork\
      src\
        index.ts          ← MCPサーバーエントリ
        chatwork-api.ts   ← Chatwork API ラッパー
        guards.ts         ← 重複防止・送信上限・kill switch
        audit.ts          ← 監査ログ書き込み
        config.ts         ← 設定読み込み
      package.json
      tsconfig.json
      README.md
      .env.example
  logs\
    chatwork_audit.jsonl  ← 既存logs/に追加
```

### 設定・認証

| 項目 | 入手方法 | 保存先 | 備考 |
|---|---|---|---|
| `CHATWORK_API_TOKEN` | 1106PC既存（v3で利用中）| `.env` | gitignore |
| `CHATWORK_MY_ACCOUNT_ID` | API `GET /me` で初回取得 | `.env` | キャッシュ |
| `CHATWORK_MYCHAT_ROOM_ID` | 既知: 46076523 | `config.ts` | ハードコード可 |
| `MAX_SESSION_SENDS` | 10 | `config.ts` | Decision C |
| `MAX_ROOM_CONSECUTIVE` | 2 | `config.ts` | Decision C |
| **`STOP_KEYWORDS`** | 配列化・複数バリエーション対応 | `config.ts` | 下記参照 |

#### STOP_KEYWORDS（複数バリエーション・社長判断 Q3）

社長がマイチャットでMCPを停止したい時、**揺らぎを許容する**ため複数キーワードに対応する。マッチング方式: **大文字小文字無視・前後空白無視・部分一致 OR 完全一致**。

推奨キーワードリスト（実装時に最終調整）:
```typescript
const STOP_KEYWORDS = [
  // 英語系（大文字小文字無視）
  "STOP_AIEIJI",
  "Stop_AIEiji",
  "stop_aieiji",
  "STOP AIEIJI",
  // 日本語系
  "AIEIJIをとめて",
  "AIEIJIを止めて",
  "AIEijiをとめて",
  "AIEijiを止めて",
  "AIEIJIをストップ",
  "AIEijiをストップ",
  "AIEIJIストップ",
  "AIEijiストップ",
  "ストップAIEIJI",
  "AIEIJI停止",
  "AIEiji停止",
];
```

新キーワードを追加したい場合は `config.ts` 編集 → 再起動で反映。

### デプロイ方式（社長判断 Q4: 都度確認ゲート）

#### Phase 1: 開発中（手動起動）
- 1106PCに SSH接続して `cd C:\aieiji-ops\mcp-servers\chatwork && npm start`
- ログを観察しながら動作確認・バグ修正
- Claude Code/Claude.ai秘書から MCP接続して動作試験

#### Phase 2: Task Scheduler移行（⚠️ 都度社長確認必須）
> **🚨 重要ガード**: Task Scheduler への移行は **社長に都度確認してから実施**（自動移行禁止）。
>
> 移行時の確認事項:
> - 「Phase 1運用で安定している」体感
> - エラー頻度・リソース消費
> - 移行後の検証手順合意
>
> 社長判断（2026-04-29）: 「都度都度私に確認してきてほしい」

#### Kill switch（Decision C準拠）
- (a) **PAUSEファイル**: `C:\aieiji-ops\PAUSE` 配置で全停止（既存orchestrator方式継承）
- (b) **Chatwork経由**: STOP_KEYWORDS をマイチャット監視で検知 → `process.exit(0)`
- 検知間隔: 30秒（実装時に調整）

### MCP Tools 一覧（MVP・社長判断 Q5: 6個でOK）

| Tool名 | 機能 | 承認方式 |
|---|---|---|
| `chatwork_list_rooms` | ルーム一覧取得 | 自動 |
| `chatwork_get_my_mentions` | 全ルームから自分宛To:を抽出（未読のみ）| 自動 |
| `chatwork_get_messages` | 指定ルームのメッセージ取得 | 自動 |
| `chatwork_send_message` | メッセージ送信 | **対話確認**（Decision C: yes/no） |
| `chatwork_mark_as_read` | ルームを既読化 | 自動 |
| `chatwork_get_audit_log` | 直近の送信ログ取得（自己診断用）| 自動 |

### Claude Code クライアント接続設計（2026-04-29 調査済み）

#### MCPサーバー稼働方式
- **1106PC上でTypeScript MCPサーバーを起動**（ポート3000予定）
- Transport: **Streamable HTTP**（公式推奨・SSEは非推奨化）
- リスナーURL: `http://100.104.151.97:3000/mcp`（Tailscale経由・private network）
- セキュリティ: Tailscaleで private network化されているため、公開せず内部接続のみ
  - 防御強化案（任意）: `X-API-Key` ヘッダーで簡易認証

#### Claude Code（自宅PC/職場PC）からの接続

**方式A: コマンド一発登録（推奨）**
```bash
claude mcp add --transport http chatwork --scope project http://100.104.151.97:3000/mcp
```
スコープは `project`（aieiji-ops repoの `.mcp.json` に記録・全PCで同一設定共有）

**方式B: `.mcp.json` 直接編集**
aieiji-ops repo ルートに以下を配置：
```json
{
  "mcpServers": {
    "chatwork": {
      "type": "http",
      "url": "http://100.104.151.97:3000/mcp"
    }
  }
}
```

**方式C: 環境変数展開（推奨実装）**
```json
{
  "mcpServers": {
    "chatwork": {
      "type": "http",
      "url": "${MCP_CHATWORK_URL:-http://100.104.151.97:3000/mcp}"
    }
  }
}
```
中国遠征時にURL変更が必要な場合に環境変数で対応可能。

#### 接続時の動作
- 自動再接続: 接続切れ時に最大5回、指数バックオフで再試行
- `/mcp` コマンドで接続状態確認可能
- `claude mcp reset-project-choices` で承認をリセット可能（プロジェクトスコープのセキュリティ承認）

### 実装着手前の最終確認チェックリスト ✅ 全項目完了（2026-04-29）

- [x] 1106PCに Node.js（v20+推奨）がインストール済み — **v20.18.0 / npm 10.8.2 確認済**
- [x] 1106PCの `CHATWORK_API_TOKEN` を MCP サーバーから読める形に整理 — **`C:\aieiji-ops\orchestrator\.env` に実値設定済・MCP実装時は同ファイル参照 or コピー**
- [x] aieiji-ops repo に `mcp-servers/` 用のgitignore追加 — **commit ade8ea6**
- [x] Issue「Chatwork監査ログ」を1本起票 — **[#30](https://github.com/sankaholdings/aieiji-ops/issues/30) Open（書き換え運用待機中）**
- [x] Claude Code クライアント側のMCP設定方法調査 — **Streamable HTTP / `.mcp.json` プロジェクトスコープで決定**

## Consequences（結果・Draft段階では予測）

### 良い結果（期待）
- 社長の理想形（チャットボット式）に近づく
- 「To:抽出→返信/リアクション/スルー」が対話で完結
- 既存READ系資産を破壊せず段階的に拡張

### トレードオフ（懸念）
- 体感サンプル不足のまま設計を進めるリスク（運用しながら調整必須）
- 中国遠征前（〜5/8）に設計議論完了するためのスケジュール圧
- 実装の完成時期は遠征中〜帰国後（5/20以降）の見込み

### スコープ外（本ADRでは扱わない）
- claude.ai 公式 Chatwork コネクタ（存在しない・将来出れば再評価）
- Chatwork以外のメッセージング（Slack等）への横展開

---

## Notes（補足・参考）

- 本ADRはADR-0007が予告した「ADR-0008（仮）」の継承（番号枯渇でADR-0009として起票）
- ADR-0008 Master Trackerに前倒し履歴を記録済（2026-04-29 commit 23a06a9）
- Auditor: Claude (claude-opus-4-7) 自宅Fujitsuセッション（社長との対話で起票）
- Draft → Accepted 化のタイミング: 論点A/B/C すべてのIssueがCloseされた後

---

## Implementation Status（実装進捗）

### Stage 1: スケルトン + chatwork_list_rooms（2026-04-29 自宅Fujitsu）

- **状態**: ✅ commit `765edb2` で main 反映済
- **実装範囲**:
  - MCP HTTP server スケルトン（Express + `StreamableHTTPServerTransport`）
  - 1 tool: `chatwork_list_rooms`
  - ヘルスチェック (`/health`)
  - `config.ts`（CHATWORK_API_TOKEN / PORT / MAX_SESSION_SENDS / MAX_ROOM_CONSECUTIVE / STOP_KEYWORDS 配列定義）
- **動作確認**: 1106PCでの実機稼働確認は未実施

### Stage 4: 残り5 tools + ガード + 監査ログ（2026-04-30 着手→一時停止→再開）

- **状態**: 🔄 **実装再開**（2026-04-30 サンプル3で前提条件変化・社長判断・[ADR-0008 Master Tracker 修正履歴 2026-04-30](0008-system-audit-2026-04-28.md) 参照）
- **再開時の仕様修正**（サンプル3 発見を反映）:
  1. `getMessages(roomId, force=true)` をデフォルトに（`?force=1` 採用・`?force=0` の既読化副作用回避）
  2. `chatwork_get_my_mentions` も `force=true` で実装し、時間絞り込み（直近 168 時間）を追加検討
  3. `CHATWORK_MY_ACCOUNT_ID=1772516` を `.env.example` に明記（環境変数優先・`GET /me` フォールバック）
- **実装範囲（WIP・未マージ）**:
  - 5 tools: `chatwork_get_my_mentions` / `chatwork_get_messages` / `chatwork_send_message` / `chatwork_mark_as_read` / `chatwork_get_audit_log`
  - `SendGuards` クラス（重複防止 / セッション送信上限 / 同一ルーム連続送信上限 / PAUSEファイル監視）
  - `AuditLog` クラス（JSONL 永続化・`C:\aieiji-ops\logs\chatwork_audit.jsonl`）
  - `chatwork-api.ts` 拡張（`getMe` / `getMessages` / `sendMessage` / `markAsRead`）
  - `.env.example` 追加（`.gitignore` に `!**/.env.example` 例外を追加）
  - README 全面更新 / `package.json` version 0.1.0 → 0.2.0
- **保管先**: 職場PC（desktop-829prkv） `C:\aieiji-ops` の `git stash@{0}`（メッセージ: `ADR-0009 Stage 4 WIP (paused 2026-04-30 by social judgment for sample collection priority)`）
- **未実施**:
  - 動作確認（1106PCでの起動・型チェック）
  - STOP_KEYWORDS 監視ループ実装（kill switch (b) Chatwork経由方式）
  - Issue #30 への監査ログ書き換えロジック
  - Claude Code クライアント接続テスト（`.mcp.json` 設定）
- **再開条件**: v3 秘書（claude.ai Projects）での体感サンプル蓄積（Issue #28 コメントで追跡）

### 体感サンプル蓄積運用（2026-04-30〜）

社長は v3 秘書で Chatwork チェック依頼を実運用しながら、以下を Issue #28 にコメント追記する:

- 不便だった点（10分待ちが辛い・要約が雑・To:抽出漏れ等）
- 「対話完結したい」と思った場面
- 「リアクション欲しい」と思ったケース（Decision Bで諦めた件・実運用で本当に不要か再検証）

→ これが**残り5 toolsの実装優先順位**を再評価する根拠になる。

### 実行ログ（2026-04-30 再開セッション）

| Phase | 内容 | 場所 | 状態 |
|---|---|---|---|
| **P1** | (b)→(i) 判断変更を ADR-0008/0009 に記録 + commit/push | 職場PC | 🔄 進行中（本コミットで完了予定） |
| **P2** | `git stash pop` + サンプル3発見の反映（`force=1` / `account_id=1772516`）+ commit/push | 職場PC | ⏳ 未着手 |
| **P3** | 1106PC で動作確認（`git pull` → `npm install` → `npm run typecheck` → 起動 → `/health` 疎通 → Claude Code MCPクライアント接続） | 1106PC（SSH 経由） | ⏳ 未着手 |

各 Phase 完了時に本表を更新する（DESIGN_PRINCIPLES ルール3-A 準拠・実行ログを集中管理）。
