import { spawn } from "node:child_process";
import type { AuditEntry } from "./audit.js";

export interface IssuePosterOptions {
  /** GitHub リポジトリ "owner/name" 形式 */
  repo: string;
  /** 書き換え対象 Issue 番号（永続 OPEN・本文を上書き） */
  issueNumber: number;
  /** 表示する最新ログ件数。デフォルト 50 */
  recentLimit?: number;
}

/**
 * Chatwork MCP 監査ログを GitHub Issue 本文に書き換え反映する（ADR-0009 Decision C / Issue #34 β / Issue #30）。
 *
 * 設計方針:
 *   - 永続記録は JSONL ファイル（変更しない）。Issue は最新 N 件のみの「ライブ表示」
 *   - 連続呼び出しを直列化し、最後の状態のみが書き込まれる（中間状態の書き換えを抑制）
 *   - 失敗してもメイン送信フローに影響しない（fire-and-forget・例外握りつぶし）
 *   - gh CLI を spawn して `gh issue edit <num> --body-file -` で書き換え
 */
export class IssuePoster {
  private readonly repo: string;
  private readonly issueNumber: number;
  private readonly recentLimit: number;
  private pendingEntries: AuditEntry[] | null = null;
  private inflight: Promise<void> | null = null;

  constructor(opts: IssuePosterOptions) {
    this.repo = opts.repo;
    this.issueNumber = opts.issueNumber;
    this.recentLimit = opts.recentLimit ?? 50;
  }

  /**
   * 書き換えをスケジュール（fire-and-forget）。
   * 既に書き換え中なら最新エントリ群で上書き予約 → 直前完了後に1回だけ実行。
   */
  schedulePost(entries: AuditEntry[]): void {
    this.pendingEntries = entries;
    if (this.inflight !== null) return;

    this.inflight = this.runWritebackLoop()
      .catch((err) => {
        console.error(
          "[issue-poster] writeback loop failed:",
          err instanceof Error ? err.message : String(err)
        );
      })
      .finally(() => {
        this.inflight = null;
      });
  }

  private async runWritebackLoop(): Promise<void> {
    while (this.pendingEntries !== null) {
      const entries = this.pendingEntries;
      this.pendingEntries = null;
      try {
        await this.writeIssueBody(entries);
      } catch (err) {
        console.error(
          "[issue-poster] writeIssueBody failed (skipping):",
          err instanceof Error ? err.message : String(err)
        );
        return;
      }
    }
  }

  private writeIssueBody(entries: AuditEntry[]): Promise<void> {
    const recent = entries.slice(-this.recentLimit);
    const body = buildMarkdown(recent, this.recentLimit);

    return new Promise<void>((resolve, reject) => {
      const gh = spawn(
        "gh",
        [
          "issue",
          "edit",
          String(this.issueNumber),
          "--repo",
          this.repo,
          "--body-file",
          "-",
        ],
        { stdio: ["pipe", "pipe", "pipe"], shell: true }
      );

      let stderr = "";
      gh.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      gh.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(`gh exited ${code}: ${stderr.trim().slice(0, 500)}`)
          );
        }
      });
      gh.on("error", (err) => reject(err));

      try {
        gh.stdin.write(body);
        gh.stdin.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

function escapeCell(s: string): string {
  return s
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 120);
}

function buildMarkdown(entries: AuditEntry[], recentLimit: number): string {
  const lines: string[] = [];
  lines.push("## 用途");
  lines.push("");
  lines.push(
    "ADR-0009 Decision C で定めた **Chatwork MCPサーバーの監査ログ** を記録する Issue。"
  );
  lines.push("");
  lines.push(
    "**書き換え方式（自動）**: chatwork-mcp の `IssuePoster` (Issue #34 β) が `audit.append()` のたびに本文を最新 N 件で上書きする。"
  );
  lines.push("");
  lines.push("## 表示ルール");
  lines.push("");
  lines.push(
    `- 直近 **${recentLimit} 件** をテーブル表示（古いログは 1106PC ローカルの \`C:\\aieiji-ops\\logs\\chatwork_audit.jsonl\` に永続保存）`
  );
  lines.push("- 本 Issue は永続的に OPEN のまま（CLOSE しない）");
  lines.push(
    `- 最終更新: \`${new Date().toISOString()}\``
  );
  lines.push("");
  lines.push("## 直近の監査ログ");
  lines.push("");
  if (entries.length === 0) {
    lines.push("（監査ログなし。最初の `chatwork_send_message` 等で本文が更新されます）");
  } else {
    lines.push("| timestamp | tool | room_id | status | message_id / reason |");
    lines.push("|---|---|---|---|---|");
    for (const e of entries.slice().reverse()) {
      const detail = e.message_id
        ? `\`${e.message_id}\``
        : e.reason
          ? escapeCell(e.reason)
          : "-";
      const room = e.room_id != null ? String(e.room_id) : "-";
      lines.push(
        `| \`${e.timestamp}\` | ${e.tool} | ${room} | ${e.status} | ${detail} |`
      );
    }
  }
  lines.push("");
  lines.push("## 関連");
  lines.push("");
  lines.push("- ADR-0009 Decision C: ガード設計");
  lines.push(
    "- Issue #34 β: 本機能の実装管理"
  );
  lines.push(
    "- ローカル永続: 1106PC `C:\\aieiji-ops\\logs\\chatwork_audit.jsonl`"
  );
  lines.push("");
  lines.push("## 禁則");
  lines.push("");
  lines.push("- この Issue を Close しない");
  lines.push("- 別の Chatwork 監査用 Issue を増やさない（書き換え方式の徹底）");
  lines.push(
    "- 本文への手動編集は実装テスト時を除き避ける（MCP が次回 append 時に上書きするため）"
  );
  return lines.join("\n");
}
