import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";
import { CONFIG } from "./config.js";
import { ChatworkAPI } from "./chatwork-api.js";

const api = new ChatworkAPI(CONFIG.CHATWORK_API_TOKEN);

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "chatwork-mcp",
      version: "0.1.0",
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(rooms, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
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
    version: "0.1.0",
  });
});

const httpServer = app.listen(CONFIG.PORT, () => {
  console.log(
    `[chatwork-mcp] listening on http://0.0.0.0:${CONFIG.PORT}/mcp (PID ${process.pid})`
  );
});

process.on("SIGINT", () => {
  console.log("\n[chatwork-mcp] SIGINT received, shutting down");
  httpServer.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  console.log("\n[chatwork-mcp] SIGTERM received, shutting down");
  httpServer.close(() => process.exit(0));
});
