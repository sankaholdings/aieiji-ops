// =============================================================
// Gmail_to_Inbox.gs
// 役割: Gmail未読メールをJSON化してGoogleドライブ(00_Inbox)へ投下
// 対象アカウント: ejsanka@gmail.com
// バージョン: v1.0
// 作成: 2026-04-13 AIEijiSE（ワークオーダー: SE_WorkOrder_Gmail_Pipeline.md）
// =============================================================

// ============================================================
// ★ 設定項目（初回セットアップ時に必ず変更すること）
// ============================================================
var CONFIG = {
  // GoogleドライブのフォルダID（00_Inboxに対応するフォルダ）
  // 手順: GoogleドライブでClaudeSync/00_Inboxを開き、URLの末尾のIDをコピーして貼り付ける
  // 例: https://drive.google.com/drive/folders/1ABC...XYZ → "1ABC...XYZ"
  INBOX_FOLDER_ID: "★ここに00_InboxのGoogleドライブフォルダIDを設定★",

  // 処理対象の未読メール最大件数
  MAX_MESSAGES: 50,

  // 本文の最大文字数
  BODY_MAX_LENGTH: 3000,

  // GASプロパティに保持する処理済みIDの上限数
  PROCESSED_ID_LIMIT: 1000,

  // 処理済みラベル名
  PROCESSED_LABEL: "AIEiji処理済",

  // Driveへの書き込みリトライ回数
  DRIVE_WRITE_MAX_RETRY: 3
};

// ============================================================
// メインエントリーポイント（タイムトリガーから呼び出す）
// ============================================================
function runGmailToInbox() {
  Logger.log("=== Gmail-to-Inbox 開始 ===");

  // 処理済みIDセットの読み込み
  var processedIds = loadProcessedIds_();

  // 出力先フォルダの取得（存在確認）
  var inboxFolder = getInboxFolder_();
  if (!inboxFolder) {
    Logger.log("[ERROR] 出力先フォルダが取得できませんでした。INBOX_FOLDER_IDを確認してください。");
    return;
  }

  // 処理済みラベルの取得または作成
  var processedLabel = getOrCreateLabel_(CONFIG.PROCESSED_LABEL);

  // 未読メールの取得（スレッド単位）
  var threads;
  try {
    threads = GmailApp.search("is:unread in:inbox", 0, CONFIG.MAX_MESSAGES);
  } catch (e) {
    Logger.log("[ERROR] Gmail APIエラー: " + e.message);
    return;
  }

  var successCount = 0;
  var skipCount = 0;
  var errorCount = 0;

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();

    for (var j = 0; j < messages.length; j++) {
      var message = messages[j];

      // 未読のみ処理（スレッド内で既読のメッセージはスキップ）
      if (!message.isUnread()) continue;

      var messageId = message.getId();

      // 重複チェック
      if (processedIds[messageId]) {
        Logger.log("[SKIP] 処理済み: " + messageId);
        skipCount++;
        // 既読にはする
        message.markRead();
        continue;
      }

      // JSON生成・Drive保存
      var result = processMessage_(message, inboxFolder);

      if (result.success) {
        // 処理済みIDを記録
        processedIds[messageId] = true;
        // ラベル付与・既読化
        if (processedLabel) {
          threads[i].addLabel(processedLabel);
        }
        message.markRead();
        successCount++;
        Logger.log("[OK] 処理完了: " + result.fileName);
      } else {
        errorCount++;
        Logger.log("[ERROR] 処理失敗: " + messageId + " - " + result.error);
      }
    }
  }

  // 処理済みIDをプロパティに保存（上限管理）
  saveProcessedIds_(processedIds);

  Logger.log("=== Gmail-to-Inbox 完了 ===");
  Logger.log("成功: " + successCount + " / スキップ: " + skipCount + " / エラー: " + errorCount);
}

// ============================================================
// 1通のメッセージを処理してDriveに保存
// ============================================================
function processMessage_(message, inboxFolder) {
  try {
    // --- メタデータ抽出 ---
    var messageId   = message.getId();
    var subject     = message.getSubject() || "(件名なし)";
    var fromRaw     = message.getFrom(); // "表示名 <email@example.com>" 形式
    var date        = message.getDate();
    var bodyRaw     = message.getPlainBody() || "";
    var attachments = message.getAttachments();

    // 送信者の分解
    var fromParsed = parseFrom_(fromRaw);

    // 本文の切り捨て処理
    var bodyTruncated = false;
    var bodyPlain = bodyRaw;
    if (bodyRaw.length > CONFIG.BODY_MAX_LENGTH) {
      bodyPlain = bodyRaw.substring(0, CONFIG.BODY_MAX_LENGTH);
      bodyTruncated = true;
    }

    // 添付ファイル情報
    var attachmentNames = attachments.map(function(a) { return a.getName(); });

    // 受信日時をISO8601形式に変換（JST: +09:00）
    var dateISO = toISO8601JST_(date);
    var processedAtISO = toISO8601JST_(new Date());

    // --- JSONオブジェクト構築 ---
    var mailJson = {
      type:            "inbound_mail",
      processed_at:    processedAtISO,
      message_id:      messageId,
      subject:         subject,
      from: {
        name:  fromParsed.name,
        email: fromParsed.email
      },
      date:            dateISO,
      body_plain:      bodyPlain,
      body_truncated:  bodyTruncated,
      has_attachment:  attachments.length > 0,
      attachment_names: attachmentNames
    };

    var jsonString = JSON.stringify(mailJson, null, 2);

    // --- ファイル名生成 ---
    var fileDate = Utilities.formatDate(date, "Asia/Tokyo", "yyyyMMdd_HHmmss");
    var senderDomain = fromParsed.email.split("@")[1] || "unknown";
    // ファイル名に使えない文字を除去
    senderDomain = senderDomain.replace(/[^a-zA-Z0-9\.\-]/g, "_");
    var fileName = "mail_" + fileDate + "_" + senderDomain + ".json";

    // --- Driveへの書き込み（リトライあり）---
    var saved = false;
    var lastError = "";
    for (var retry = 0; retry < CONFIG.DRIVE_WRITE_MAX_RETRY; retry++) {
      try {
        inboxFolder.createFile(fileName, jsonString, MimeType.PLAIN_TEXT);
        saved = true;
        break;
      } catch (e) {
        lastError = e.message;
        Logger.log("[RETRY " + (retry + 1) + "/" + CONFIG.DRIVE_WRITE_MAX_RETRY + "] Drive書き込みエラー: " + lastError);
        Utilities.sleep(2000); // 2秒待機してリトライ
      }
    }

    if (!saved) {
      return { success: false, error: "Drive書き込み失敗（" + CONFIG.DRIVE_WRITE_MAX_RETRY + "回リトライ後）: " + lastError };
    }

    return { success: true, fileName: fileName };

  } catch (e) {
    return { success: false, error: "JSON生成失敗: " + e.message };
  }
}

// ============================================================
// ユーティリティ: 送信者文字列の分解
// 例: "山田 太郎 <yamada@example.com>" → { name: "山田 太郎", email: "yamada@example.com" }
// ============================================================
function parseFrom_(fromRaw) {
  var emailMatch = fromRaw.match(/<([^>]+)>/);
  if (emailMatch) {
    var email = emailMatch[1].trim();
    var name = fromRaw.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "");
    return { name: name || email, email: email };
  }
  // "<>"なしの場合はそのままメールアドレスとして扱う
  return { name: fromRaw.trim(), email: fromRaw.trim() };
}

// ============================================================
// ユーティリティ: DateオブジェクトをISO8601 JST形式に変換
// ============================================================
function toISO8601JST_(date) {
  return Utilities.formatDate(date, "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// ============================================================
// ユーティリティ: 出力先フォルダ取得
// ============================================================
function getInboxFolder_() {
  try {
    return DriveApp.getFolderById(CONFIG.INBOX_FOLDER_ID);
  } catch (e) {
    Logger.log("[ERROR] フォルダ取得失敗 (ID: " + CONFIG.INBOX_FOLDER_ID + "): " + e.message);
    return null;
  }
}

// ============================================================
// ユーティリティ: ラベルの取得または作成
// ============================================================
function getOrCreateLabel_(labelName) {
  try {
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
      Logger.log("[INFO] ラベル作成: " + labelName);
    }
    return label;
  } catch (e) {
    Logger.log("[WARN] ラベル操作失敗: " + e.message);
    return null;
  }
}

// ============================================================
// 処理済みID管理: プロパティから読み込み
// ============================================================
function loadProcessedIds_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("processed_ids");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    Logger.log("[WARN] processed_ids のパース失敗。リセットします。");
    return {};
  }
}

// ============================================================
// 処理済みID管理: プロパティへ保存（上限管理付き）
// ============================================================
function saveProcessedIds_(processedIds) {
  var keys = Object.keys(processedIds);

  // 上限を超えた場合、古いエントリを削除（単純にスライス）
  if (keys.length > CONFIG.PROCESSED_ID_LIMIT) {
    var trimmed = {};
    var keepKeys = keys.slice(keys.length - CONFIG.PROCESSED_ID_LIMIT);
    keepKeys.forEach(function(k) { trimmed[k] = true; });
    processedIds = trimmed;
    Logger.log("[INFO] processed_idsを上限(" + CONFIG.PROCESSED_ID_LIMIT + ")にトリミング。");
  }

  try {
    PropertiesService.getScriptProperties().setProperty("processed_ids", JSON.stringify(processedIds));
  } catch (e) {
    Logger.log("[ERROR] processed_ids 保存失敗: " + e.message);
  }
}

// ============================================================
// セットアップ補助: タイムトリガーを設定する（初回のみ手動実行）
// ============================================================
function setupTrigger() {
  // 既存の同名トリガーを削除してから再設定（二重登録防止）
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "runGmailToInbox") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // 1時間ごとのトリガーを設定
  ScriptApp.newTrigger("runGmailToInbox")
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log("[SETUP] 1時間ごとのタイムトリガーを設定しました。");
}
