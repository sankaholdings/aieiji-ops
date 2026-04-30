import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { CONFIG, STOP_KEYWORDS } from "./config.js";
import { ChatworkAPI } from "./chatwork-api.js";
import { AuditLog, type AuditEntry } from "./audit.js";
import { SendGuards, GuardError } from "./guards.js";
import { StopMonitor } from "./stop-monitor.js";
import { IssuePoster } from "./issue-poster.js";

const api = new ChatworkAPI(CONFIG.CHATWORK_API_TOKEN);
const issuePoster = CONFIG.AUDIT_GITHUB_POST_ENABLED
  ? new IssuePoster({
      repo: CONFIG.AUDIT_GITHUB_REPO,
      issueNumber: CONFIG.AUDIT_GITHUB_ISSUE_NUMBER,
      recentLimit: CONFIG.AUDIT_GITHUB_POST_LIMIT,
    })
  : undefined;
const audit = new AuditLog(CONFIG.AUDIT_LOG_PATH, {
  issuePoster,
  issuePostLimit: CONFIG.AUDIT_GITHUB_POST_LIMIT,
});
const guards = new SendGuards({
  maxSessionSends: CONFIG.MAX_SESSION_SENDS,
  maxRoomConsecutive: CONFIG.MAX_ROOM_CONSECUTIVE,
  duplicateLookback: CONFIG.DUPLICATE_LOOKBACK,
  pauseFilePath: CONFIG.PAUSE_FILE_PATH,
});

function nowIso(): string {
  return new Date().toISOString();
}

function textResult(payload: unknown, isError = false): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function createServer(myAccountId: number): McpServer {
  const server = new McpServer(
    {
      name: "chatwork-mcp",
      version: "0.4.0",
    },
    { capabilities: {} }
  );

  server.registerTool(
    "chatwork_list_rooms",
    {
      description:
        "Chatworkで自分が参加しているルーム一覧を取得する。各ルームの未読数(unread_num)・メンション数(mention_num)・最終更新時刻(last_update_time)を含む。",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      const rooms = await api.listRooms();
      return textResult(rooms);
    }
  );

  server.registerTool(
    "chatwork_get_my_mentions",
    {
      description:
        "全ルームを走査し、自分宛 [To:account_id] メンションを含むメッセージを抽出する (社長理想形『自分宛 To: を第一優先』の核心・ADR-0009)。" +
        "mention_num > 0 のルームのみ走査して API 呼び出しを節約。" +
        "READ-ONLY 安全側のため Chatwork API は force=1 (最新100件・既読化副作用なし) で叩き、" +
        "lookback_hours で時間絞り込みする (サンプル3 で force=0 の既読化副作用が判明したため)。" +
        "デフォルト lookback_hours=168 (直近7日)。" +
        "返却は { my_account_id, scanned_rooms, lookback_hours, count, mentions: [{ room_id, room_name, message_id, send_time, body, sender }], api_errors? }。",
      inputSchema: {
        lookback_hours: z
          .number()
          .int()
          .positive()
          .max(8760)
          .optional()
          .default(168),
      },
    },
    async ({ lookback_hours }): Promise<CallToolResult> => {
      const lookback = lookback_hours ?? 168;
      const cutoffEpoch = Math.floor(Date.now() / 1000) - lookback * 3600;
      const rooms = await api.listRooms();
      const targetRooms = rooms.filter((r) => r.mention_num > 0);
      const mentionTag = `[To:${myAccountId}]`;
      const mentions: Array<{
        room_id: number;
        room_name: string;
        message_id: string;
        send_time: number;
        body: string;
        sender: { account_id: number; name: string };
      }> = [];
      const apiErrors: Array<{
        room_id: number;
        room_name: string;
        error: string;
      }> = [];

      for (const room of targetRooms) {
        let messages;
        try {
          messages = await api.getMessages(room.room_id, true);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[chatwork-mcp] getMessages failed for room ${room.room_id}:`,
            errorMsg
          );
          apiErrors.push({
            room_id: room.room_id,
            room_name: room.name,
            error: errorMsg,
          });
          continue;
        }
        for (const msg of messages) {
          if (msg.send_time < cutoffEpoch) continue;
          if (msg.body.includes(mentionTag)) {
            mentions.push({
              room_id: room.room_id,
              room_name: room.name,
              message_id: msg.message_id,
              send_time: msg.send_time,
              body: msg.body,
              sender: {
                account_id: msg.account.account_id,
                name: msg.account.name,
              },
            });
          }
        }
      }

      mentions.sort((a, b) => b.send_time - a.send_time);

      return textResult({
        my_account_id: myAccountId,
        scanned_rooms: targetRooms.length,
        lookback_hours: lookback,
        count: mentions.length,
        mentions,
        ...(apiErrors.length > 0 ? { api_errors: apiErrors } : {}),
      });
    }
  );

  server.registerTool(
    "chatwork_get_messages",
    {
      description:
        "指定ルームのメッセージを取得する。" +
        "force=true (デフォルト・READ-ONLY 安全側) は最新100件を取得し既読化副作用なし。" +
        "force=false は未読メッセージのみ取得するが、Chatwork API の仕様で1回呼ぶと " +
        "last_read_message_id が前進し実質『既読化』副作用がある (サンプル3 で発見)。" +
        "故意の既読化は chatwork_mark_as_read を使うこと。",
      inputSchema: {
        room_id: z.number().int().positive(),
        force: z.boolean().optional().default(true),
      },
    },
    async ({ room_id, force }): Promise<CallToolResult> => {
      const useForce = force ?? true;
      const messages = await api.getMessages(room_id, useForce);
      return textResult({
        room_id,
        force: useForce,
        count: messages.length,
        messages,
      });
    }
  );

  server.registerTool(
    "chatwork_send_message",
    {
      description:
        "Chatworkにメッセージを送信する。【重要】呼び出し前に必ず Claude Code 内で社長に『この内容で送信しますか？ [yes/no]』を確認し、社長が yes と回答した場合のみ confirm=true で呼び出すこと (ADR-0009 Decision C)。confirm が true 以外の場合はリクエスト自体が拒否される。ガード: 重複送信ブロック (直近10件と完全一致禁止) / セッション送信上限10件 / 同一ルーム連続2件まで / PAUSE ファイル存在で全停止。送信は監査ログに記録される。",
      inputSchema: {
        room_id: z.number().int().positive(),
        body: z.string().min(1).max(10000),
        confirm: z
          .literal(true)
          .describe(
            "対話確認済みフラグ。Claude Code内で社長にyes/no確認した上でのみtrueを渡すこと。"
          ),
        self_unread: z.boolean().optional().default(false),
      },
    },
    async ({ room_id, body, self_unread }): Promise<CallToolResult> => {
      try {
        const recentSends = await audit.readSendsForDuplicateCheck(
          CONFIG.DUPLICATE_LOOKBACK
        );
        guards.checkBeforeSend(room_id, body, recentSends);
      } catch (err) {
        if (err instanceof GuardError) {
          const entry: AuditEntry = {
            timestamp: nowIso(),
            tool: "chatwork_send_message",
            room_id,
            body,
            status: "blocked",
            reason: `${err.code}: ${err.message}`,
          };
          await audit.append(entry);
          return textResult(
            {
              status: "blocked",
              code: err.code,
              message: err.message,
              hint:
                err.code === "PAUSED"
                  ? `PAUSEファイル (${CONFIG.PAUSE_FILE_PATH}) を削除すれば再開できます。`
                  : err.code === "SESSION_LIMIT"
                    ? "MCPサーバーを再起動するとセッションカウンターがリセットされます。"
                    : err.code === "CONSECUTIVE_LIMIT"
                      ? "別のルームへの送信を挟んでください。"
                      : err.code === "DUPLICATE"
                        ? "同一内容の連投はブロックされます。文面を変更してください。"
                        : undefined,
            },
            true
          );
        }
        throw err;
      }

      try {
        const result = await api.sendMessage(room_id, body, self_unread);
        guards.recordSend(room_id);
        const entry: AuditEntry = {
          timestamp: nowIso(),
          tool: "chatwork_send_message",
          room_id,
          body,
          message_id: result.message_id,
          status: "success",
        };
        await audit.append(entry);
        return textResult({
          status: "success",
          room_id,
          message_id: result.message_id,
          guards_state: guards.snapshot(),
        });
      } catch (err) {
        const entry: AuditEntry = {
          timestamp: nowIso(),
          tool: "chatwork_send_message",
          room_id,
          body,
          status: "error",
          reason: err instanceof Error ? err.message : String(err),
        };
        await audit.append(entry).catch((e) => {
          console.error("[chatwork-mcp] audit append failed:", e);
        });
        throw err;
      }
    }
  );

  server.registerTool(
    "chatwork_mark_as_read",
    {
      description:
        "指定ルームを既読化する (社長理想形『軽量にスルー』の表現)。message_id を指定するとそのメッセージまでを既読にする。省略時はルーム全体を既読化。監査ログに記録される。",
      inputSchema: {
        room_id: z.number().int().positive(),
        message_id: z.string().optional(),
      },
    },
    async ({ room_id, message_id }): Promise<CallToolResult> => {
      try {
        const result = await api.markAsRead(room_id, message_id);
        const entry: AuditEntry = {
          timestamp: nowIso(),
          tool: "chatwork_mark_as_read",
          room_id,
          status: "success",
          reason: message_id ? `up to ${message_id}` : "whole room",
        };
        await audit.append(entry);
        return textResult({
          status: "success",
          room_id,
          message_id: message_id ?? null,
          remaining: result,
        });
      } catch (err) {
        const entry: AuditEntry = {
          timestamp: nowIso(),
          tool: "chatwork_mark_as_read",
          room_id,
          status: "error",
          reason: err instanceof Error ? err.message : String(err),
        };
        await audit.append(entry).catch((e) => {
          console.error("[chatwork-mcp] audit append failed:", e);
        });
        throw err;
      }
    }
  );

  server.registerTool(
    "chatwork_get_audit_log",
    {
      description:
        "監査ログ (送信履歴・既読化履歴・ブロック履歴) を直近 N 件取得する (自己診断用)。永続パス: " +
        CONFIG.AUDIT_LOG_PATH,
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .default(CONFIG.AUDIT_LOG_DEFAULT_LIMIT),
      },
    },
    async ({ limit }): Promise<CallToolResult> => {
      const entries = await audit.readRecent(
        limit ?? CONFIG.AUDIT_LOG_DEFAULT_LIMIT
      );
      return textResult({
        path: CONFIG.AUDIT_LOG_PATH,
        count: entries.length,
        guards_state: guards.snapshot(),
        entries,
      });
    }
  );

  return server;
}

async function resolveMyAccountId(): Promise<number> {
  if (CONFIG.CHATWORK_MY_ACCOUNT_ID) {
    return CONFIG.CHATWORK_MY_ACCOUNT_ID;
  }
  console.log(
    "[chatwork-mcp] CHATWORK_MY_ACCOUNT_ID not set, fetching via GET /me"
  );
  const me = await api.getMe();
  console.log(
    `[chatwork-mcp] resolved my_account_id=${me.account_id} (${me.name})`
  );
  return me.account_id;
}

async function main(): Promise<void> {
  const myAccountId = await resolveMyAccountId();

  // Kill switch (b) Chatwork経由方式（ADR-0009 Decision C / Issue #34 α）
  // マイチャットを 30 秒間隔でポーリングし STOP_KEYWORDS を検知したら自己停止する。
  const stopMonitor = new StopMonitor({
    api,
    audit,
    roomId: CONFIG.CHATWORK_MYCHAT_ROOM_ID,
  });
  await stopMonitor.start();

  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createServer(myAccountId);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[chatwork-mcp] /mcp error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (use POST)" },
      id: null,
    });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      server: "chatwork-mcp",
      version: "0.4.0",
      my_account_id: myAccountId,
      guards_state: guards.snapshot(),
      paused: guards.isPaused(),
      kill_switch: {
        a_pause_file: CONFIG.PAUSE_FILE_PATH,
        b_stop_monitor: {
          watching_room_id: CONFIG.CHATWORK_MYCHAT_ROOM_ID,
          interval_ms: 30_000,
          stop_keywords_count: STOP_KEYWORDS.length,
        },
      },
      audit_post: {
        enabled: CONFIG.AUDIT_GITHUB_POST_ENABLED,
        github_repo: CONFIG.AUDIT_GITHUB_REPO,
        issue_number: CONFIG.AUDIT_GITHUB_ISSUE_NUMBER,
        recent_limit: CONFIG.AUDIT_GITHUB_POST_LIMIT,
      },
    });
  });

  const httpServer = app.listen(CONFIG.PORT, () => {
    console.log(
      `[chatwork-mcp] listening on http://0.0.0.0:${CONFIG.PORT}/mcp (PID ${process.pid}, my_account_id=${myAccountId})`
    );
  });

  process.on("SIGINT", () => {
    console.log("\n[chatwork-mcp] SIGINT received, shutting down");
    stopMonitor.stop();
    httpServer.close(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    console.log("\n[chatwork-mcp] SIGTERM received, shutting down");
    stopMonitor.stop();
    httpServer.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[chatwork-mcp] fatal startup error:", err);
  process.exit(1);
});
