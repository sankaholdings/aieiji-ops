import { promises as fs } from "node:fs";
import path from "node:path";
import type { IssuePoster } from "./issue-poster.js";

export type AuditStatus = "success" | "blocked" | "error";

export interface AuditEntry {
  timestamp: string;
  tool: string;
  room_id?: number;
  body?: string;
  message_id?: string;
  status: AuditStatus;
  reason?: string;
}

export class AuditLog {
  private readonly filePath: string;
  private readonly issuePoster: IssuePoster | null;
  private readonly issuePostLimit: number;

  constructor(
    filePath: string,
    opts?: { issuePoster?: IssuePoster; issuePostLimit?: number }
  ) {
    this.filePath = filePath;
    this.issuePoster = opts?.issuePoster ?? null;
    this.issuePostLimit = opts?.issuePostLimit ?? 50;
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  async append(entry: AuditEntry): Promise<void> {
    await this.ensureDir();
    await fs.appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf8");
    // Issue #34 β: 監査 Issue へ最新 N 件を書き換え反映（fire-and-forget）
    if (this.issuePoster !== null) {
      try {
        const recent = await this.readRecent(this.issuePostLimit);
        this.issuePoster.schedulePost(recent);
      } catch (err) {
        console.error(
          "[audit] schedulePost failed (continuing):",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  async readRecent(limit: number): Promise<AuditEntry[]> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const lines = content.split("\n").filter((l) => l.length > 0);
    const tail = lines.slice(-limit);
    return tail.map((line) => JSON.parse(line) as AuditEntry);
  }

  async readSendsForDuplicateCheck(limit: number): Promise<AuditEntry[]> {
    const recent = await this.readRecent(limit * 4);
    return recent
      .filter(
        (e) => e.tool === "chatwork_send_message" && e.status === "success"
      )
      .slice(-limit);
  }
}
