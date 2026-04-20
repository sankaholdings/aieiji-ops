// =============================================================
// Gmail_Inbound.gs
// 役割: Gmail未読メールを取得し、GoogleドライブへJSON投下
// バージョン: v1.0
// 作成: 2026-04-19 AIEijiSE（Gmail Pipelineデザイン確定 Phase G1）
//
// 【動作概要】
// 1. GmailApp.search() で対象メールを広め検索（重要判定はPhase G2 Python側で精密フィルタ）
// 2. 各メールのメタデータ＋本文をJSON構造に整形
// 3. GoogleドライブのInboxフォルダへ投下（Chatwork_Inboundと同フォルダ）
//
// 【重要判定の設計方針】
// GAS側: GmailApp.search のクエリ制約上、「過去返信相手」を完全に抽出できない。
//        そのため GAS では「未読 + 自分宛(to:me) + SPAM/プロモーション除外」で広め取得。
//        詳細な和集合フィルタ（sent_contacts照合 + To:直接判定）はPhase G2 Python側で実施。
// Python側: sent_contacts.json（過去返信先一覧）と照合してハイブリッド判定を完結させる。
//
// 【セキュリティ】
// フォルダIDはスクリプトプロパティから取得（コード内直書き禁止・Chatworkと同プロパティキー使用）
// ターゲットアドレスはスクリプトプロパティから取得（GMAIL_TARGET_ADDRESS）
//
// 【スクリプトプロパティ（GASプロジェクト設定で登録）】
// INBOX_FOLDER_ID      : GoogleドライブのInboxフォルダID（Chatwork_Inboundと共通）
// GMAIL_TARGET_ADDRESS : ejsanka@gmail.com（重要判定の基準アドレス）
// GMAIL_MAX_RESULTS    : 1回の処理上限件数（省略時: 20）
// GMAIL_PROCESSED_LABEL: 処理済みラベル名（省略時: AIEiji/Processed）
// =============================================================

// --- 定数フォールバック ---
var GMAIL_DEFAULT_MAX     = 20;
var GMAIL_DEFAULT_LABEL   = "AIEiji/Processed";
var GMAIL_INBOX_QUERY_BASE = "is:unread -in:spam -in:trash -in:promotions -in:social";

// =============================================================
// メイン関数: 5分おきトリガーで実行
// =============================================================
function checkGmailUnread() {
  var props           = PropertiesService.getScriptProperties();
  var folderId        = props.getProperty("INBOX_FOLDER_ID");
  var targetAddress   = props.getProperty("GMAIL_TARGET_ADDRESS") || "ejsanka@gmail.com";
  var maxResults      = parseInt(props.getProperty("GMAIL_MAX_RESULTS") || GMAIL_DEFAULT_MAX, 10);
  var processedLabel  = props.getProperty("GMAIL_PROCESSED_LABEL") || GMAIL_DEFAULT_LABEL;

  // --- プロパティ検証 ---
  if (!folderId) {
    Logger.log("[FATAL] スクリプトプロパティ未設定: INBOX_FOLDER_ID");
    return;
  }

  // --- Step 1: Gmail 未読メール取得 ---
  // GAS 制約上、「過去返信相手」の完全抽出は困難のため広め検索。
  // to:me = 自分が To: フィールドに含まれるメール（CC/BCC は含まない）
  // Python (Phase G2) で sent_contacts.json と照合し精密フィルタを行う。
  var query = GMAIL_INBOX_QUERY_BASE + " to:me";

  var threads;
  try {
    threads = GmailApp.search(query, 0, maxResults);
  } catch (e) {
    Logger.log("[ERROR] GmailApp.search 失敗: " + e.message);
    return;
  }

  if (!threads || threads.length === 0) {
    Logger.log("[INFO] 未読なし（条件: " + query + "）。処理終了。");
    return;
  }

  Logger.log("[INFO] 対象スレッド数: " + threads.length);

  // --- Step 2: メールデータ抽出 ---
  var emailDataList = [];
  var processedMessages = [];  // 既読化対象（JSON投下成功後に一括markRead）

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();

    // スレッド内の未読メッセージのみ処理
    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      if (!msg.isUnread()) continue;

      try {
        var toHeader = msg.getTo();       // To: ヘッダー（直宛て判定のため取得）
        var ccHeader = msg.getCc();       // CC: ヘッダー（Python側でTo/CC分離に使用）

        processedMessages.push(msg);
        emailDataList.push({
          message_id:    msg.getId(),
          thread_id:     thread.getId(),
          sender:        msg.getFrom(),
          sender_name:   extractName_(msg.getFrom()),
          sender_address: extractAddress_(msg.getFrom()),
          to:            toHeader,
          cc:            ccHeader,
          subject:       msg.getSubject(),
          body_plain:    truncateBody_(msg.getPlainBody(), 3000),
          received_at:   formatDate_(msg.getDate()),
          has_attachment: msg.getAttachments().length > 0,
          labels:        getLabelNames_(msg.getThread().getLabels()),
          // Phase G2 Python側でのフィルタ補助情報
          _meta: {
            to_me_direct: isDirectToMe_(toHeader, targetAddress),
            target_address: targetAddress,
            query_used: query
          }
        });
      } catch (e) {
        Logger.log("[WARN] メッセージ処理エラー (id=" + msg.getId() + "): " + e.message);
        continue;
      }
    }

    // API Rate Limit対策
    Utilities.sleep(200);
  }

  if (emailDataList.length === 0) {
    Logger.log("[INFO] 処理対象の未読メッセージなし。処理終了。");
    return;
  }

  // --- Step 3: JSON構造化 ---
  var timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss");
  var outputJson = {
    type:         "email_unread",
    generated_at: formatDateNow_(),
    target_address: targetAddress,
    total_count:  emailDataList.length,
    filter_note:  "GAS広め取得。sent_contacts照合・To直接判定はPhase G2 Python側で実施。",
    emails:       emailDataList
  };

  // --- Step 4: Googleドライブへ投下 ---
  var fileName = "email_unread_" + timestamp + ".json";

  try {
    var folder = DriveApp.getFolderById(folderId);

    // 重複防止（同名ファイル既存ならスキップ）
    var existing = folder.getFilesByName(fileName);
    if (existing.hasNext()) {
      Logger.log("[INFO] 同名ファイル既存のためスキップ: " + fileName);
      return;
    }

    var jsonString = JSON.stringify(outputJson, null, 2);
    folder.createFile(fileName, jsonString, MimeType.PLAIN_TEXT);
    Logger.log("[OK] JSON投下完了: " + fileName
      + " (" + jsonString.length + " bytes, " + emailDataList.length + " 件)");

  } catch (e) {
    Logger.log("[ERROR] DriveApp書き込み失敗: " + e.message);
    return;
  }

  // --- Step 5: 処理対象を既読化（社長指示2026-04-20: チェック後はすべて既読にする） ---
  var markedCount = 0;
  for (var k = 0; k < processedMessages.length; k++) {
    try {
      processedMessages[k].markRead();
      markedCount++;
    } catch (e) {
      Logger.log("[WARN] markRead失敗 (id=" + processedMessages[k].getId() + "): " + e.message);
    }
  }
  Logger.log("[OK] 既読化完了: " + markedCount + " / " + processedMessages.length + " 件");
}


// =============================================================
// 一括既読化（手動実行用・社長指示2026-04-20）
// 検索条件にヒットする未読メールをすべて既読にする。
// 通常の checkGmailUnread でも自動的に既読化されるが、
// 過去の積み残し未読を一掃したい場合に使用。
// =============================================================
function markAllUnreadAsRead() {
  var props         = PropertiesService.getScriptProperties();
  var targetAddress = props.getProperty("GMAIL_TARGET_ADDRESS") || "ejsanka@gmail.com";
  var query         = GMAIL_INBOX_QUERY_BASE + " to:me";

  var totalMarked = 0;
  var batchSize   = 100;
  var safetyLimit = 50;  // 最大 50 バッチ = 5000 スレッド

  for (var batch = 0; batch < safetyLimit; batch++) {
    var threads = GmailApp.search(query, 0, batchSize);
    if (!threads || threads.length === 0) break;

    for (var i = 0; i < threads.length; i++) {
      var msgs = threads[i].getMessages();
      for (var j = 0; j < msgs.length; j++) {
        if (msgs[j].isUnread()) {
          try {
            msgs[j].markRead();
            totalMarked++;
          } catch (e) {
            Logger.log("[WARN] markRead失敗: " + e.message);
          }
        }
      }
    }
    Utilities.sleep(300);
  }

  Logger.log("[OK] 一括既読化完了: " + totalMarked + " 件 (target=" + targetAddress + ")");
}


// =============================================================
// To: ヘッダーに targetAddress が直接含まれるか判定
// CC/BCC との分離はPython側で行うが、GAS側でも初期フラグを立てる
// =============================================================
function isDirectToMe_(toHeader, targetAddress) {
  if (!toHeader || !targetAddress) return false;
  return toHeader.toLowerCase().indexOf(targetAddress.toLowerCase()) >= 0;
}


// =============================================================
// "From" ヘッダーから表示名を抽出 ("Name <addr>" → "Name")
// =============================================================
function extractName_(fromHeader) {
  if (!fromHeader) return "";
  var match = fromHeader.match(/^(.+?)\s*<.+>/);
  return match ? match[1].trim() : fromHeader;
}


// =============================================================
// "From" ヘッダーからメールアドレスを抽出 ("Name <addr>" → "addr")
// =============================================================
function extractAddress_(fromHeader) {
  if (!fromHeader) return "";
  var match = fromHeader.match(/<(.+?)>/);
  if (match) return match[1].trim();
  // <> なしの場合はそのまま
  return fromHeader.trim();
}


// =============================================================
// 本文を maxChars 文字に切り詰め（後続Pythonのトークン節約）
// =============================================================
function truncateBody_(body, maxChars) {
  if (!body) return "";
  if (body.length <= maxChars) return body;
  return body.substring(0, maxChars) + "\n...[本文省略: " + body.length + "文字中" + maxChars + "文字を取得]";
}


// =============================================================
// スレッドのラベル名一覧を文字列配列で返す
// =============================================================
function getLabelNames_(labels) {
  if (!labels || labels.length === 0) return [];
  return labels.map(function(l) { return l.getName(); });
}


// =============================================================
// Date オブジェクト → ISO 8601 文字列（JST）
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
// 手動テスト用: 単発実行でログ確認（GASエディタから実行）
// =============================================================
function testRun() {
  checkGmailUnread();
}


// =============================================================
// 初期設定確認用: スクリプトプロパティ＆Gmail接続テスト
// =============================================================
function verifySetup() {
  var props          = PropertiesService.getScriptProperties();
  var folderId       = props.getProperty("INBOX_FOLDER_ID");
  var targetAddress  = props.getProperty("GMAIL_TARGET_ADDRESS") || "ejsanka@gmail.com (フォールバック)";
  var maxResults     = props.getProperty("GMAIL_MAX_RESULTS") || GMAIL_DEFAULT_MAX + " (デフォルト)";
  var processedLabel = props.getProperty("GMAIL_PROCESSED_LABEL") || GMAIL_DEFAULT_LABEL + " (デフォルト)";

  Logger.log("=== AIEiji秘書 Gmail Inbound セットアップ確認 ===");
  Logger.log("INBOX_FOLDER_ID:       " + (folderId ? "設定済み (" + folderId + ")" : "【未設定】Chatwork_Inboundと同じIDを登録してください"));
  Logger.log("GMAIL_TARGET_ADDRESS:  " + targetAddress);
  Logger.log("GMAIL_MAX_RESULTS:     " + maxResults);
  Logger.log("GMAIL_PROCESSED_LABEL: " + processedLabel);

  // Gmail接続テスト（スレッド1件だけ取得して疎通確認）
  Logger.log("--- Gmail接続テスト ---");
  try {
    var testThreads = GmailApp.search("is:unread", 0, 1);
    Logger.log("Gmail接続: OK（未読スレッド取得可能）");
    Logger.log("テスト検索ヒット: " + testThreads.length + " 件");
  } catch (e) {
    Logger.log("Gmail接続: FAIL — " + e.message);
  }

  // DriveApp接続テスト
  if (folderId) {
    Logger.log("--- DriveApp接続テスト ---");
    try {
      var folder = DriveApp.getFolderById(folderId);
      Logger.log("DriveApp接続: OK（フォルダ名: " + folder.getName() + "）");
    } catch (e) {
      Logger.log("DriveApp接続: FAIL — " + e.message);
    }
  }

  Logger.log("=== 確認完了 ===");
  Logger.log("【次のステップ】");
  Logger.log("1. INBOX_FOLDER_ID が未設定なら、Chatwork_Inbound と同じIDをスクリプトプロパティに登録");
  Logger.log("2. GMAIL_TARGET_ADDRESS を ejsanka@gmail.com に設定（既にフォールバックあり）");
  Logger.log("3. testRun() を実行して 00_Inbox への投下を確認");
  Logger.log("4. 確認後、5分間隔のトリガー（checkGmailUnread）を追加");
}
