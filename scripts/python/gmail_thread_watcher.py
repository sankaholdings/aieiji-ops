#!/usr/bin/env python3
# =============================================================
# gmail_thread_watcher.py
# 役割: Gmailの特定スレッド（"AIEiji/Watch" ラベル付き）への新着返信を検知し、
#       Chatwork Room 46076523（マイチャット）に通知する。
# バージョン: v1.0
# 作成: 2026-04-24 (GitHub Issue #14)
#
# 【動作概要】
# 1. OAuth2 で Gmail API に接続（credentials.json + token.json）
# 2. Gmail ラベル "AIEiji/Watch" の付いたスレッドを取得
# 3. 前回チェック以降に届いた新着メッセージを抽出
# 4. 各新着メッセージの 件名・送信者・受信時刻 を Chatwork に投稿
# 5. 状態ファイル (last_check_at + seen_message_ids) を更新
#
# 【監視対象スレッドの指定方法】
# Gmail 上で監視したいスレッドに "AIEiji/Watch" ラベルを手動で付与する。
# （ラベル名は環境変数 GMAIL_WATCH_LABEL で変更可能）
#
# 【環境変数】
# CHATWORK_API_TOKEN     : Chatwork API トークン（必須）
# GMAIL_CREDENTIALS_FILE : OAuth client secret JSON のパス（既定: orchestrator/gmail_credentials.json）
# GMAIL_TOKEN_FILE       : 認可済みトークンキャッシュのパス（既定: orchestrator/gmail_token.json）
# GMAIL_WATCH_LABEL      : 監視対象ラベル名（既定: AIEiji/Watch）
# CHATWORK_ROOM_ID       : 通知先 Chatwork Room ID（既定: 46076523）
# GMAIL_WATCH_STATE_FILE : 状態ファイルのパス（既定: bridge/state/gmail_thread_watcher_state.json）
# GMAIL_WATCH_LOOKBACK_DAYS : 初回起動時の遡及日数（既定: 1）
#
# 【初回セットアップ】
# 1. Google Cloud Console で OAuth クライアント (Desktop アプリ) を作成
# 2. credentials.json を orchestrator/gmail_credentials.json として配置
# 3. デスクトップで一度だけ手動実行し、ブラウザで承認 → gmail_token.json が生成される
# 4. 以降は Task Scheduler 経由で無人実行可能
# =============================================================

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError as e:
    print(f"[FATAL] Google API ライブラリ未インストール: {e}", file=sys.stderr)
    print("  pip install google-auth google-auth-oauthlib google-api-python-client", file=sys.stderr)
    sys.exit(2)

JST = timezone(timedelta(hours=9))
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CREDENTIALS = REPO_ROOT / "orchestrator" / "gmail_credentials.json"
DEFAULT_TOKEN       = REPO_ROOT / "orchestrator" / "gmail_token.json"
DEFAULT_STATE       = REPO_ROOT / "bridge" / "state" / "gmail_thread_watcher_state.json"

WATCH_LABEL  = os.getenv("GMAIL_WATCH_LABEL", "AIEiji/Watch")
ROOM_ID      = os.getenv("CHATWORK_ROOM_ID", "46076523")
LOOKBACK_DAYS = int(os.getenv("GMAIL_WATCH_LOOKBACK_DAYS", "1"))
SEEN_CAP     = 500  # state ファイル肥大化防止のため、保持する seen_message_ids 上限


def log(level: str, msg: str):
    ts = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}][{level}] {msg}")


# =============================================================
# 環境変数 / 設定
# =============================================================

def _env_path(var: str, default: Path) -> Path:
    v = os.getenv(var)
    return Path(v) if v else default


def load_env_from_orchestrator():
    """orchestrator/.env を簡易パースして環境変数に流し込む（CHATWORK_API_TOKEN 等）"""
    env_file = REPO_ROOT / "orchestrator" / ".env"
    if not env_file.exists():
        return
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v
    except OSError as e:
        log("WARN", f".env 読込失敗（継続）: {e}")


# =============================================================
# 状態ファイル
# =============================================================

def load_state(path: Path) -> dict:
    if not path.exists():
        return {"last_check_at": None, "seen_message_ids": []}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log("WARN", f"状態ファイル読込失敗（初期化扱い）: {e}")
        return {"last_check_at": None, "seen_message_ids": []}


def save_state(path: Path, state: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


# =============================================================
# Gmail 認証
# =============================================================

def get_gmail_service(credentials_path: Path, token_path: Path):
    """OAuth2 認証して Gmail API service を返す。トークン未取得時は対話フローを起動。"""
    creds = None
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
        except Exception as e:
            log("WARN", f"トークンファイル読込失敗（再認証）: {e}")
            creds = None

    if creds and creds.valid:
        pass
    elif creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            log("INFO", "アクセストークンをリフレッシュしました")
        except Exception as e:
            log("ERROR", f"トークンリフレッシュ失敗: {e}")
            creds = None

    if not creds or not creds.valid:
        if not credentials_path.exists():
            raise FileNotFoundError(
                f"OAuth クライアント secret が見つかりません: {credentials_path}\n"
                "  Google Cloud Console で OAuth Desktop アプリを作成し、"
                "credentials.json をこの場所に配置してください。"
            )
        if not sys.stdin.isatty():
            raise RuntimeError(
                "トークンが無効/未生成ですが、無人実行のため対話認証できません。"
                "1106PC のデスクトップで一度手動実行してトークンを生成してください。"
            )
        log("INFO", "ブラウザで OAuth 同意フローを起動します...")
        flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
        creds = flow.run_local_server(port=0)
        token_path.parent.mkdir(parents=True, exist_ok=True)
        with open(token_path, "w", encoding="utf-8") as f:
            f.write(creds.to_json())
        log("OK", f"トークンを保存しました: {token_path}")

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# =============================================================
# Gmail API ヘルパー
# =============================================================

def find_label_id(service, label_name: str) -> str | None:
    resp = service.users().labels().list(userId="me").execute()
    for lbl in resp.get("labels", []):
        if lbl.get("name") == label_name:
            return lbl.get("id")
    return None


def list_messages_with_label(service, label_id: str, after_epoch: int) -> list[dict]:
    """指定ラベル付きで after_epoch（UNIX秒）以降のメッセージ ID 一覧を取得"""
    query = f"after:{after_epoch}"
    messages = []
    page_token = None
    while True:
        req = service.users().messages().list(
            userId="me",
            labelIds=[label_id],
            q=query,
            maxResults=100,
            pageToken=page_token,
        )
        resp = req.execute()
        messages.extend(resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return messages


def get_message_metadata(service, message_id: str) -> dict:
    return service.users().messages().get(
        userId="me",
        id=message_id,
        format="metadata",
        metadataHeaders=["Subject", "From", "Date"],
    ).execute()


def parse_headers(msg: dict) -> dict:
    headers = msg.get("payload", {}).get("headers", [])
    return {h["name"]: h["value"] for h in headers}


def epoch_ms_to_jst_str(ms: int) -> str:
    dt = datetime.fromtimestamp(ms / 1000, tz=JST)
    return dt.strftime("%Y-%m-%d %H:%M:%S JST")


# =============================================================
# Chatwork 通知
# =============================================================

def notify_chatwork(token: str, room_id: str, body: str) -> bool:
    url = f"https://api.chatwork.com/v2/rooms/{room_id}/messages"
    data = urllib.parse.urlencode({"body": body, "self_unread": "1"}).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"X-ChatWorkToken": token},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        log("ERROR", f"Chatwork 送信失敗: {e}")
        return False


def build_notification_body(items: list[dict]) -> str:
    """新着返信のリストを 1 通の Chatwork メッセージに整形"""
    lines = [
        "[info][title]AIEiji秘書: Gmail 監視スレッド新着返信[/title]",
        f"件数: {len(items)} 件",
        "",
    ]
    for i, it in enumerate(items, 1):
        lines.append(f"{i}. 件名: {it['subject']}")
        lines.append(f"   送信者: {it['from']}")
        lines.append(f"   受信時刻: {it['received_at']}")
        lines.append(f"   https://mail.google.com/mail/u/0/#inbox/{it['thread_id']}")
        lines.append("")
    lines.append("[/info]")
    return "\n".join(lines)


# =============================================================
# メイン
# =============================================================

def main() -> int:
    log("INFO", "========== gmail_thread_watcher v1.0 開始 ==========")

    load_env_from_orchestrator()

    credentials_path = _env_path("GMAIL_CREDENTIALS_FILE", DEFAULT_CREDENTIALS)
    token_path       = _env_path("GMAIL_TOKEN_FILE",       DEFAULT_TOKEN)
    state_path       = _env_path("GMAIL_WATCH_STATE_FILE", DEFAULT_STATE)

    chatwork_token = os.getenv("CHATWORK_API_TOKEN")
    if not chatwork_token:
        log("FATAL", "CHATWORK_API_TOKEN 未設定（orchestrator/.env を確認）")
        return 2

    log("INFO", f"watch_label={WATCH_LABEL} room_id={ROOM_ID}")
    log("INFO", f"credentials={credentials_path}")
    log("INFO", f"token      ={token_path}")
    log("INFO", f"state      ={state_path}")

    # --- Gmail 認証 ---
    try:
        service = get_gmail_service(credentials_path, token_path)
    except Exception as e:
        log("FATAL", f"Gmail 認証失敗: {e}")
        return 2

    # --- ラベル ID 取得 ---
    label_id = find_label_id(service, WATCH_LABEL)
    if not label_id:
        log("FATAL", f"ラベルが見つかりません: {WATCH_LABEL}（Gmail で作成し、監視対象スレッドに付与してください）")
        return 2
    log("INFO", f"ラベル ID 解決: {WATCH_LABEL} -> {label_id}")

    # --- 状態ロード ---
    state = load_state(state_path)
    seen_ids = set(state.get("seen_message_ids", []))
    last_check_at = state.get("last_check_at")

    if last_check_at:
        try:
            after_dt = datetime.fromisoformat(last_check_at)
        except ValueError:
            after_dt = datetime.now(JST) - timedelta(days=LOOKBACK_DAYS)
    else:
        after_dt = datetime.now(JST) - timedelta(days=LOOKBACK_DAYS)
        log("INFO", f"初回起動: 過去 {LOOKBACK_DAYS} 日分を遡及対象とします")

    after_epoch = int(after_dt.timestamp())
    now_jst = datetime.now(JST)

    # --- メッセージ列挙 ---
    try:
        msg_refs = list_messages_with_label(service, label_id, after_epoch)
    except HttpError as e:
        log("FATAL", f"Gmail API エラー: {e}")
        return 2

    log("INFO", f"取得メッセージ数（候補）: {len(msg_refs)}")

    # --- 新着メッセージ抽出 & 整形 ---
    new_items = []
    for ref in msg_refs:
        mid = ref["id"]
        if mid in seen_ids:
            continue
        try:
            msg = get_message_metadata(service, mid)
        except HttpError as e:
            log("WARN", f"メッセージ取得失敗 (id={mid}): {e}")
            continue

        internal_ms = int(msg.get("internalDate", "0"))
        # 念のため after_epoch 以降のみ（API クエリと重複チェック）
        if internal_ms < after_epoch * 1000:
            seen_ids.add(mid)
            continue

        headers = parse_headers(msg)
        new_items.append({
            "message_id": mid,
            "thread_id":  msg.get("threadId", ""),
            "subject":    headers.get("Subject", "(件名なし)"),
            "from":       headers.get("From", "(送信者不明)"),
            "received_at": epoch_ms_to_jst_str(internal_ms),
            "internal_ms": internal_ms,
        })
        seen_ids.add(mid)

    log("INFO", f"新着返信: {len(new_items)} 件")

    # --- Chatwork 通知 ---
    notify_ok = True
    if new_items:
        new_items.sort(key=lambda x: x["internal_ms"])
        body = build_notification_body(new_items)
        notify_ok = notify_chatwork(chatwork_token, ROOM_ID, body)
        if notify_ok:
            log("OK", f"Chatwork 通知送信完了 ({len(new_items)} 件)")
        else:
            log("ERROR", "Chatwork 通知送信失敗 → 状態ファイルは更新せずリトライ可能にします")

    # --- 状態保存（通知失敗時は last_check_at を更新しない＝再送可能） ---
    if notify_ok:
        # seen_ids は SEEN_CAP 件で頭からトリム（古いものから）
        seen_list = list(seen_ids)
        if len(seen_list) > SEEN_CAP:
            seen_list = seen_list[-SEEN_CAP:]
        save_state(state_path, {
            "last_check_at": now_jst.isoformat(timespec="seconds"),
            "seen_message_ids": seen_list,
        })
        log("OK", f"状態ファイル更新: last_check_at={now_jst.isoformat(timespec='seconds')}")
    else:
        return 1

    log("INFO", "========== gmail_thread_watcher 正常終了 ==========")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("WARN", "中断されました")
        sys.exit(130)
