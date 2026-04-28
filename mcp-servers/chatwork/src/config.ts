import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

export const CONFIG = {
  CHATWORK_API_TOKEN: process.env.CHATWORK_API_TOKEN ?? "",
  CHATWORK_MYCHAT_ROOM_ID: 46076523,
  PORT: Number.parseInt(process.env.PORT ?? "3000", 10),
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  MAX_SESSION_SENDS: 10,
  MAX_ROOM_CONSECUTIVE: 2,
} as const;

export const STOP_KEYWORDS = [
  "STOP_AIEIJI",
  "Stop_AIEiji",
  "stop_aieiji",
  "STOP AIEIJI",
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
] as const;

if (!CONFIG.CHATWORK_API_TOKEN || CONFIG.CHATWORK_API_TOKEN.startsWith("__")) {
  throw new Error(
    "CHATWORK_API_TOKEN is not set in .env (copy .env.example → .env and fill the real token)"
  );
}
