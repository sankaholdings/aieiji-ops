#!/usr/bin/env python3
# =============================================================
# process_inbox.py
# 役割: Chatwork未読JSON（Inbound）→ 返信案JSON（Outbound）変換
# バージョン: v2.0-production
# 作成: 2026-04-15 AIEijiSE
# 更新: 2026-04-15 Phase 4 - モック関数をClaude API呼び出しに差し替え
#
# 【動作概要】
# 1. 00_Inbox/chatwork_unread_*.json を未処理順に1件取得
# 2. COO処理（本番LLM）: Claude APIで6項目を本物生成
# 3. Outboundスキーマ準拠のJSONを組み立て
# 4. 05_Secretary_Outbox/chatwork_reply_draft_[YYYYMMDD_HHmm].json として出力
# 5. 処理済み元ファイルを 00_Inbox/Processed/ へ移動（二重処理防止）
#
# 【絶対遵守ハーネス】
# 全LLM呼び出しのシステムプロンプトに以下を必ず付与し、JSON崩壊を物理的に防ぐ:
#   - 挨拶/前置き/後置き/解説を一切排除
#   - Markdown装飾、コードブロック、引用符での囲みを一切禁止
#   - 要求された文字列のみをプレーンテキストで出力
#   - 出力後の strip() で残存する空白・改行を除去
# =============================================================

import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from glob import glob

# --- LLM/環境変数 ---
try:
    from anthropic import Anthropic
    from dotenv import load_dotenv
    LLM_AVAILABLE = True
except ImportError as e:
    LLM_AVAILABLE = False
    _IMPORT_ERROR = str(e)

# --- パス定数 ---
# 自宅PC(D:\Gドライブ) / 職場PC(E:\GoogleDrive) を自動検出
# AIEIJI_BASE_DIR 環境変数で明示指定も可
def _detect_base_dir() -> Path:
    env_base = os.getenv("AIEIJI_BASE_DIR")
    if env_base:
        return Path(env_base)
    candidates = [
        Path(r"D:\Gドライブ\さんか経営会議（経営分析）\00_System (システム設定)\Claude(SANKA)"),
        Path(r"E:\GoogleDrive\さんか経営会議（経営分析）\00_System (システム設定)\Claude(SANKA)"),
        Path("C:/ClaudeSync"),  # 旧パス（後方互換）
    ]
    for c in candidates:
        if c.exists():
            return c
    raise RuntimeError(
        "BASE_DIR を特定できません。AIEIJI_BASE_DIR 環境変数で明示指定してください。"
    )

BASE_DIR        = _detect_base_dir()
INBOX_DIR       = BASE_DIR / "00_Inbox"
PROCESSED_DIR   = INBOX_DIR / "Processed"
OUTBOX_DIR      = BASE_DIR / "05_Secretary_Outbox"
ENV_FILE        = BASE_DIR / ".env"

# --- Email Pipeline 関連パス（Phase G2追加）---
SENT_CONTACTS_FILE   = BASE_DIR / "06_SE" / "sent_contacts.json"
LEARNED_RULES_FILE   = BASE_DIR / "06_SE" / "learned_rules_email.json"
TARGET_EMAIL_ADDRESS = "ejsanka@gmail.com"

JST = timezone(timedelta(hours=9))

# --- LLM定数 ---
CLAUDE_MODEL = "claude-sonnet-4-5"  # 最新Sonnet 4.5。障害時は claude-sonnet-4-5-20250929 にフォールバック
MAX_TOKENS_SHORT  = 200   # summary, sender_org, priority, context
MAX_TOKENS_REPLY  = 600   # draft_reply
MAX_TOKENS_BRIEF  = 1500  # briefing_text

# 全LLM呼び出しに付与する絶対遵守ハーネス
HARNESS_RULES = """あなたはAIEiji秘書のCOO（最高執行責任者）コンポーネントです。以下の絶対遵守ルールを必ず守ってください。違反は契約違反とみなされます。

【絶対遵守ルール】
1. 挨拶、前置き、後置き、解説、感想、自己紹介を一切出力しないこと
2. 「以下が〜です」「お手伝いします」「承知しました」のような枕詞を一切使わないこと
3. Markdown装飾（**太字**、`コード`、見出し#、箇条書き-、>引用、表など）を一切使わないこと
4. JSON、引用符、コードブロック（```）で出力を包まないこと
5. 出力の前後に空行・改行を入れないこと
6. 要求された情報以外のフィールドや構造を絶対に追加しないこと
7. 文字数や行数の制限が指示されている場合は厳守すること
8. 純粋なプレーンテキストのみを出力すること"""


# =============================================================
# ユーティリティ
# =============================================================

def log(level: str, msg: str):
    ts = datetime.now(JST).strftime("%H:%M:%S")
    print(f"[{ts}][{level}] {msg}")


def ensure_dirs():
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)


def find_unprocessed_inbox() -> Path | None:
    pattern = str(INBOX_DIR / "chatwork_unread_*.json")
    candidates = sorted(glob(pattern))
    if not candidates:
        return None
    return Path(candidates[0])


def find_unprocessed_email() -> Path | None:
    """email_unread_*.json を未処理順に1件取得（Phase G2）"""
    pattern = str(INBOX_DIR / "email_unread_*.json")
    candidates = sorted(glob(pattern))
    if not candidates:
        return None
    return Path(candidates[0])


# =============================================================
# Email Pipeline ヘルパー（Phase G2追加）
# =============================================================

def load_sent_contacts() -> set[str]:
    """sent_contacts.json から過去送信先アドレスを読み込んで set で返す"""
    if not SENT_CONTACTS_FILE.exists():
        log("WARN", f"sent_contacts.json が見つかりません: {SENT_CONTACTS_FILE}")
        return set()
    try:
        with open(SENT_CONTACTS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        addresses = {c["address"].lower().strip() for c in data.get("contacts", [])}
        log("INFO", f"sent_contacts.json 読込: {len(addresses)}件のアドレス")
        return addresses
    except (json.JSONDecodeError, KeyError, OSError) as e:
        log("ERROR", f"sent_contacts.json 読込失敗: {e}")
        return set()


def load_learned_rules() -> dict:
    """learned_rules_email.json を読み込む。存在しなければ空のテンプレートを返す"""
    if not LEARNED_RULES_FILE.exists():
        return {"skip_rules": [], "reply_templates": []}
    try:
        with open(LEARNED_RULES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log("WARN", f"learned_rules_email.json 読込失敗（空で継続）: {e}")
        return {"skip_rules": [], "reply_templates": []}


def is_important_email(email: dict, sent_contacts: set[str]) -> tuple[bool, str]:
    """
    ハイブリッド判定: ①過去返信相手 OR ②To直接宛 → 重要
    戻り値: (重要かどうか, 理由)
    """
    sender_addr = (email.get("sender_address") or "").lower().strip()
    to_me_direct = email.get("_meta", {}).get("to_me_direct", False)

    if sender_addr and sender_addr in sent_contacts:
        return True, "past_replied"
    if to_me_direct:
        return True, "to_me_direct"
    return False, "low_relevance"


def matches_skip_rule(email: dict, skip_rules: list[dict]) -> tuple[bool, str]:
    """learned_rules_email.json の skip_rules に一致するか判定"""
    sender_addr = (email.get("sender_address") or "").lower().strip()
    subject     = (email.get("subject") or "").lower()
    domain      = sender_addr.split("@")[-1] if "@" in sender_addr else ""

    for rule in skip_rules:
        ctype = rule.get("condition_type")
        value = (rule.get("value") or "").lower().strip()
        if ctype == "domain" and domain == value.lstrip("@"):
            return True, f"domain={value}"
        if ctype == "address" and sender_addr == value:
            return True, f"address={value}"
        if ctype == "subject_contains" and value in subject:
            return True, f"subject_contains={value}"
    return False, ""


def find_reply_template(email: dict, templates: list[dict]) -> str:
    """learned_rules_email.json の reply_templates に一致するテンプレを返す"""
    sender_addr = (email.get("sender_address") or "").lower().strip()
    domain      = sender_addr.split("@")[-1] if "@" in sender_addr else ""

    for tpl in templates:
        ctype = tpl.get("condition_type")
        value = (tpl.get("value") or "").lower().strip()
        if ctype == "address" and sender_addr == value:
            return tpl.get("template", "")
        if ctype == "domain" and domain == value.lstrip("@"):
            return tpl.get("template", "")
    return ""


def strip_email_body(body: str, max_chars: int = 1500) -> str:
    """メール本文から署名・引用を簡易除去"""
    if not body:
        return ""
    # 引用行（> から始まる行）を除去
    lines = [l for l in body.splitlines() if not l.lstrip().startswith(">")]
    # 署名区切り（-- 単独行）以降を除去
    cleaned = []
    for l in lines:
        if l.strip() == "--":
            break
        cleaned.append(l)
    text = "\n".join(cleaned).strip()
    if len(text) > max_chars:
        text = text[:max_chars] + "\n...[本文以下省略]"
    return text


def strip_chatwork_markup(body: str) -> str:
    """Chatwork記法タグを除去してプレーンテキストに変換"""
    text = re.sub(r'\[/?info\]|\[/?title\]', '', body)
    text = re.sub(r'\[preview[^\]]*\]', '', text)
    text = re.sub(r'\[download:[^\]]+\](.*?)\[/download\]', r'\1', text)
    text = re.sub(r'\[[^\]]+\]', '', text)
    return text.strip()


def days_ago_from(send_time_str: str) -> int:
    try:
        dt = datetime.fromisoformat(send_time_str)
        now = datetime.now(JST)
        return (now - dt).days
    except Exception:
        return 0


# =============================================================
# LLMクライアント初期化
# =============================================================

_client = None  # グローバルキャッシュ

def get_llm_client():
    """anthropicクライアントを初期化（シングルトン）"""
    global _client
    if _client is not None:
        return _client

    if not LLM_AVAILABLE:
        log("WARN", f"anthropic/dotenv未インストール: {_IMPORT_ERROR}")
        return None

    if ENV_FILE.exists():
        load_dotenv(ENV_FILE, override=True)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        log("WARN", "ANTHROPIC_API_KEY未設定。.envに追記が必要")
        return None

    try:
        _client = Anthropic(api_key=api_key)
        log("INFO", f"Anthropicクライアント初期化完了 (model={CLAUDE_MODEL})")
        return _client
    except Exception as e:
        log("ERROR", f"Anthropicクライアント初期化失敗: {e}")
        return None


def llm_call(user_prompt: str, max_tokens: int) -> str:
    """
    LLM呼び出し共通関数。失敗時は [ERROR] プレフィックス文字列を返す。
    JSON生成自体は止めない設計。
    """
    client = get_llm_client()
    if client is None:
        return "[ERROR] LLMクライアント未初期化"

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=max_tokens,
            system=HARNESS_RULES,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = response.content[0].text if response.content else ""
        # ハーネス違反対策: 残存するMarkdown記号と引用符を除去
        text = text.strip()
        text = text.strip('`"\'')
        text = re.sub(r'^```[a-zA-Z]*\n?', '', text)
        text = re.sub(r'\n?```$', '', text)
        return text.strip()
    except Exception as e:
        log("ERROR", f"LLM呼び出し失敗: {type(e).__name__}: {str(e)[:120]}")
        return f"[ERROR] LLM呼び出し失敗: {type(e).__name__}"


# =============================================================
# COO処理レイヤー（本番Claude API実装）
# =============================================================

def coo_generate_summary(body: str, room_name: str) -> str:
    """メッセージ本文の要約を生成する"""
    plain = strip_chatwork_markup(body)
    if not plain:
        return f"{room_name}からファイル/画像のみの送信（テキスト本文なし）"

    prompt = f"""以下のChatworkメッセージを、社長が一目で内容を把握できるように60文字以内の日本語1文で要約してください。

【厳守事項】
- 60文字以内の1文のみ
- 「〜という内容です」「要約すると〜」のような枕詞は禁止
- 句点で終わること
- 推測や補足は一切不要
- 要約結果のみを出力

【ルーム名】{room_name}
【メッセージ本文】
{plain[:800]}"""

    return llm_call(prompt, MAX_TOKENS_SHORT)


def coo_resolve_sender_org(sender: str, sender_id: int) -> str:
    """送信者の所属組織を推定する"""
    prompt = f"""以下のChatwork送信者の名前から所属組織（会社名）を推定してください。

【厳守事項】
- 推定できる場合: 会社名のみを出力（例: タッグライン株式会社）
- 推定できない場合: 「不明」とだけ出力
- 一切の解説・前置き禁止
- 30文字以内

【送信者名】{sender}
【sender_id】{sender_id}"""

    return llm_call(prompt, MAX_TOKENS_SHORT)


def coo_assess_priority(to_me: bool, mention_count: int, days_ago: int,
                         body: str = "", sender: str = "") -> str:
    """メッセージの優先度を判定する"""
    plain = strip_chatwork_markup(body)
    prompt = f"""以下のChatworkメッセージの優先度を判定し、3つのカテゴリのいずれか1つだけを出力してください。

【出力候補】（このいずれか1つだけ）
要返信
確認のみ
FYI

【厳守事項】
- 上記3つのうち1つだけを出力
- 解説・理由・補足は一切禁止
- 4文字以内

【判定材料】
- 自分宛て(To): {to_me}
- メンション数: {mention_count}
- 経過日数: {days_ago}日
- 送信者: {sender}
- 本文抜粋: {plain[:200]}"""

    result = llm_call(prompt, MAX_TOKENS_SHORT)
    # 万一のフェイルセーフ: 期待値以外ならルールベースに戻す
    if result not in ("要返信", "確認のみ", "FYI"):
        if to_me or mention_count > 0:
            return "要返信"
        if days_ago > 14:
            return "確認のみ"
        return "FYI"
    return result


def coo_generate_context(room_name: str, sender: str, body: str = "") -> str:
    """メッセージの背景・関係性を生成する"""
    plain = strip_chatwork_markup(body)
    prompt = f"""以下のChatworkメッセージから、社長が文脈を素早く理解できる100文字以内の背景説明を1文で生成してください。

【厳守事項】
- 100文字以内の1文
- 「〜と推測されます」「〜のようです」など断定を避けつつ簡潔に
- 不明な場合は「{sender}との関係性は未取得」とだけ出力
- 一切の前置き禁止

【ルーム名】{room_name}
【送信者】{sender}
【本文抜粋】
{plain[:400]}"""

    return llm_call(prompt, MAX_TOKENS_SHORT)


def coo_generate_draft_reply(body: str, sender: str, priority: str) -> str:
    """返信案を生成する"""
    plain = strip_chatwork_markup(body)

    if priority == "FYI":
        return ""  # FYIは返信不要

    prompt = f"""以下のChatworkメッセージに対する返信案を作成してください。

【厳守事項】
- 100〜200文字程度のビジネス日本語
- 冒頭は「{sender}さん、」で開始
- 末尾は「よろしくお願いいたします。」で締める
- 改行は「。」の後に必要最小限のみ
- 一切の前置き・解説・選択肢提示禁止（返信本文のみ）
- 推測や約束は一切しない

【優先度】{priority}
【元メッセージ】
{plain[:600]}"""

    return llm_call(prompt, MAX_TOKENS_REPLY)


def coo_build_briefing_text(items: list[dict], generated_at: str) -> str:
    """マイチャットへ投稿するブリーフィング全文を組み立てる"""
    dt_str = generated_at[:16].replace("T", " ")

    # アイテム情報をLLMに渡す形式に整形
    items_summary = []
    for item in items:
        items_summary.append(
            f"{item['id']}. [{item['priority']}] {item['room_name']}（{item['days_ago']}日前）\n"
            f"   要約: {item['summary']}\n"
            f"   返信案: {item['draft_reply'][:80] if item['draft_reply'] else '（返信不要）'}"
        )
    items_text = "\n\n".join(items_summary)

    prompt = f"""以下の未読メッセージ一覧を、社長がマイチャットで見やすい形式の「秘書ブリーフィング」テキストに整形してください。

【絶対の出力フォーマット】
AIEiji秘書 未読ブリーフィング - {dt_str}

未読: {len(items)}件

【要返信】
A. （ルーム名）（経過日数）
   要約文
   → 案: 返信案先頭40文字程度...

【確認のみ】
B. ...

━━━ ご指示ください ━━━
「Aは案の通り」「Aはこう返して：〇〇」「既読のみ」

【厳守事項】
- 上記フォーマットを厳密に守る
- 優先度ごとにグループ化（要返信→確認のみ→FYI の順）
- 該当アイテムがない優先度カテゴリは見出しごと省略
- Markdown装飾は一切使わない
- 末尾の「━━━ ご指示ください ━━━」セクションは必ず含める
- これ以外の前置き・後置き・解説を一切付けない

【アイテム一覧】
{items_text}"""

    return llm_call(prompt, MAX_TOKENS_BRIEF)


# =============================================================
# Email専用 COO処理（Phase G2）
# =============================================================

def coo_email_summary(subject: str, body: str, sender_name: str) -> str:
    """メール内容を60文字で要約"""
    plain = strip_email_body(body, 1500)
    if not plain:
        return f"{sender_name}から件名「{subject[:30]}」のメール（本文なし）"

    prompt = f"""以下のメールを、社長が一目で内容を把握できるように60文字以内の日本語1文で要約してください。

【厳守事項】
- 60文字以内の1文のみ
- 件名と本文の両方を踏まえる
- 「〜という内容です」のような枕詞禁止
- 句点で終わること

【件名】{subject}
【送信者】{sender_name}
【本文抜粋】
{plain[:800]}"""

    return llm_call(prompt, MAX_TOKENS_SHORT)


def coo_email_priority(reason: str, subject: str, body: str, sender_name: str) -> str:
    """メールの優先度を3カテゴリで判定"""
    plain = strip_email_body(body, 600)
    prompt = f"""以下のメールの優先度を判定し、3カテゴリのいずれか1つだけ出力してください。

【出力候補】（このいずれか1つだけ）
要返信
確認のみ
FYI

【厳守事項】
- 上記3つのうち1つだけ
- 解説禁止・4文字以内

【判定材料】
- 重要判定理由: {reason}（past_replied=過去返信先 / to_me_direct=直接To宛て）
- 件名: {subject}
- 送信者: {sender_name}
- 本文抜粋: {plain[:300]}"""

    result = llm_call(prompt, MAX_TOKENS_SHORT)
    if result not in ("要返信", "確認のみ", "FYI"):
        # フェイルセーフ
        if reason == "past_replied":
            return "要返信"
        if reason == "to_me_direct":
            return "確認のみ"
        return "FYI"
    return result


def coo_email_context(sender_name: str, sender_address: str, subject: str) -> str:
    """メールの背景・関係性を100文字で生成"""
    prompt = f"""以下のメール送信者との関係や文脈を、100文字以内の1文で生成してください。

【厳守事項】
- 100文字以内の1文
- 不明な場合は「{sender_name}との関係性は未取得」とだけ出力
- 一切の前置き禁止

【送信者名】{sender_name}
【送信者アドレス】{sender_address}
【件名】{subject}"""

    return llm_call(prompt, MAX_TOKENS_SHORT)


def coo_email_draft_reply(subject: str, body: str, sender_name: str, priority: str,
                            template: str = "") -> str:
    """メール返信案を生成。学習テンプレがあればベースに使う"""
    if priority == "FYI":
        return ""
    plain = strip_email_body(body, 800)

    template_hint = ""
    if template:
        template_hint = f"\n\n【参考テンプレート（学習済み）】\n{template}\n上記をベースに状況に合わせて調整してください。"

    prompt = f"""以下のメールへの返信本文を作成してください。

【厳守事項】
- ビジネス日本語・150〜300文字程度
- 冒頭は「{sender_name} 様\\n\\nお世話になっております。三箇でございます。」で開始
- 末尾は「\\n\\nどうぞよろしくお願いいたします。\\n\\n三箇 栄司」で締める
- 改行は適切に挿入（\\n\\nで段落区切り）
- 推測や約束は禁止
- 返信本文のみを出力（件名・宛先ヘッダー等は不要）

【優先度】{priority}
【元件名】{subject}
【元本文】
{plain}{template_hint}"""

    return llm_call(prompt, MAX_TOKENS_REPLY)


def coo_build_email_briefing_text(items: list[dict], generated_at: str,
                                     skipped_count: int = 0) -> str:
    """メール用ブリーフィング全文を組み立てる"""
    dt_str = generated_at[:16].replace("T", " ")

    items_summary = []
    for item in items:
        items_summary.append(
            f"{item['id']}. [{item['priority']}] {item['sender_name']} <{item['sender_address']}>\n"
            f"   件名: {item['subject']}\n"
            f"   要約: {item['summary']}\n"
            f"   返信案: {item['draft_reply'][:80] if item['draft_reply'] else '（返信不要）'}"
        )
    items_text = "\n\n".join(items_summary)

    skip_note = f"\n（スキップルール適用: {skipped_count}件）" if skipped_count else ""

    prompt = f"""以下の重要メール一覧を、社長がマイチャットで見やすい「秘書ブリーフィング(Email版)」に整形してください。

【絶対の出力フォーマット】
AIEiji秘書 メールブリーフィング - {dt_str}

重要メール: {len(items)}件{skip_note}

【要返信】
A. 送信者名 <addr>
   件名: ...
   要約: ...
   → 案: 返信案先頭40文字程度...

【確認のみ】
B. ...

━━━ ご指示ください（メール）━━━
「Aは案の通り送信」「Aはこう返して：〇〇」「Aはスキップ」「以後スキップ @domain.com」

【厳守事項】
- 上記フォーマット厳守
- 優先度ごとにグループ化（要返信→確認のみ→FYI）
- 該当なしの優先度は見出しごと省略
- Markdown装飾禁止
- 末尾の指示セクションは必ず含める

【アイテム一覧】
{items_text}"""

    return llm_call(prompt, MAX_TOKENS_BRIEF)


# =============================================================
# 変換コア処理
# =============================================================

def build_outbound(inbound: dict, source_filename: str) -> dict:
    now_str = datetime.now(JST).strftime("%Y-%m-%dT%H:%M:%S+09:00")
    items = []
    item_id = ord("A")

    for room in inbound.get("rooms", []):
        room_id    = room["room_id"]
        room_name  = room["room_name"]
        room_type  = room.get("room_type", "group")
        mention_count = room.get("mention_count", 0)

        messages = room.get("messages", [])
        if not messages:
            continue

        msg = messages[-1]
        body        = msg.get("body", "")
        sender      = msg.get("sender", "")
        sender_id   = msg.get("sender_id", 0)
        send_time   = msg.get("send_time", "")
        to_me       = msg.get("to_me", False)
        message_id  = msg.get("message_id", "")

        # --- COO処理（本番LLM） ---
        d_ago       = days_ago_from(send_time)
        log("LLM ", f"item {chr(item_id)}: 要約生成中...")
        summary     = coo_generate_summary(body, room_name)
        log("LLM ", f"item {chr(item_id)}: 所属解決中...")
        sender_org  = coo_resolve_sender_org(sender, sender_id)
        log("LLM ", f"item {chr(item_id)}: 優先度判定中...")
        priority    = coo_assess_priority(to_me, mention_count, d_ago, body, sender)
        log("LLM ", f"item {chr(item_id)}: コンテキスト生成中...")
        context     = coo_generate_context(room_name, sender, body)
        log("LLM ", f"item {chr(item_id)}: 返信案生成中...")
        draft_reply = coo_generate_draft_reply(body, sender, priority)

        items.append({
            "id"                  : chr(item_id),
            "room_id"             : room_id,
            "room_name"           : room_name,
            "room_type"           : room_type,
            "priority"            : priority,
            "sender"              : sender,
            "sender_org"          : sender_org,
            "send_time"           : send_time,
            "days_ago"            : d_ago,
            "summary"             : summary,
            "context"             : context,
            "to_me"               : to_me,
            "has_mention"         : mention_count > 0,
            "confidence"          : "high",  # 本番LLM生成
            "recommended_action"  : "reply_short" if priority == "要返信" else "mark_read",
            "draft_reply"         : draft_reply,
            "alternative_action"  : "mark_read",
            "alternative_note"    : "返信不要の場合は既読化のみで対応可",
            "reply_to_message_id" : message_id,
        })

        item_id += 1

    log("LLM ", "ブリーフィング全文生成中...")
    briefing_text = coo_build_briefing_text(items, now_str)

    return {
        "type"         : "chatwork_reply_draft",
        "generated_at" : now_str,
        "source_file"  : source_filename,
        "generated_by" : f"AIEijiCOO-Production-v2.0 ({CLAUDE_MODEL})",
        "briefing_text": briefing_text,
        "total_items"  : len(items),
        "items"        : items,
    }


def build_outbound_email(inbound: dict, source_filename: str) -> dict:
    """email_unread_*.json → email_reply_draft_*.json の変換コア（Phase G2）"""
    now_str = datetime.now(JST).strftime("%Y-%m-%dT%H:%M:%S+09:00")
    sent_contacts = load_sent_contacts()
    rules         = load_learned_rules()
    skip_rules    = rules.get("skip_rules", [])
    templates     = rules.get("reply_templates", [])

    items = []
    skipped = []
    item_id = ord("A")

    for email in inbound.get("emails", []):
        message_id     = email.get("message_id", "")
        sender         = email.get("sender", "")
        sender_name    = email.get("sender_name", "")
        sender_address = (email.get("sender_address") or "").lower().strip()
        subject        = email.get("subject", "")
        body           = email.get("body_plain", "")
        received_at    = email.get("received_at", "")
        thread_id      = email.get("thread_id", "")

        # --- ハイブリッド重要判定 ---
        important, reason = is_important_email(email, sent_contacts)
        if not important:
            skipped.append({"address": sender_address, "subject": subject, "reason": "low_relevance"})
            continue

        # --- 学習スキップルール適用 ---
        is_skip, skip_reason = matches_skip_rule(email, skip_rules)
        if is_skip:
            log("INFO", f"スキップルール適用: {sender_address} ({skip_reason})")
            skipped.append({"address": sender_address, "subject": subject, "reason": skip_reason})
            continue

        # --- 学習テンプレート参照 ---
        template = find_reply_template(email, templates)

        d_ago = days_ago_from(received_at)

        # --- COO処理（本番LLM） ---
        log("LLM ", f"email {chr(item_id)}: 要約生成中... ({sender_address})")
        summary     = coo_email_summary(subject, body, sender_name)
        log("LLM ", f"email {chr(item_id)}: 優先度判定中...")
        priority    = coo_email_priority(reason, subject, body, sender_name)
        log("LLM ", f"email {chr(item_id)}: コンテキスト生成中...")
        context     = coo_email_context(sender_name, sender_address, subject)
        log("LLM ", f"email {chr(item_id)}: 返信案生成中...")
        draft_reply = coo_email_draft_reply(subject, body, sender_name, priority, template)

        items.append({
            "id"                  : chr(item_id),
            "message_id"          : message_id,
            "thread_id"           : thread_id,
            "priority"            : priority,
            "sender"              : sender,
            "sender_name"         : sender_name,
            "sender_address"      : sender_address,
            "to"                  : email.get("to", ""),
            "cc"                  : email.get("cc", ""),
            "subject"             : subject,
            "received_at"         : received_at,
            "days_ago"            : d_ago,
            "summary"             : summary,
            "context"             : context,
            "importance_reason"   : reason,
            "has_attachment"      : email.get("has_attachment", False),
            "confidence"          : "high",
            "recommended_action"  : "reply" if priority == "要返信" else "mark_read",
            "draft_reply"         : draft_reply,
            "template_used"       : bool(template),
            "alternative_action"  : "skip",
            "alternative_note"    : "「Aはスキップ」または「以後スキップ @domain」で学習可能",
        })
        item_id += 1

    log("LLM ", f"メールブリーフィング全文生成中... (重要={len(items)}件 / スキップ={len(skipped)}件)")
    briefing_text = coo_build_email_briefing_text(items, now_str, skipped_count=len(skipped))

    return {
        "type"           : "email_reply_draft",
        "generated_at"   : now_str,
        "source_file"    : source_filename,
        "generated_by"   : f"AIEijiCOO-Production-v2.1-Email ({CLAUDE_MODEL})",
        "target_address" : TARGET_EMAIL_ADDRESS,
        "briefing_text"  : briefing_text,
        "total_items"    : len(items),
        "skipped_count"  : len(skipped),
        "skipped_details": skipped,
        "items"          : items,
        "send_confirmation_required": True,  # Phase G5: 2ステップ確認フラグ
    }


# =============================================================
# メイン処理
# =============================================================

def _process_chatwork_file(inbox_file: Path) -> Path:
    """chatwork_unread_*.json の処理パス（既存ロジック）"""
    log("INFO", f"[CHATWORK] 処理対象: {inbox_file.name}")
    try:
        with open(inbox_file, encoding="utf-8") as f:
            inbound = json.load(f)
    except json.JSONDecodeError as e:
        log("ERROR", f"JSONパース失敗: {e}")
        sys.exit(1)

    log("INFO", f"  total_unread={inbound.get('total_unread', '?')}  "
                f"rooms={len(inbound.get('rooms', []))}")

    log("INFO", "COO処理（本番Claude API / Chatwork）開始...")
    outbound = build_outbound(inbound, inbox_file.name)
    log("INFO", f"  生成items数: {outbound['total_items']}")

    ts_suffix = datetime.now(JST).strftime("%Y%m%d_%H%M")
    out_filename = f"chatwork_reply_draft_{ts_suffix}.json"
    return _write_and_archive(outbound, out_filename, inbox_file)


def _process_email_file(inbox_file: Path) -> Path:
    """email_unread_*.json の処理パス（Phase G2）"""
    log("INFO", f"[EMAIL] 処理対象: {inbox_file.name}")
    try:
        with open(inbox_file, encoding="utf-8") as f:
            inbound = json.load(f)
    except json.JSONDecodeError as e:
        log("ERROR", f"JSONパース失敗: {e}")
        sys.exit(1)

    log("INFO", f"  total_count={inbound.get('total_count', '?')}  "
                f"target={inbound.get('target_address', '?')}")

    log("INFO", "COO処理（本番Claude API / Email）開始...")
    outbound = build_outbound_email(inbound, inbox_file.name)
    log("INFO", f"  重要items={outbound['total_items']}  スキップ={outbound['skipped_count']}")

    # 重要メールがゼロでもブリーフィングは出さず処理済みへ移動（無駄なマイチャット投稿を防ぐ）
    if outbound["total_items"] == 0:
        log("INFO", "重要メールなし → ブリーフィング省略")
        # Outboxには書かず、Inboxファイルだけ処理済みに移動
        dest = PROCESSED_DIR / inbox_file.name
        try:
            shutil.move(str(inbox_file), str(dest))
            log("OK", f"処理済み移動完了: 00_Inbox/{inbox_file.name} → Processed/")
        except OSError as e:
            log("ERROR", f"処理済み移動失敗: {e}")
        return None

    ts_suffix = datetime.now(JST).strftime("%Y%m%d_%H%M")
    out_filename = f"email_reply_draft_{ts_suffix}.json"
    return _write_and_archive(outbound, out_filename, inbox_file)


def _write_and_archive(outbound: dict, out_filename: str, inbox_file: Path) -> Path:
    """Outboxへ書き込み → 元ファイルをProcessedへ移動（共通処理）"""
    out_path = OUTBOX_DIR / out_filename

    if out_path.exists():
        log("WARN", f"同名ファイル既存: {out_filename} → スキップ")
        sys.exit(1)

    try:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(outbound, f, ensure_ascii=False, indent=2)
        log("OK", f"Outbox投下完了: {out_filename}  ({out_path.stat().st_size} bytes)")
    except OSError as e:
        log("ERROR", f"Outbox書き込み失敗: {e}")
        sys.exit(1)

    dest = PROCESSED_DIR / inbox_file.name
    try:
        shutil.move(str(inbox_file), str(dest))
        log("OK", f"処理済み移動完了: 00_Inbox/{inbox_file.name} → Processed/")
    except OSError as e:
        log("ERROR", f"処理済み移動失敗: {e}")
        sys.exit(1)

    return out_path


def main():
    log("INFO", "========== process_inbox.py v2.1 (Email対応) 開始 ==========")
    log("INFO", f"BASE_DIR = {BASE_DIR}")
    ensure_dirs()

    # --- 事前チェック: LLMクライアント初期化 ---
    client = get_llm_client()
    if client is None:
        log("FATAL", "LLMクライアント初期化失敗。ANTHROPIC_API_KEYを.envに追加してください。")
        sys.exit(2)

    # --- 未処理ファイル探索: Chatwork → Email の順 ---
    chatwork_file = find_unprocessed_inbox()
    if chatwork_file:
        result = _process_chatwork_file(chatwork_file)
        log("INFO", "========== process_inbox.py 正常終了（Chatwork処理） ==========")
        return result

    email_file = find_unprocessed_email()
    if email_file:
        result = _process_email_file(email_file)
        log("INFO", "========== process_inbox.py 正常終了（Email処理） ==========")
        return result

    log("INFO", "未処理のInboxファイルなし（Chatwork/Emailとも）。処理終了。")
    sys.exit(0)


if __name__ == "__main__":
    main()
