import { promises as fs } from "node:fs";
import path from "node:path";

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
  constructor(private readonly filePath: string) {}

  private async ensureDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  async append(entry: AuditEntry): Promise<void> {
    await this.ensureDir();
    await fs.appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf8");
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
