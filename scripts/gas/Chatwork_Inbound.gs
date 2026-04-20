// =============================================================
// Chatwork_Inbound.gs
// 役割: Chatwork未読メッセージを取得し、GoogleドライブへJSON投下
// バージョン: v1.0
// 作成: 2026-04-13 AIEijiSE（ハイブリッド・ループ設計書 v1.0 Phase 1）
//
// 【動作概要】
// 1. Chatwork API で未読ルーム一覧を取得
// 2. 各ルームの未読メッセージ本文を取得
// 3. 設計書準拠のJSON構造に整形
// 4. GoogleドライブのInboxフォルダへ投下（ClaudeSync経由でローカル同期）
//
// 【セキュリティ】
// APIトークン・フォルダIDはスクリプトプロパティから取得（コード内直書き禁止）
// =============================================================

// --- 定数 ---
var CHATWORK_API_BASE = "https://api.chatwork.com/v2";

// =============================================================
// メイン関数: 5分おきトリガーで実行
// =============================================================
function checkChatworkUnread() {
  var props = PropertiesService.getScriptProperties();
  var apiToken   = props.getProperty("CHATWORK_API_TOKEN");
  var folderId   = props.getProperty("INBOX_FOLDER_ID");
  var myAccountId = props.getProperty("MY_ACCOUNT_ID");

  // --- プロパティ検証 ---
  if (!apiToken || !folderId) {
    Logger.log("[FATAL] スクリプトプロパティ未設定: CHATWORK_API_TOKEN / INBOX_FOLDER_ID");
    return;
  }

  // --- Step 1: 未読ルーム一覧取得 ---
  var rooms = callChatworkApi_(apiToken, "/rooms");
  if (!rooms) {
    Logger.log("[ERROR] /rooms API呼び出し失敗");
    return;
  }

  var unreadRooms = rooms.filter(function(room) {
    return room.unread_num > 0;
  });

  if (unreadRooms.length === 0) {
    Logger.log("[INFO] 未読なし。処理終了。");
    return;
  }

  Logger.log("[INFO] 未読ルーム数: " + unreadRooms.length);

  // --- Step 2: 各ルームの未読メッセージ取得 ---
  var totalUnread = 0;
  var roomDataList = [];

  for (var i = 0; i < unreadRooms.length; i++) {
    var room = unreadRooms[i];
    var roomId = room.room_id;

    // メッセージ取得（force=1で未読のみ取得可能にする）
    var messages = callChatworkApi_(apiToken, "/rooms/" + roomId + "/messages?force=1");

    if (!messages || messages.length === 0) {
      Logger.log("[WARN] room_id=" + roomId + " メッセージ取得失敗またはゼロ件");
      continue;
    }

    // 未読メッセージを抽出（send_timeが最新のものからunread_num件）
    var unreadMessages = messages.slice(-room.unread_num);

    var formattedMessages = unreadMessages.map(function(msg) {
      return {
        message_id: String(msg.message_id),
        sender: msg.account.name,
        sender_id: msg.account.account_id,
        body: msg.body,
        send_time: formatTimestamp_(msg.send_time),
        to_me: checkIfToMe_(msg.body, myAccountId)
      };
    });

    var roomType = "group";
    if (room.type === "direct") {
      roomType = "direct";
    } else if (room.type === "my") {
      roomType = "my";
    }

    roomDataList.push({
      room_id: roomId,
      room_name: room.name,
      room_type: roomType,
      unread_count: room.unread_num,
      mention_count: room.mention_num || 0,
      messages: formattedMessages
    });

    totalUnread += room.unread_num;

    // API Rate Limit対策: 300ms待機
    Utilities.sleep(300);
  }

  if (roomDataList.length === 0) {
    Logger.log("[INFO] 取得可能な未読メッセージなし。処理終了。");
    return;
  }

  // --- Step 3: JSON構造化 ---
  var outputJson = {
    type: "chatwork_unread",
    generated_at: formatTimestampNow_(),
    total_unread: totalUnread,
    rooms: roomDataList
  };

  // --- Step 4: Googleドライブへ投下 ---
  var fileName = "chatwork_unread_" + Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmm") + ".json";

  try {
    var folder = DriveApp.getFolderById(folderId);

    // 重複防止: 同名ファイルがあればスキップ
    var existing = folder.getFilesByName(fileName);
    if (existing.hasNext()) {
      Logger.log("[INFO] 同名ファイル既存のためスキップ: " + fileName);
      return;
    }

    var jsonString = JSON.stringify(outputJson, null, 2);
    folder.createFile(fileName, jsonString, MimeType.PLAIN_TEXT);
    Logger.log("[OK] JSON投下完了: " + fileName + " (" + jsonString.length + " bytes, " + totalUnread + " 件)");

  } catch (e) {
    Logger.log("[ERROR] DriveApp書き込み失敗: " + e.message);
    return;
  }
}


// =============================================================
// Chatwork API呼び出し（共通関数）
// =============================================================
function callChatworkApi_(token, endpoint) {
  var url = CHATWORK_API_BASE + endpoint;
  var options = {
    method: "get",
    headers: {
      "X-ChatWorkToken": token
    },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code === 200) {
      return JSON.parse(response.getContentText());
    } else if (code === 429) {
      // Rate Limit: 5秒待って1回だけリトライ
      Logger.log("[WARN] Rate Limit (429)。5秒後にリトライ: " + endpoint);
      Utilities.sleep(5000);
      response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        return JSON.parse(response.getContentText());
      }
      Logger.log("[ERROR] リトライ後も失敗: " + endpoint);
      return null;
    } else {
      Logger.log("[ERROR] API応答 " + code + ": " + response.getContentText());
      return null;
    }
  } catch (e) {
    Logger.log("[ERROR] API通信エラー: " + e.message);
    return null;
  }
}


// =============================================================
// 自分宛て（TO）かどうか判定
// =============================================================
function checkIfToMe_(body, myAccountId) {
  if (!myAccountId) return false;
  // Chatworkの TO 記法: [To:アカウントID]
  var toPattern = "[To:" + myAccountId + "]";
  // 全員宛て
  var toAllPattern = "[toall]";
  return body.indexOf(toPattern) >= 0 || body.indexOf(toAllPattern) >= 0;
}


// =============================================================
// UNIXタイムスタンプ → ISO 8601 変換
// =============================================================
function formatTimestamp_(unixTime) {
  var dt = new Date(unixTime * 1000);
  return Utilities.formatDate(dt, "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ssXXX");
}


// =============================================================
// 現在時刻 → ISO 8601
// =============================================================
function formatTimestampNow_() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ssXXX");
}


// =============================================================
// 手動テスト用: 単発実行でログ確認
// =============================================================
function testRun() {
  checkChatworkUnread();
}


// =============================================================
// 初期設定確認用: プロパティが正しく設定されているか確認
// =============================================================
function verifySetup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("CHATWORK_API_TOKEN");
  var folder = props.getProperty("INBOX_FOLDER_ID");
  var myId   = props.getProperty("MY_ACCOUNT_ID");

  Logger.log("=== AIEiji秘書 Chatwork Inbound セットアップ確認 ===");
  Logger.log("CHATWORK_API_TOKEN: " + (token ? "設定済み (" + token.substring(0, 4) + "...)" : "未設定"));
  Logger.log("INBOX_FOLDER_ID:   " + (folder ? "設定済み (" + folder + ")" : "未設定"));
  Logger.log("MY_ACCOUNT_ID:     " + (myId ? "設定済み (" + myId + ")" : "未設定（任意）"));

  if (token && folder) {
    Logger.log("--- APIテスト: /me ---");
    var me = callChatworkApi_(token, "/me");
    if (me) {
      Logger.log("認証成功: " + me.name + " (account_id: " + me.account_id + ")");
      Logger.log("※ MY_ACCOUNT_ID に " + me.account_id + " を設定すると「自分宛て」判定が有効になります");
    } else {
      Logger.log("認証失敗: APIトークンを確認してください");
    }
  }
}
