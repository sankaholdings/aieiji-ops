import type { ChatworkAPI } from "./chatwork-api.js";
import type { AuditLog, AuditEntry } from "./audit.js";
import { STOP_KEYWORDS } from "./config.js";

const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;

/**
 * STOP_KEYWORDS マッチング用の正規化。
 * 大文字小文字無視・前後空白無視（ADR-0009 line 220 準拠）。
 */
function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase();
}

const NORMALIZED_KEYWORDS = STOP_KEYWORDS.map(normalizeForMatch);

export interface StopMonitorOptions {
  api: ChatworkAPI;
  audit: AuditLog;
  /** 監視対象ルーム ID（通常は CHATWORK_MYCHAT_ROOM_ID = 46076523）*/
  roomId: number;
  /** ポーリング間隔。デフォルト 30 秒 */
  intervalMs?: number;
  /** 停止アクション。テスト時に注入可。デフォルト process.exit(0) */
  onStop?: () => void;
}

/**
 * Kill switch (b) Chatwork 経由方式（ADR-0009 Decision C）。
 *
 * 指定ルーム（マイチャット）を 30 秒間隔でポーリングし、
 * STOP_KEYWORDS のいずれかを含むメッセージを検知したら
 * 監査ログに記録のうえ MCP プロセスを停止する。
 *
 * 重要な性質:
 *   - getMessages(force=true) を使うため READ-ONLY（既読化副作用なし）
 *   - 起動時に最新 message_id を捕捉し、それ以降の新着のみを評価
 *     （起動前の古いメッセージで誤停止しない）
 *   - エラーは握りつぶしてループ継続（ネットワーク瞬断で停止しない）
 *   - timer.unref() でこのタイマーが Node プロセスを生存させない
 *     （SIGINT/SIGTERM 受信時の正常終了を妨げない）
 */
export class StopMonitor {
  private timer: NodeJS.Timeout | null = null;
  private latestSeenMessageId: string | null = null;
  private readonly api: ChatworkAPI;
  private readonly audit: AuditLog;
  private readonly roomId: number;
  private readonly intervalMs: number;
  private readonly onStop: () => void;

  constructor(opts: StopMonitorOptions) {
    this.api = opts.api;
    this.audit = opts.audit;
    this.roomId = opts.roomId;
    this.intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onStop = opts.onStop ?? (() => process.exit(0));
  }

  /**
   * 監視開始。
   * 初回スキャンで最新 message_id を捕捉してから setInterval を仕込む。
   */
  async start(): Promise<void> {
    try {
      const messages = await this.api.getMessages(this.roomId, true);
      if (messages.length > 0) {
        this.latestSeenMessageId = messages[messages.length - 1].message_id;
        console.log(
          `[stop-monitor] watching room ${this.roomId} for STOP_KEYWORDS ` +
            `(interval=${this.intervalMs}ms, baseline_message_id=${this.latestSeenMessageId})`
        );
      } else {
        console.log(
          `[stop-monitor] watching room ${this.roomId} for STOP_KEYWORDS ` +
            `(interval=${this.intervalMs}ms, room is empty)`
        );
      }
    } catch (err) {
      console.error(
        "[stop-monitor] initial scan failed (will keep polling):",
        err instanceof Error ? err.message : String(err)
      );
    }

    this.timer = setInterval(() => {
      this.pollOnce().catch((err) => {
        console.error(
          "[stop-monitor] poll failed (continuing):",
          err instanceof Error ? err.message : String(err)
        );
      });
    }, this.intervalMs);

    // 監視タイマーで Node プロセスを生存させない（SIGINT/SIGTERM 優先）
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    const messages = await this.api.getMessages(this.roomId, true);
    if (messages.length === 0) return;

    // 新着抽出: latestSeenMessageId より後のメッセージのみ評価
    let newMessages = messages;
    if (this.latestSeenMessageId !== null) {
      const idx = messages.findIndex(
        (m) => m.message_id === this.latestSeenMessageId
      );
      if (idx >= 0) {
        newMessages = messages.slice(idx + 1);
      }
      // idx === -1: baseline がレスポンス 100 件枠の外に流れた場合。
      // 安全側として全件評価（短時間に大量投稿があった場合の漏れ防止）。
    }

    if (newMessages.length === 0) return;

    // 最後に見たメッセージ ID を更新
    this.latestSeenMessageId = messages[messages.length - 1].message_id;

    // 各新着メッセージを STOP_KEYWORDS と照合
    for (const msg of newMessages) {
      const normalizedBody = normalizeForMatch(msg.body);
      const matched = NORMALIZED_KEYWORDS.find((kw) =>
        normalizedBody.includes(kw)
      );
      if (matched === undefined) continue;

      console.warn(
        `[stop-monitor] STOP_KEYWORD detected: "${matched}" in message ` +
          `${msg.message_id} from account ${msg.account.account_id} ` +
          `(${msg.account.name}). Stopping MCP server.`
      );

      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        tool: "stop_monitor",
        room_id: this.roomId,
        message_id: msg.message_id,
        status: "blocked",
        reason: `STOP_KEYWORD_DETECTED: matched="${matched}", sender=${msg.account.name}(${msg.account.account_id})`,
      };
      try {
        await this.audit.append(entry);
      } catch (err) {
        console.error(
          "[stop-monitor] audit append failed (continuing to stop):",
          err instanceof Error ? err.message : String(err)
        );
      }

      this.stop();
      this.onStop();
      return;
    }
  }
}
