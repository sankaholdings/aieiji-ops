// =============================================================
// Gmail_SentContacts.gs
// 役割: ejsanka@gmail.com の送信済みメールをスキャンし、
//       過去の送信先アドレスを抽出・重複排除して sent_contacts.json を生成
// バージョン: v1.0
// 作成: 2026-04-19 AIEijiSE（Gmail Pipeline Phase G1.5）
//
// 【動作概要】
// 1. GmailApp.search("in:sent") でページネーションしながら送信済みメールを取得
// 2. To: / Cc: フィールドからアドレスを抽出・正規化
// 3. アドレスごとに送信回数・最終送信日・表示名を集計
// 4. 重複排除・送信回数降順でソートした contacts 配列を生成
// 5. sent_contacts.json を GoogleDrive へ上書き保存
//
// 【用途（Phase G2以降）】
// process_inbox.py がこのファイルを参照し、受信メールの送信者が
// 「過去に ejsanka@gmail.com から返信したことのある相手」かどうかを判定する。
// → ハイブリッド重要判定（①過去返信相手 OR ②To:直接）の①を担う。
//
// 【スクリプトプロパティ（GASプロジェクトで登録）】
// SENT_CONTACTS_FOLDER_ID : sent_contacts.json の保存先フォルダID
//                           ※ 06_SE/Data に相当するGoogle DriveフォルダのID
//                           ※ 未設定の場合は INBOX_FOLDER_ID へフォールバック（要注意）
// INBOX_FOLDER_ID         : フォールバック先（Chatwork_Inbound と共用）
// SENT_SCAN_LIMIT         : スキャンする送信済みメール上限（省略時: 500）
// SENT_CONTACTS_FILENAME  : 出力ファイル名（省略時: sent_contacts.json）
//
// 【実行タイミング】
// - 初回: 手動で buildSentContacts() を実行
// - 定期更新: 週1回程度のトリガー推奨（月曜朝など）
// =============================================================

var SENT_DEFAULT_LIMIT    = 500;
var SENT_DEFAULT_FILENAME = "sent_contacts.json";
var SENT_BATCH_SIZE       = 100;   // GmailApp.search の1回あたり取得件数上限

// =============================================================
// メイン関数: 手動実行 or 週次トリガーで実行
// =============================================================
function buildSentContacts() {
  var props      = PropertiesService.getScriptProperties();
  var folderId   = props.getProperty("SENT_CONTACTS_FOLDER_ID")
                   || props.getProperty("INBOX_FOLDER_ID");
  var scanLimit  = parseInt(props.getProperty("SENT_SCAN_LIMIT") || SENT_DEFAULT_LIMIT, 10);
  var fileName   = props.getProperty("SENT_CONTACTS_FILENAME") || SENT_DEFAULT_FILENAME;

  // --- プロパティ検証 ---
  if (!folderId) {
    Logger.log("[FATAL] スクリプトプロパティ未設定: SENT_CONTACTS_FOLDER_ID / INBOX_FOLDER_ID");
    return;
  }
  if (!props.getProperty("SENT_CONTACTS_FOLDER_ID")) {
    Logger.log("[WARN] SENT_CONTACTS_FOLDER_ID 未設定。INBOX_FOLDER_ID へフォールバック。"
      + "sent_contacts.json が 00_Inbox に保存されます（処理キューと混在）。"
      + "専用フォルダIDの設定を推奨します。");
  }

  Logger.log("[INFO] スキャン開始: in:sent 上限=" + scanLimit + "件");

  // --- Step 1: 送信済みメールのアドレスを収集 ---
  // key: 正規化アドレス(小文字), value: { address, name, sent_count, last_sent_at }
  var contactMap = {};
  var totalScanned = 0;
  var offset = 0;

  while (totalScanned < scanLimit) {
    var batchSize = Math.min(SENT_BATCH_SIZE, scanLimit - totalScanned);
    var threads;

    try {
      threads = GmailApp.search("in:sent", offset, batchSize);
    } catch (e) {
      Logger.log("[ERROR] GmailApp.search 失敗 (offset=" + offset + "): " + e.message);
      break;
    }

    if (!threads || threads.length === 0) {
      Logger.log("[INFO] スキャン完了（送信済みメール全件読み終わり）");
      break;
    }

    Logger.log("[INFO] バッチ取得: offset=" + offset + ", 件数=" + threads.length);

    for (var i = 0; i < threads.length; i++) {
      var thread = threads[i];
      var messages;
      try {
        messages = thread.getMessages();
      } catch (e) {
        Logger.log("[WARN] スレッドメッセージ取得失敗: " + e.message);
        continue;
      }

      for (var j = 0; j < messages.length; j++) {
        var msg = messages[j];

        // 自分が送信したメッセージのみ処理（受信は除外）
        var fromAddr = extractAddress_(msg.getFrom());
        if (!isSelf_(fromAddr)) continue;

        var msgDate = msg.getDate();

        // To: と Cc: の両方からアドレスを抽出
        var recipients = [];
        recipients = recipients.concat(parseAddresses_(msg.getTo()));
        recipients = recipients.concat(parseAddresses_(msg.getCc()));

        for (var k = 0; k < recipients.length; k++) {
          var rec = recipients[k];
          if (!rec.address) continue;

          var normAddr = rec.address.toLowerCase().trim();

          // 自分自身は除外
          if (isSelf_(normAddr)) continue;

          if (contactMap[normAddr]) {
            // 既存エントリを更新
            contactMap[normAddr].sent_count += 1;
            if (msgDate > new Date(contactMap[normAddr].last_sent_at)) {
              contactMap[normAddr].last_sent_at = formatDate_(msgDate);
              // より新しいメッセージで表示名を上書き（空でなければ）
              if (rec.name) {
                contactMap[normAddr].name = rec.name;
              }
            }
          } else {
            // 新規エントリ
            contactMap[normAddr] = {
              address:      normAddr,
              name:         rec.name || "",
              sent_count:   1,
              last_sent_at: formatDate_(msgDate)
            };
          }
        }

        totalScanned++;
      }

      // Rate Limit対策
      Utilities.sleep(100);
    }

    offset += threads.length;

    // GAS の実行時間上限（6分）への安全マージン
    if (isApproachingTimeLimit_()) {
      Logger.log("[WARN] 実行時間上限に近づいたため早期終了。スキャン済み: " + totalScanned + "件");
      break;
    }
  }

  Logger.log("[INFO] スキャン完了。ユニーク送信先: " + Object.keys(contactMap).length + "件（スキャン済みメッセージ: " + totalScanned + "件）");

  // --- Step 2: JSON構造化（送信回数降順でソート）---
  var contactList = Object.values(contactMap).sort(function(a, b) {
    return b.sent_count - a.sent_count;
  });

  var outputJson = {
    schema_version: "1.0",
    generated_at:   formatDateNow_(),
    target_address: "ejsanka@gmail.com",
    total_contacts: contactList.length,
    scanned_messages: totalScanned,
    usage_note:     "Phase G2 process_inbox.py が参照。受信メールの sender_address がこのリストに含まれる場合、重要メールと判定（ハイブリッド判定①）。",
    contacts: contactList
  };

  // --- Step 3: GoogleDrive へ上書き保存（sent_contacts.json は常に最新版1ファイルのみ）---
  try {
    var folder = DriveApp.getFolderById(folderId);
    var jsonString = JSON.stringify(outputJson, null, 2);

    // 同名ファイルがあれば上書き（削除→再作成）
    var existingFiles = folder.getFilesByName(fileName);
    if (existingFiles.hasNext()) {
      var existingFile = existingFiles.next();
      existingFile.setContent(jsonString);
      Logger.log("[OK] 上書き完了: " + fileName
        + " (" + jsonString.length + " bytes, " + contactList.length + " 件)");
    } else {
      folder.createFile(fileName, jsonString, MimeType.PLAIN_TEXT);
      Logger.log("[OK] 新規作成完了: " + fileName
        + " (" + jsonString.length + " bytes, " + contactList.length + " 件)");
    }

  } catch (e) {
    Logger.log("[ERROR] DriveApp書き込み失敗: " + e.message);
    return;
  }

  Logger.log("[DONE] sent_contacts.json 生成完了。Phase G2 Python 連携準備が整いました。");
}


// =============================================================
// "From" / "To" / "Cc" ヘッダーをパースし { address, name }[] を返す
// "Name <addr>, Name2 <addr2>" 形式に対応
// =============================================================
function parseAddresses_(headerStr) {
  if (!headerStr) return [];
  var results = [];

  // カンマ区切りで分割（"," が名前内に入る場合を考慮して簡易パース）
  var parts = headerStr.split(/,(?![^<]*>)/);

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;

    var matchWithName = part.match(/^(.+?)\s*<([^>]+)>$/);
    if (matchWithName) {
      results.push({
        name:    matchWithName[1].trim().replace(/^["']|["']$/g, ""),
        address: matchWithName[2].trim().toLowerCase()
      });
    } else {
      // <> なし — アドレスのみ
      var addr = part.replace(/[<>]/g, "").trim().toLowerCase();
      if (addr.indexOf("@") >= 0) {
        results.push({ name: "", address: addr });
      }
    }
  }

  return results;
}


// =============================================================
// From ヘッダーからアドレスのみを取り出す
// =============================================================
function extractAddress_(fromHeader) {
  if (!fromHeader) return "";
  var match = fromHeader.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  return fromHeader.trim().toLowerCase();
}


// =============================================================
// 自分自身のアドレスかどうか判定
// =============================================================
function isSelf_(addr) {
  return addr === "ejsanka@gmail.com";
}


// =============================================================
// Date → ISO 8601 文字列（JST）
// =============================================================
function formatDate_(date) {
  if (!date) return "";
  return Utilities.formatDate(date, "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ssXXX");
}


// =============================================================
// 現在時刻 → ISO 8601 文字列（JST）
// =============================================================
function formatDateNow_() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ssXXX");
}


// =============================================================
// GAS 実行時間上限（360秒）への近接チェック
// 開始時刻をグローバルに保持し、残り30秒を切ったら true を返す
// =============================================================
var _startTime = new Date();
function isApproachingTimeLimit_() {
  var elapsed = (new Date() - _startTime) / 1000;
  return elapsed > 330;  // 5分30秒経過で早期終了
}


// =============================================================
// 手動テスト用: 単発実行でログ確認
// =============================================================
function testRun() {
  buildSentContacts();
}


// =============================================================
// 初期設定確認用: プロパティ＆接続テスト
// =============================================================
function verifySetup() {
  var props      = PropertiesService.getScriptProperties();
  var folderId   = props.getProperty("SENT_CONTACTS_FOLDER_ID");
  var fallbackId = props.getProperty("INBOX_FOLDER_ID");
  var scanLimit  = props.getProperty("SENT_SCAN_LIMIT") || SENT_DEFAULT_LIMIT + " (デフォルト)";
  var fileName   = props.getProperty("SENT_CONTACTS_FILENAME") || SENT_DEFAULT_FILENAME + " (デフォルト)";

  Logger.log("=== AIEiji秘書 Gmail SentContacts セットアップ確認 ===");
  Logger.log("SENT_CONTACTS_FOLDER_ID: "
    + (folderId ? "設定済み (" + folderId + ")" : "【未設定】→ INBOX_FOLDER_ID へフォールバック"));
  Logger.log("INBOX_FOLDER_ID (FB):    "
    + (fallbackId ? "設定済み (" + fallbackId + ")" : "【未設定・要登録】"));
  Logger.log("SENT_SCAN_LIMIT:         " + scanLimit);
  Logger.log("SENT_CONTACTS_FILENAME:  " + fileName);

  // Gmail 接続テスト（送信済み1件取得）
  Logger.log("--- Gmail接続テスト (in:sent) ---");
  try {
    var testThreads = GmailApp.search("in:sent", 0, 1);
    Logger.log("Gmail接続: OK（送信済みスレッド取得可能）");
    if (testThreads.length > 0) {
      var sample = testThreads[0].getMessages()[0];
      Logger.log("サンプル送信件名: " + sample.getSubject());
      Logger.log("サンプル宛先(To): " + sample.getTo());
    }
  } catch (e) {
    Logger.log("Gmail接続: FAIL — " + e.message);
  }

  // DriveApp 接続テスト
  var targetFolderId = folderId || fallbackId;
  if (targetFolderId) {
    Logger.log("--- DriveApp接続テスト ---");
    try {
      var folder = DriveApp.getFolderById(targetFolderId);
      Logger.log("DriveApp接続: OK（保存先フォルダ名: " + folder.getName() + "）");
    } catch (e) {
      Logger.log("DriveApp接続: FAIL — " + e.message);
    }
  }

  Logger.log("=== 確認完了 ===");
  Logger.log("【推奨セットアップ】");
  Logger.log("Google Drive で '06_SE_Data' フォルダを作成し、そのIDを SENT_CONTACTS_FOLDER_ID に登録すると");
  Logger.log("process_inbox.py が C:\\ClaudeSync\\06_SE\\data\\sent_contacts.json として参照できます。");
  Logger.log("フォルダID取得方法: Drive でフォルダを右クリック → 「リンクをコピー」→ URL末尾の英数字がID");
}
