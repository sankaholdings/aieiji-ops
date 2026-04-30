const BASE_URL = "https://api.chatwork.com/v2";

export interface Room {
  room_id: number;
  name: string;
  type: "my" | "direct" | "group";
  role: "admin" | "member" | "readonly";
  sticky: boolean;
  unread_num: number;
  mention_num: number;
  mytask_num: number;
  message_num: number;
  file_num: number;
  task_num: number;
  icon_path: string;
  last_update_time: number;
}

export interface Account {
  account_id: number;
  name: string;
  chatwork_id?: string;
  organization_id?: number;
  organization_name?: string;
  department?: string;
  title?: string;
  url?: string;
  introduction?: string;
  mail?: string;
  tel_organization?: string;
  tel_extension?: string;
  tel_mobile?: string;
  skype?: string;
  facebook?: string;
  twitter?: string;
  avatar_image_url?: string;
  login_mail?: string;
}

export interface Message {
  message_id: string;
  account: {
    account_id: number;
    name: string;
    avatar_image_url: string;
  };
  body: string;
  send_time: number;
  update_time: number;
}

export interface PostMessageResult {
  message_id: string;
}

export interface MarkAsReadResult {
  unread_num: number;
  mention_num: number;
}

export class ChatworkAPI {
  constructor(private readonly token: string) {}

  private async request<T>(
    pathname: string,
    init?: RequestInit
  ): Promise<T | null> {
    const res = await fetch(`${BASE_URL}${pathname}`, {
      ...init,
      headers: {
        ...init?.headers,
        "X-ChatWorkToken": this.token,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      throw new Error(
        `Chatwork API ${pathname} -> ${res.status} ${res.statusText}: ${text}`
      );
    }
    if (res.status === 204) {
      return null;
    }
    const text = await res.text();
    if (text.length === 0) {
      return null;
    }
    return JSON.parse(text) as T;
  }

  async listRooms(): Promise<Room[]> {
    return (await this.request<Room[]>("/rooms")) ?? [];
  }

  async getMe(): Promise<Account> {
    const me = await this.request<Account>("/me");
    if (!me) throw new Error("GET /me returned empty body");
    return me;
  }

  /**
   * Chatwork ルームのメッセージを取得する。
   *
   * 既知の挙動 (1106PC orchestrator が試走で発見・サンプル3):
   *   - force=0 (未読のみ) は1回呼ぶと last_read_message_id が前進し、
   *     2回目以降の force=0 は空を返す。すなわち実質「既読化」副作用あり。
   *   - READ-ONLY 用途では force=true (?force=1, 最新100件・副作用なし) を
   *     使用し、呼び出し側で時間絞り込み等を行うこと。
   *
   * デフォルトは force=true (READ-ONLY 安全側)。
   */
  async getMessages(roomId: number, force = true): Promise<Message[]> {
    const qs = force ? "?force=1" : "?force=0";
    return (await this.request<Message[]>(`/rooms/${roomId}/messages${qs}`)) ?? [];
  }

  async sendMessage(
    roomId: number,
    body: string,
    selfUnread = false
  ): Promise<PostMessageResult> {
    const params = new URLSearchParams();
    params.set("body", body);
    if (selfUnread) params.set("self_unread", "1");
    const result = await this.request<PostMessageResult>(
      `/rooms/${roomId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }
    );
    if (!result) throw new Error("POST messages returned empty body");
    return result;
  }

  async markAsRead(roomId: number, messageId?: string): Promise<MarkAsReadResult> {
    const qs = messageId ? `?message_id=${encodeURIComponent(messageId)}` : "";
    const result = await this.request<MarkAsReadResult>(
      `/rooms/${roomId}/messages/read${qs}`,
      { method: "PUT" }
    );
    if (!result) throw new Error("PUT messages/read returned empty body");
    return result;
  }
}
