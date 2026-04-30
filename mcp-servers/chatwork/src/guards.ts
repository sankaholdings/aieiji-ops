import { existsSync } from "node:fs";
import type { AuditEntry } from "./audit.js";

export class GuardError extends Error {
  constructor(
    public readonly code:
      | "PAUSED"
      | "DUPLICATE"
      | "SESSION_LIMIT"
      | "CONSECUTIVE_LIMIT"
      | "MISSING_CONFIRM",
    message: string
  ) {
    super(message);
    this.name = "GuardError";
  }
}

export interface SendGuardOptions {
  maxSessionSends: number;
  maxRoomConsecutive: number;
  duplicateLookback: number;
  pauseFilePath: string;
}

export class SendGuards {
  private sessionSendCount = 0;
  private lastRoomId: number | null = null;
  private consecutiveCount = 0;

  constructor(private readonly opts: SendGuardOptions) {}

  isPaused(): boolean {
    return existsSync(this.opts.pauseFilePath);
  }

  checkBeforeSend(
    roomId: number,
    body: string,
    recentSends: AuditEntry[]
  ): void {
    if (this.isPaused()) {
      throw new GuardError(
        "PAUSED",
        `Kill switch active: PAUSE file exists at ${this.opts.pauseFilePath}`
      );
    }

    if (this.sessionSendCount >= this.opts.maxSessionSends) {
      throw new GuardError(
        "SESSION_LIMIT",
        `Session send limit reached (${this.opts.maxSessionSends}). Restart the MCP server to reset.`
      );
    }

    if (
      this.lastRoomId === roomId &&
      this.consecutiveCount >= this.opts.maxRoomConsecutive
    ) {
      throw new GuardError(
        "CONSECUTIVE_LIMIT",
        `Consecutive send limit reached for room ${roomId} (${this.opts.maxRoomConsecutive}). Send to a different room first.`
      );
    }

    const dupLookback = recentSends.slice(-this.opts.duplicateLookback);
    const isDuplicate = dupLookback.some(
      (e) => e.room_id === roomId && e.body === body
    );
    if (isDuplicate) {
      throw new GuardError(
        "DUPLICATE",
        `Duplicate send blocked: identical body to a recent send in room ${roomId}.`
      );
    }
  }

  recordSend(roomId: number): void {
    this.sessionSendCount += 1;
    if (this.lastRoomId === roomId) {
      this.consecutiveCount += 1;
    } else {
      this.lastRoomId = roomId;
      this.consecutiveCount = 1;
    }
  }

  snapshot(): {
    sessionSendCount: number;
    lastRoomId: number | null;
    consecutiveCount: number;
  } {
    return {
      sessionSendCount: this.sessionSendCount,
      lastRoomId: this.lastRoomId,
      consecutiveCount: this.consecutiveCount,
    };
  }
}
