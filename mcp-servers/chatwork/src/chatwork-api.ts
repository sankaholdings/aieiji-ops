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

export class ChatworkAPI {
  constructor(private readonly token: string) {}

  private async request<T>(
    pathname: string,
    init?: RequestInit
  ): Promise<T> {
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
    return (await res.json()) as T;
  }

  async listRooms(): Promise<Room[]> {
    return this.request<Room[]>("/rooms");
  }
}
