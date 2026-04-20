// =============================================================
// Chatwork_Outbound.gs
// 役割: COO返信案をマイチャットへ配信 → 社長の決裁を検知 → API発射
// バージョン: v3.1 (Phase G5: オンデマンド返信フロー)
// 作成: 2026-04-13 AIEijiSE（ハイブリッド・ループ設計書 v1.0 Phase 3）
// 修正: 2026-04-13 executeBossCommand サイレントフェイル修正
// 拡張: 2026-04-19 Phase G4 - email_reply_draft_*.json の配信＋Gmail送信＋学習ルール対応
// 拡張: 2026-04-20 v3.1 - スキップ学習の自然語書式対応（「@domain.comはスキップ」「addr@x.comスキップ」も認識）
//
// 【動作概要】
// deliverBriefing():
//   1. Googleドライブの 05_Secretary_Outbox を監視
//   2. chatwork_reply_draft_*.json または email_reply_draft_*.json を検知
//   3. briefing_text を社長のマイチャットへ POST（Email版は[email]プレフィックス付与）
//   4. 処理済みJSONを Sent サブフォルダへ移動
//   5. アクティブなドラフト情報をプロパティに保存
//
// executeBossCommand():
//   1. マイチャットの最新メッセージを取得
//   2. ACTIVE_DRAFT.type で chatwork/email を判別
//   3. 社長の指示コマンドをパース・実行
//   4. 実行結果をマイチャットへ報告
//
// 【Email版コマンド（Phase G4）】
//   - 「Aは案の通り」「A OK」「Aそのまま送信」 → GmailApp.replyAll で下書きを送信
//   - 「Aはこう返して: XXX」              → カスタム本文で返信
//   - 「Aはスキップ」                      → アーカイブ＋未読解除
//   - 「以後スキップ @example.com」         → learned_rules_email.json へ追記
//   - 「以後スキップ sender@example.com」   → アドレス単位で追記
//   - 「テンプレ保存 sender@addr: XXX」     → 返信テンプレ追記
//
// 【スクリプトプロパティ（追加分）】
// OUTBOX_FOLDER_ID         : Googleドライブ 05_Secretary_Outbox のフォルダID
// MY_CHAT_ROOM_ID          : Chatwork マイチャットの room_id（46076523）
// SENT_CONTACTS_FOLDER_ID  : 06_SE フォルダID（learned_rules_email.json保存先）
// LEARNED_RULES_FILENAME   : 省略時 'learned_rules_email.json'
// =============================================================

var CHATWORK_API_BASE = "https://api.chatwork.com/v2";
var LEARNED_RULES_DEFAULT_FILENAME = "learned_rules_email.json";


// =============================================================
// deliverBriefing: Outboxから返信案を取得 → マイチャットへ配信
// トリガー: 1分おき
// =============================================================
function deliverBriefing() {
  var props = PropertiesService.getScriptProperties();
  var apiToken   = props.getProperty("CHATWORK_API_TOKEN");
  var outboxId   = props.getProperty("OUTBOX_FOLDER_ID");
  var myChatRoom = props.getProperty("MY_CHAT_ROOM_ID");

  if (!apiToken || !outboxId || !myChatRoom) {
    Logger.log("[FATAL] プロパティ未設定: CHATWORK_API_TOKEN / OUTBOX_FOLDER_ID / MY_CHAT_ROOM_ID");
    return;
  }

  // --- Outboxフォルダから未処理のドラフトJSONを検索（Chatwork または Email）---
  // MIMEタイプはPythonローカル生成ファイルがapplication/json、GAS生成がtext/plainで異なるため
  // getFiles()で全ファイルを取得しファイル名でフィルタする
  var outboxFolder = DriveApp.getFolderById(outboxId);
  var draftFile = null;

  // text/plain と application/json の両方を検索
  var mimeTypes = [MimeType.PLAIN_TEXT, "application/json"];
  for (var m = 0; m < mimeTypes.length && !draftFile; m++) {
    var files = outboxFolder.getFilesByType(mimeTypes[m]);
    while (files.hasNext()) {
      var f = files.next();
      var name = f.getName();
      var isChatwork = name.indexOf("chatwork_reply_draft_") === 0 && name.indexOf(".json") > 0;
      var isEmail    = name.indexOf("email_reply_draft_") === 0 && name.indexOf(".json") > 0;
      if (isChatwork || isEmail) {
        draftFile = f;
        break;
      }
    }
  }

  if (!draftFile) {
    Logger.log("[INFO] 新規ドラフトなし。処理終了。");
    return;
  }

  Logger.log("[INFO] ドラフト検知: " + draftFile.getName());

  // --- JSON解析 ---
  var draftJson;
  try {
    draftJson = JSON.parse(draftFile.getBlob().getDataAsString("UTF-8"));
  } catch (e) {
    Logger.log("[ERROR] JSONパース失敗: " + e.message);
    return;
  }

  if (!draftJson.briefing_text || !draftJson.items) {
    Logger.log("[ERROR] JSONフォーマット不正: briefing_text または items が未定義");
    return;
  }

  // --- マイチャットへブリーフィング配信（typeに応じてヘッダーを切替）---
  var draftType = draftJson.type || "chatwork_reply_draft";
  var titleText = (draftType === "email_reply_draft")
    ? "(*) AIEiji秘書 メールブリーフィング ✉"
    : "(i) AIEiji秘書 ブリーフィング";
  var header = "[info][title]" + titleText + "[/title]";
  var body = draftJson.briefing_text;
  var footer = "[/info]";
  var chatMessage = header + body + footer;

  var postResult = postChatworkMessage_(apiToken, myChatRoom, chatMessage);

  if (!postResult) {
    Logger.log("[ERROR] マイチャットへの配信失敗");
    return;
  }

  Logger.log("[OK] ブリーフィング配信完了 (message_id: " + postResult.message_id + ")");

  // --- アクティブドラフトをプロパティに保存（executeBossCommandが参照） ---
  props.setProperty("ACTIVE_DRAFT", draftFile.getBlob().getDataAsString("UTF-8"));
  props.setProperty("ACTIVE_DRAFT_NAME", draftFile.getName());
  props.setProperty("BRIEFING_MESSAGE_ID", postResult.message_id);

  // --- 処理済みJSONを Sent フォルダへ移動 ---
  var sentFolder = getOrCreateSubfolder_(outboxFolder, "Sent");
  draftFile.moveTo(sentFolder);
  Logger.log("[OK] ドラフトを Sent へ移動: " + draftFile.getName());
}


// =============================================================
// executeBossCommand: マイチャットの社長指示を検知 → 実行
// トリガー: 1分おき
// v1.1 — サイレントフェイル修正版（全分岐にLogger.log追加）
// =============================================================
function executeBossCommand() {
  Logger.log("========== executeBossCommand 開始 (Phase G5: オンデマンド) ==========");

  var props = PropertiesService.getScriptProperties();
  var apiToken       = props.getProperty("CHATWORK_API_TOKEN");
  var myChatRoom     = props.getProperty("MY_CHAT_ROOM_ID");
  var myAccountId    = props.getProperty("MY_ACCOUNT_ID");
  var activeDraft    = props.getProperty("ACTIVE_DRAFT");
  var lastProcessedId = props.getProperty("LAST_PROCESSED_MSG_ID");

  Logger.log("[PROP] activeDraft: " + (activeDraft ? "SET (" + activeDraft.length + " chars)" : "EMPTY"));
  Logger.log("[PROP] lastProcessedId: " + (lastProcessedId || "EMPTY"));

  if (!apiToken || !myChatRoom || !myAccountId) {
    Logger.log("[EXIT] 必須プロパティ未設定 (CHATWORK_API_TOKEN / MY_CHAT_ROOM_ID / MY_ACCOUNT_ID)");
    return;
  }

  // --- マイチャットの最新メッセージを取得 ---
  var messages = callChatworkApiGet_(apiToken, "/rooms/" + myChatRoom + "/messages?force=1");
  if (!messages || messages.length === 0) {
    Logger.log("[EXIT] メッセージなし");
    return;
  }
  Logger.log("[API] 取得メッセージ数: " + messages.length);

  // --- 初回起動：lastProcessedIdがなければ最新を設定して終了（古いコマンドを誤実行しない） ---
  if (!lastProcessedId) {
    var latestId = messages[messages.length - 1].message_id;
    props.setProperty("LAST_PROCESSED_MSG_ID", String(latestId));
    Logger.log("[INIT] LAST_PROCESSED_MSG_ID を初期化: " + latestId);
    return;
  }

  // --- 社長の新規メッセージを古い順に抽出 ---
  var newBossMessages = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (String(m.account.account_id) !== String(myAccountId)) continue;
    if (Number(m.message_id) <= Number(lastProcessedId)) continue;
    newBossMessages.push(m);
  }

  if (newBossMessages.length === 0) {
    Logger.log("[INFO] 新規社長コマンドなし");
    return;
  }
  Logger.log("[INFO] 新規社長コマンド " + newBossMessages.length + " 件を処理");

  // --- 各メッセージを順次処理 ---
  for (var j = 0; j < newBossMessages.length; j++) {
    var msg = newBossMessages[j];
    var commandText = String(msg.body).replace(/\u00A0/g, " ").trim();
    Logger.log("[CMD] msg_id=" + msg.message_id + " body=" + commandText.substring(0, 100));

    activeDraft = props.getProperty("ACTIVE_DRAFT"); // 各イテレーションで最新化

    if (activeDraft) {
      // ===== State 2: 下書き提示中 =====
      var draft;
      try { draft = JSON.parse(activeDraft); }
      catch (e) {
        Logger.log("[ERROR] ACTIVE_DRAFT パース失敗。クリアします: " + e.message);
        props.deleteProperty("ACTIVE_DRAFT");
        props.setProperty("LAST_PROCESSED_MSG_ID", String(msg.message_id));
        continue;
      }

      if (parseOnDemandApprove_(commandText)) {
        Logger.log("[STATE2] 承認 → 送信実行");
        handleOnDemandApprove_(apiToken, myChatRoom, draft);
        props.deleteProperty("ACTIVE_DRAFT");
      } else if (parseOnDemandCancel_(commandText)) {
        Logger.log("[STATE2] キャンセル → 破棄");
        handleOnDemandCancel_(apiToken, myChatRoom, draft);
        props.deleteProperty("ACTIVE_DRAFT");
      } else {
        var rewriteText = parseOnDemandRewrite_(commandText);
        if (rewriteText) {
          Logger.log("[STATE2] 修正 → 下書き再生成");
          handleOnDemandRewrite_(apiToken, myChatRoom, draft, rewriteText);
        } else {
          Logger.log("[STATE2] 認識できないコマンド → 無視");
        }
      }
    } else {
      // ===== State 1: アイドル =====
      var req = parseOnDemandReplyRequest_(commandText);
      if (req) {
        Logger.log("[STATE1] 返信指示検知: keyword=" + req.keyword);
        handleOnDemandReplyRequest_(apiToken, myChatRoom, req.keyword, req.body);
      } else {
        Logger.log("[STATE1] 認識できないコマンド → 無視");
      }
    }

    props.setProperty("LAST_PROCESSED_MSG_ID", String(msg.message_id));
  }

  Logger.log("========== executeBossCommand 終了 ==========");
}


// =============================================================
// コマンドパーサー: 社長の自然言語指示を解析・実行
// =============================================================
function parseAndExecuteCommand_(apiToken, command, draft) {
  var results = [];
  var items = draft.items;
  var cmd = command.toLowerCase
    ? command
    : String(command);

  // --- パターン1: 「全部既読」「すべて既読」「既読にして」 ---
  if (matchAny_(cmd, ["全部既読", "すべて既読", "既読にして", "全て既読", "全既読"])) {
    for (var i = 0; i < items.length; i++) {
      var readResult = markRoomAsRead_(apiToken, items[i].room_id);
      results.push({
        id: items[i].id,
        room_name: items[i].room_name,
        action: "既読",
        success: readResult
      });
    }
    return results;
  }

  // --- パターン2: 各アイテムに対する個別指示を解析 ---
  for (var j = 0; j < items.length; j++) {
    var item = items[j];
    var itemId = item.id; // "A", "B", etc.
    var executed = false;

    // 「Aは案の通り」「A案の通り」「Aはそのまま」
    var approvePatterns = [
      itemId + "は案の通り", itemId + "案の通り",
      itemId + "はそのまま", itemId + "そのまま",
      itemId + "は案で", itemId + "案で返信",
      itemId + "はそのまま送信", itemId + "はそのまま返信"
    ];

    if (matchAny_(cmd, approvePatterns)) {
      if (item.draft_reply) {
        var sendResult = postChatworkMessage_(apiToken, item.room_id, item.draft_reply);
        results.push({
          id: itemId,
          room_name: item.room_name,
          action: "返信送信",
          message: item.draft_reply.substring(0, 30) + "...",
          success: !!sendResult
        });
        executed = true;
      }
    }

    // 「Aはこう返して：XXX」「Aにこう返信：XXX」
    var customReplyMatch = cmd.match(new RegExp(itemId + "[はにを][こそ]う返[し信事][てし][:：](.+?)(?=[A-Z][はにを]|$)", ""));
    if (!executed && customReplyMatch) {
      var customText = customReplyMatch[1].trim();
      var sendResult2 = postChatworkMessage_(apiToken, item.room_id, customText);
      results.push({
        id: itemId,
        room_name: item.room_name,
        action: "カスタム返信",
        message: customText.substring(0, 30) + "...",
        success: !!sendResult2
      });
      executed = true;
    }

    // 「Aは既読」「Aは既読のみ」
    var readPatterns = [
      itemId + "は既読", itemId + "既読のみ",
      itemId + "は既読だけ", itemId + "既読で"
    ];

    if (!executed && matchAny_(cmd, readPatterns)) {
      var readResult2 = markRoomAsRead_(apiToken, item.room_id);
      results.push({
        id: itemId,
        room_name: item.room_name,
        action: "既読",
        success: readResult2
      });
      executed = true;
    }

    // 「あとは既読」「残りは既読」（未処理の全アイテムを既読に）
    if (!executed && matchAny_(cmd, ["あとは既読", "残りは既読", "他は既読", "あとは全部既読"])) {
      var readResult3 = markRoomAsRead_(apiToken, item.room_id);
      results.push({
        id: itemId,
        room_name: item.room_name,
        action: "既読",
        success: readResult3
      });
      executed = true;
    }

    // どのパターンにもマッチしなかった場合
    if (!executed) {
      // 単独アイテムの場合、「案の通り」「そのまま」だけでもOK
      if (items.length === 1 && matchAny_(cmd, ["案の通り", "そのまま", "送信して", "返信して", "OK", "おk", "了解"])) {
        if (item.draft_reply) {
          var sendResult3 = postChatworkMessage_(apiToken, item.room_id, item.draft_reply);
          results.push({
            id: itemId,
            room_name: item.room_name,
            action: "返信送信",
            message: item.draft_reply.substring(0, 30) + "...",
            success: !!sendResult3
          });
          executed = true;
        }
      }
    }

    if (!executed) {
      results.push({
        id: itemId,
        room_name: item.room_name,
        action: "スキップ",
        success: true,
        note: "該当するコマンドなし"
      });
    }

    Utilities.sleep(300); // Rate Limit対策
  }

  return results;
}


// =============================================================
// Email用コマンドパーサー（Phase G4）
// =============================================================
function parseAndExecuteEmailCommand_(command, draft) {
  var results = [];
  var items = draft.items || [];
  var cmd = String(command);

  // --- パターン0: 全体スキップ系（学習はしない／単発処理）---
  if (matchAny_(cmd, ["全部スキップ", "全部既読", "全部アーカイブ", "全スキップ"])) {
    for (var s = 0; s < items.length; s++) {
      var ok = archiveEmailThread_(items[s].thread_id);
      results.push({
        id: items[s].id,
        room_name: items[s].sender_name + " <" + items[s].sender_address + ">",
        action: "アーカイブ",
        success: ok
      });
    }
    return results;
  }

  // --- パターン1: スキップ学習（複数書式対応）---
  // 書式A（キーワード先行）: 「以後スキップ @domain.com」「今後スキップ addr@x.com」
  // 書式B（アドレス先行・自然語）: 「@domain.comはスキップ」「addr@x.comスキップ」「@x.comは以後スキップ」
  // 複数指定可（カンマ・スペース・改行・読点区切り）
  var learnedSkips = [];
  var skipSeen = {};  // 重複学習防止（同一文中の二重マッチ対策）

  // 書式A: キーワード先行
  var skipPatternA = /(?:以後スキップ|今後スキップ|永久スキップ)\s*([^\s,、。]+)/g;
  // 書式B: アドレス/ドメイン先行（@で始まるドメイン or アドレス）→ 「(以後|今後|永久)?スキップ」
  // ドメイン: @[\w.-]+ / アドレス: [\w.+-]+@[\w.-]+
  var skipPatternB = /(@[A-Za-z0-9._-]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*(?:は|を)?\s*(?:以後|今後|永久)?スキップ/g;

  var skipMatch;
  var patterns = [skipPatternA, skipPatternB];
  for (var pi = 0; pi < patterns.length; pi++) {
    var pat = patterns[pi];
    while ((skipMatch = pat.exec(cmd)) !== null) {
      var raw = skipMatch[1].trim().replace(/^["'<]|["'>]$/g, "");
      var ctype, value;
      if (raw.indexOf("@") === 0) {
        ctype = "domain";
        value = raw.substring(1).toLowerCase();
      } else if (raw.indexOf("@") > 0) {
        ctype = "address";
        value = raw.toLowerCase();
      } else {
        ctype = "domain";
        value = raw.toLowerCase();
      }
      var key = ctype + "::" + value;
      if (skipSeen[key]) continue;
      skipSeen[key] = true;

      var saved = appendSkipRule_(ctype, value, "boss_command");
      learnedSkips.push({ condition_type: ctype, value: value, saved: saved });
      results.push({
        id: "-",
        room_name: "[学習] スキップルール追加",
        action: ctype + "=" + value,
        success: saved
      });
    }
  }

  // --- パターン2: 「テンプレ保存 sender@addr: 本文」 / 「テンプレ保存 @domain: 本文」 ---
  var templPattern = /テンプレ保存\s*([^\s:：]+)\s*[:：]\s*([\s\S]+?)(?=$|\nテンプレ保存|\n以後スキップ)/g;
  var templMatch;
  while ((templMatch = templPattern.exec(cmd)) !== null) {
    var rawT = templMatch[1].trim();
    var bodyT = templMatch[2].trim();
    var ctypeT, valueT;
    if (rawT.indexOf("@") === 0) {
      ctypeT = "domain";
      valueT = rawT.substring(1);
    } else if (rawT.indexOf("@") > 0) {
      ctypeT = "address";
      valueT = rawT.toLowerCase();
    } else {
      ctypeT = "address";
      valueT = rawT.toLowerCase();
    }
    var savedT = appendReplyTemplate_(ctypeT, valueT, bodyT, "boss_command");
    results.push({
      id: "-",
      room_name: "[学習] 返信テンプレ追加",
      action: ctypeT + "=" + valueT,
      success: savedT
    });
  }

  // --- パターン3: 各アイテムへの個別指示 ---
  for (var j = 0; j < items.length; j++) {
    var item = items[j];
    var itemId = item.id; // "A", "B"...
    var executed = false;

    // 「Aは案の通り」「A OK」「Aそのまま送信」「A送信」
    var approvePatterns = [
      itemId + "は案の通り", itemId + "案の通り",
      itemId + "はそのまま送信", itemId + "そのまま送信",
      itemId + "は送信", itemId + "送信",
      itemId + " OK", itemId + "はOK", itemId + " ok", itemId + "はok"
    ];
    if (matchAny_(cmd, approvePatterns)) {
      if (item.draft_reply) {
        var sent = sendEmailReply_(item.thread_id, item.message_id, item.subject,
                                    item.sender_address, item.draft_reply);
        results.push({
          id: itemId,
          room_name: item.sender_name + " <" + item.sender_address + ">",
          action: "メール送信(下書き案)",
          message: item.draft_reply.substring(0, 30) + "...",
          success: sent
        });
        executed = true;
      } else {
        results.push({
          id: itemId, room_name: item.sender_address,
          action: "送信スキップ",
          success: false, note: "draft_reply 空"
        });
        executed = true;
      }
    }

    // 「Aはこう返して: XXX」/「Aにこう返信: XXX」
    var customRe = new RegExp(itemId + "[はにを]?\\s*こう返[し信事][てし]?\\s*[:：]\\s*([\\s\\S]+?)(?=\\n[A-Z][はにを]|$)");
    var customMatch = cmd.match(customRe);
    if (!executed && customMatch) {
      var customBody = customMatch[1].trim();
      var sent2 = sendEmailReply_(item.thread_id, item.message_id, item.subject,
                                    item.sender_address, customBody);
      results.push({
        id: itemId,
        room_name: item.sender_name + " <" + item.sender_address + ">",
        action: "カスタムメール送信",
        message: customBody.substring(0, 30) + "...",
        success: sent2
      });
      executed = true;
    }

    // 「Aはスキップ」「Aアーカイブ」「Aは既読」
    var skipItemPatterns = [
      itemId + "はスキップ", itemId + "スキップ",
      itemId + "はアーカイブ", itemId + "アーカイブ",
      itemId + "は既読", itemId + "既読のみ", itemId + "既読で"
    ];
    if (!executed && matchAny_(cmd, skipItemPatterns)) {
      var arch = archiveEmailThread_(item.thread_id);
      results.push({
        id: itemId,
        room_name: item.sender_name + " <" + item.sender_address + ">",
        action: "アーカイブ",
        success: arch
      });
      executed = true;
    }

    if (!executed) {
      results.push({
        id: itemId,
        room_name: item.sender_name + " <" + item.sender_address + ">",
        action: "保留",
        success: true,
        note: "該当指示なし"
      });
    }

    Utilities.sleep(200);
  }

  return results;
}


// =============================================================
// Gmail: スレッドへ返信送信（Phase G4）
// =============================================================
function sendEmailReply_(threadId, messageId, subject, toAddress, body) {
  try {
    if (threadId) {
      var thread = GmailApp.getThreadById(threadId);
      if (thread) {
        thread.replyAll(body);
        Logger.log("[OK] Gmail送信完了: thread=" + threadId + " (replyAll)");
        return true;
      }
    }
    if (messageId) {
      var msg = GmailApp.getMessageById(messageId);
      if (msg) {
        msg.reply(body);
        Logger.log("[OK] Gmail送信完了: message=" + messageId + " (reply)");
        return true;
      }
    }
    // フォールバック: 新規メールとして送信
    GmailApp.sendEmail(toAddress, "Re: " + subject, body);
    Logger.log("[WARN] Gmail送信フォールバック sendEmail: to=" + toAddress);
    return true;
  } catch (e) {
    Logger.log("[ERROR] Gmail送信失敗: " + e.message);
    return false;
  }
}


// =============================================================
// Gmail: スレッドをアーカイブ（未読解除＋受信トレイから外す）
// =============================================================
function archiveEmailThread_(threadId) {
  try {
    if (!threadId) return false;
    var thread = GmailApp.getThreadById(threadId);
    if (!thread) {
      Logger.log("[WARN] スレッド未取得: " + threadId);
      return false;
    }
    thread.markRead();
    thread.moveToArchive();
    Logger.log("[OK] アーカイブ完了: thread=" + threadId);
    return true;
  } catch (e) {
    Logger.log("[ERROR] アーカイブ失敗: " + e.message);
    return false;
  }
}


// =============================================================
// 学習ルール: スキップルール追加
// =============================================================
function appendSkipRule_(conditionType, value, source) {
  try {
    var rules = loadLearnedRules_();
    // 重複チェック
    for (var i = 0; i < rules.skip_rules.length; i++) {
      var r = rules.skip_rules[i];
      if (r.condition_type === conditionType && (r.value || "").toLowerCase() === value.toLowerCase()) {
        Logger.log("[INFO] 重複スキップルール: " + conditionType + "=" + value + " (既登録)");
        return true;
      }
    }
    rules.skip_rules.push({
      condition_type: conditionType,
      value: value,
      reason: "boss指示による学習",
      added_at: nowIso_(),
      source: source || "boss_command"
    });
    return saveLearnedRules_(rules);
  } catch (e) {
    Logger.log("[ERROR] appendSkipRule_: " + e.message);
    return false;
  }
}


// =============================================================
// 学習ルール: 返信テンプレート追加
// =============================================================
function appendReplyTemplate_(conditionType, value, template, source) {
  try {
    var rules = loadLearnedRules_();
    rules.reply_templates.push({
      condition_type: conditionType,
      value: value,
      template: template,
      added_at: nowIso_(),
      source: source || "boss_command"
    });
    return saveLearnedRules_(rules);
  } catch (e) {
    Logger.log("[ERROR] appendReplyTemplate_: " + e.message);
    return false;
  }
}


// =============================================================
// 学習ルール: ファイル読込
// =============================================================
function loadLearnedRules_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty("SENT_CONTACTS_FOLDER_ID")
                  || props.getProperty("INBOX_FOLDER_ID");
  var fileName = props.getProperty("LEARNED_RULES_FILENAME") || LEARNED_RULES_DEFAULT_FILENAME;

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    var f = files.next();
    var json = JSON.parse(f.getBlob().getDataAsString("UTF-8"));
    if (!json.skip_rules) json.skip_rules = [];
    if (!json.reply_templates) json.reply_templates = [];
    return json;
  }
  // ファイル未存在 → 空テンプレ返却（保存時に新規作成される）
  return {
    schema_version: "1.0",
    description: "AIEiji秘書 Gmail Pipeline 学習ルール",
    last_updated: nowIso_(),
    skip_rules: [],
    reply_templates: []
  };
}


// =============================================================
// 学習ルール: ファイル保存（上書き）
// =============================================================
function saveLearnedRules_(rules) {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty("SENT_CONTACTS_FOLDER_ID")
                  || props.getProperty("INBOX_FOLDER_ID");
  var fileName = props.getProperty("LEARNED_RULES_FILENAME") || LEARNED_RULES_DEFAULT_FILENAME;

  rules.last_updated = nowIso_();
  var jsonStr = JSON.stringify(rules, null, 2);

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    files.next().setContent(jsonStr);
  } else {
    folder.createFile(fileName, jsonStr, MimeType.PLAIN_TEXT);
  }
  Logger.log("[OK] learned_rules_email.json 保存完了 ("
    + rules.skip_rules.length + " skip / "
    + rules.reply_templates.length + " templates)");
  return true;
}


// =============================================================
// ユーティリティ: ISO 8601 現在時刻（JST）
// =============================================================
function nowIso_() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ssXXX");
}


// =============================================================
// 完了報告テキスト生成
// =============================================================
function buildCompletionReport_(results) {
  var lines = [];
  lines.push("[info][title]AIEiji秘書 処理完了[/title]");

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var icon = r.success ? "(OK)" : "(NG)";
    var line = icon + " " + r.id + ". " + r.room_name + " : " + r.action;
    if (r.message) {
      line += "\n   " + r.message;
    }
    if (r.note) {
      line += " (" + r.note + ")";
    }
    lines.push(line);
  }

  lines.push("[/info]");
  return lines.join("\n");
}


// =============================================================
// Chatwork API: メッセージ送信（POST）
// =============================================================
function postChatworkMessage_(token, roomId, body) {
  var url = CHATWORK_API_BASE + "/rooms/" + roomId + "/messages";
  var options = {
    method: "post",
    headers: {
      "X-ChatWorkToken": token
    },
    payload: {
      body: body
    },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code === 200) {
      return JSON.parse(response.getContentText());
    } else if (code === 429) {
      Logger.log("[WARN] Rate Limit (429)。5秒後にリトライ: POST " + roomId);
      Utilities.sleep(5000);
      response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        return JSON.parse(response.getContentText());
      }
    }
    Logger.log("[ERROR] POST失敗 " + code + ": " + response.getContentText());
    return null;
  } catch (e) {
    Logger.log("[ERROR] POST通信エラー: " + e.message);
    return null;
  }
}


// =============================================================
// Chatwork API: ルームの既読化（PUT）
// =============================================================
function markRoomAsRead_(token, roomId) {
  // 最新メッセージIDを取得して既読マーク
  var messages = callChatworkApiGet_(token, "/rooms/" + roomId + "/messages?force=1");
  if (!messages || messages.length === 0) {
    Logger.log("[WARN] 既読化: メッセージ取得失敗 room_id=" + roomId);
    return false;
  }

  var lastMsgId = messages[messages.length - 1].message_id;
  var url = CHATWORK_API_BASE + "/rooms/" + roomId + "/messages/read";
  var options = {
    method: "put",
    headers: {
      "X-ChatWorkToken": token
    },
    payload: {
      message_id: lastMsgId
    },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code === 200) {
      Logger.log("[OK] 既読化完了: room_id=" + roomId);
      return true;
    }
    Logger.log("[ERROR] 既読化失敗 " + code + ": " + response.getContentText());
    return false;
  } catch (e) {
    Logger.log("[ERROR] 既読化通信エラー: " + e.message);
    return false;
  }
}


// =============================================================
// Chatwork API: GET（Inbound.gsのcallChatworkApi_と同等）
// 同一プロジェクト内ではInbound側を使用可能。
// 単体テスト用に独立関数としても定義。
// =============================================================
function callChatworkApiGet_(token, endpoint) {
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
      Utilities.sleep(5000);
      response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        return JSON.parse(response.getContentText());
      }
    }
    Logger.log("[ERROR] GET失敗 " + code + ": " + response.getContentText());
    return null;
  } catch (e) {
    Logger.log("[ERROR] GET通信エラー: " + e.message);
    return null;
  }
}


// =============================================================
// ユーティリティ: 文字列パターンマッチ（部分一致）
// =============================================================
function matchAny_(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    if (text.indexOf(patterns[i]) >= 0) {
      return true;
    }
  }
  return false;
}


// =============================================================
// ユーティリティ: サブフォルダ取得（なければ作成）
// =============================================================
function getOrCreateSubfolder_(parentFolder, subName) {
  var folders = parentFolder.getFoldersByName(subName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(subName);
}


// =============================================================
// 手動テスト: ブリーフィング配信の単発実行
// =============================================================
function testDeliverBriefing() {
  deliverBriefing();
}


// =============================================================
// 手動テスト: コマンド実行の単発実行
// =============================================================
function testExecuteCommand() {
  executeBossCommand();
}


// =============================================================
// セットアップ確認: Phase 3 固有プロパティのチェック
// =============================================================
function verifyPhase3Setup() {
  var props = PropertiesService.getScriptProperties();
  var token     = props.getProperty("CHATWORK_API_TOKEN");
  var outboxId  = props.getProperty("OUTBOX_FOLDER_ID");
  var myChatId  = props.getProperty("MY_CHAT_ROOM_ID");
  var myAccId   = props.getProperty("MY_ACCOUNT_ID");

  Logger.log("=== AIEiji秘書 Phase 3 Outbound セットアップ確認 ===");
  Logger.log("CHATWORK_API_TOKEN: " + (token ? "OK" : "未設定"));
  Logger.log("OUTBOX_FOLDER_ID:   " + (outboxId ? "OK (" + outboxId + ")" : "未設定"));
  Logger.log("MY_CHAT_ROOM_ID:    " + (myChatId ? "OK (" + myChatId + ")" : "未設定"));
  Logger.log("MY_ACCOUNT_ID:      " + (myAccId ? "OK (" + myAccId + ")" : "未設定"));

  if (outboxId) {
    try {
      var folder = DriveApp.getFolderById(outboxId);
      Logger.log("Outboxフォルダ: " + folder.getName() + " (アクセスOK)");
    } catch (e) {
      Logger.log("Outboxフォルダ: アクセス失敗 - " + e.message);
    }
  }

  if (token && myChatId) {
    Logger.log("--- マイチャット書き込みテスト ---");
    var testResult = postChatworkMessage_(token, myChatId,
      "[info][title]AIEiji秘書 セットアップテスト[/title]Phase 3 Outbound が正常に動作しています。[/info]"
    );
    if (testResult) {
      Logger.log("マイチャットへのテスト投稿: OK (message_id: " + testResult.message_id + ")");
    } else {
      Logger.log("マイチャットへのテスト投稿: 失敗 - MY_CHAT_ROOM_IDを確認してください");
    }
  }
}


// =============================================================
// セットアップ確認: Phase G4 (Email) 固有の検証
// =============================================================
function verifyPhase4Setup() {
  var props = PropertiesService.getScriptProperties();
  var sentFolderId = props.getProperty("SENT_CONTACTS_FOLDER_ID");
  var rulesName    = props.getProperty("LEARNED_RULES_FILENAME") || LEARNED_RULES_DEFAULT_FILENAME;

  Logger.log("=== AIEiji秘書 Phase G4 (Email) セットアップ確認 ===");
  Logger.log("SENT_CONTACTS_FOLDER_ID: " + (sentFolderId || "未設定（INBOX_FOLDER_IDへフォールバック）"));
  Logger.log("LEARNED_RULES_FILENAME:  " + rulesName);

  // GmailApp 接続テスト
  Logger.log("--- GmailApp 接続テスト ---");
  try {
    var t = GmailApp.search("in:inbox", 0, 1);
    Logger.log("GmailApp接続: OK（受信トレイ取得可能）");
  } catch (e) {
    Logger.log("GmailApp接続: FAIL - " + e.message);
  }

  // learned_rules_email.json 読込テスト
  Logger.log("--- learned_rules_email.json 読込テスト ---");
  try {
    var rules = loadLearnedRules_();
    Logger.log("学習ルール読込: OK (skip=" + rules.skip_rules.length
      + " / templates=" + rules.reply_templates.length + ")");
  } catch (e) {
    Logger.log("学習ルール読込: FAIL - " + e.message);
  }

  // Outbox の email_reply_draft_ ファイル数確認
  Logger.log("--- Outbox email_reply_draft 検出 ---");
  var outboxId = props.getProperty("OUTBOX_FOLDER_ID");
  if (outboxId) {
    try {
      var folder = DriveApp.getFolderById(outboxId);
      var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
      var count = 0;
      while (files.hasNext()) {
        var n = files.next().getName();
        if (n.indexOf("email_reply_draft_") === 0) count++;
      }
      Logger.log("Outboxの email_reply_draft 件数: " + count);
    } catch (e) {
      Logger.log("Outbox確認失敗: " + e.message);
    }
  }
  Logger.log("=== Phase G4 確認完了 ===");
}


// =============================================================
// 学習ルール: 内容確認用デバッグ関数
// =============================================================
function debugLearnedRules() {
  try {
    var rules = loadLearnedRules_();
    Logger.log("=== learned_rules_email.json 現在内容 ===");
    Logger.log("last_updated: " + rules.last_updated);
    Logger.log("--- skip_rules (" + rules.skip_rules.length + "件) ---");
    for (var i = 0; i < rules.skip_rules.length; i++) {
      var r = rules.skip_rules[i];
      Logger.log("  [" + i + "] " + r.condition_type + "=" + r.value + " (" + r.added_at + ")");
    }
    Logger.log("--- reply_templates (" + rules.reply_templates.length + "件) ---");
    for (var j = 0; j < rules.reply_templates.length; j++) {
      var t = rules.reply_templates[j];
      Logger.log("  [" + j + "] " + t.condition_type + "=" + t.value
        + " : " + (t.template || "").substring(0, 30) + "...");
    }
  } catch (e) {
    Logger.log("[ERROR] " + e.message);
  }
}


// =============================================================
// デバッグ: アクティブドラフトの状態確認
// =============================================================
function debugActiveDraft() {
  var props = PropertiesService.getScriptProperties();
  var draft = props.getProperty("ACTIVE_DRAFT");
  var name  = props.getProperty("ACTIVE_DRAFT_NAME");
  var msgId = props.getProperty("BRIEFING_MESSAGE_ID");

  Logger.log("ACTIVE_DRAFT_NAME:    " + (name || "なし"));
  Logger.log("BRIEFING_MESSAGE_ID:  " + (msgId || "なし"));
  Logger.log("ACTIVE_DRAFT:         " + (draft ? draft.substring(0, 100) + "..." : "なし"));
}


// =============================================================
// デバッグ: アクティブドラフトを手動クリア
// =============================================================
function clearActiveDraft() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("ACTIVE_DRAFT");
  props.deleteProperty("ACTIVE_DRAFT_NAME");
  props.deleteProperty("BRIEFING_MESSAGE_ID");
  Logger.log("アクティブドラフトをクリアしました。");
}


// =============================================================
// =============================================================
// Phase G5: オンデマンド返信フロー
// =============================================================
// =============================================================

// --- パターンパーサー ---
function parseOnDemandReplyRequest_(text) {
  // 「<キーワード>の件、返信して：<本文>」or 「<キーワード>の件 返信して: <本文>」
  var m = text.match(/^([\s\S]+?)の件[\s、,]*返信して\s*[：:]\s*([\s\S]+)$/);
  if (m) {
    return { keyword: m[1].trim(), body: m[2].trim() };
  }
  return null;
}

function parseOnDemandApprove_(text) {
  return /^(A\s*OK|A\s*送信|A\s*そのまま|そのまま送信|OK送信)\s*$/i.test(text);
}

function parseOnDemandCancel_(text) {
  return /^(キャンセル|やめて|破棄|中止|取消)\s*$/.test(text);
}

function parseOnDemandRewrite_(text) {
  // 「こう変えて：xxx」「本文：xxx」「修正：xxx」「変更：xxx」
  var m = text.match(/^(?:こう変えて|本文|修正|変更)\s*[：:]\s*([\s\S]+)$/);
  if (m) return m[1].trim();
  return null;
}


// --- Gmail検索（差出人 → 件名 → 全文の順） ---
function findEmailByKeyword_(keyword) {
  var rules = loadLearnedRules_();
  var skipDomains = (rules.skip_rules || [])
    .filter(function(r) { return r.condition_type === "domain"; })
    .map(function(r) { return String(r.value || "").toLowerCase(); });
  var skipAddrs = (rules.skip_rules || [])
    .filter(function(r) { return r.condition_type === "address" || r.condition_type === "email"; })
    .map(function(r) { return String(r.value || "").toLowerCase(); });

  function notSkipped(thread) {
    try {
      var msgs = thread.getMessages();
      var fromAddr = msgs[msgs.length - 1].getFrom().toLowerCase();
      if (skipAddrs.some(function(a) { return a && fromAddr.indexOf(a) >= 0; })) return false;
      if (skipDomains.some(function(d) { return d && fromAddr.indexOf("@" + d) >= 0; })) return false;
      return true;
    } catch (e) { return true; }
  }

  var queries = [
    { mode: "from",     q: 'from:"' + keyword + '" -in:trash' },
    { mode: "subject",  q: 'subject:"' + keyword + '" -in:trash' },
    { mode: "fulltext", q: '"' + keyword + '" -in:trash' }
  ];

  for (var i = 0; i < queries.length; i++) {
    try {
      var threads = GmailApp.search(queries[i].q, 0, 10);
      Logger.log("[SEARCH] " + queries[i].mode + " (" + queries[i].q + ") → " + threads.length + " 件");
      var filtered = threads.filter(notSkipped);
      if (filtered.length > 0) {
        return { thread: filtered[0], matchedBy: queries[i].mode };
      }
    } catch (e) {
      Logger.log("[WARN] " + queries[i].mode + " 検索エラー: " + e.message);
    }
  }
  return null;
}


// --- 下書き構築 ---
function buildOnDemandDraft_(thread, replyBody, keyword, matchedBy) {
  var msgs = thread.getMessages();
  var latest = msgs[msgs.length - 1];
  var subject = latest.getSubject() || "(件名なし)";
  var fromAddr = latest.getFrom();

  var signature = PropertiesService.getScriptProperties().getProperty("EMAIL_SIGNATURE") || "";
  var greeting = "お世話になっております。\n\n";
  var fullBody = greeting + replyBody + (signature ? "\n\n" + signature : "");

  var subjectIsReply = /^Re:/i.test(subject);
  return {
    type: "ondemand_email_reply",
    thread_id: thread.getId(),
    message_id: latest.getId(),
    to: fromAddr,
    subject: subjectIsReply ? subject : "Re: " + subject,
    body: fullBody,
    raw_body: replyBody,
    matched_keyword: keyword,
    matched_by: matchedBy,
    created_at: nowIso_()
  };
}


// --- マイチャットへ下書き提示 ---
function presentOnDemandDraft_(apiToken, myChatRoom, draft) {
  var matchLabel = ({ from: "差出人", subject: "件名", fulltext: "本文" })[draft.matched_by] || draft.matched_by;
  var msg = "[info][title](*) AIEiji秘書 返信下書き ✉[/title]"
    + "■ 検索: " + matchLabel + "「" + draft.matched_keyword + "」\n"
    + "■ 宛先: " + draft.to + "\n"
    + "■ 件名: " + draft.subject + "\n"
    + "──────────\n"
    + draft.body + "\n"
    + "──────────\n"
    + "送信は [A OK]\n"
    + "修正は [こう変えて：xxx]\n"
    + "破棄は [キャンセル]"
    + "[/info]";
  var result = postChatworkMessage_(apiToken, myChatRoom, msg);
  if (result) {
    Logger.log("[OK] 下書き提示完了: msg_id=" + result.message_id);
    return true;
  }
  Logger.log("[ERROR] 下書き提示失敗");
  return false;
}


// --- ハンドラ：返信指示を受けて下書き作成・提示 ---
function handleOnDemandReplyRequest_(apiToken, myChatRoom, keyword, replyBody) {
  Logger.log("[ONDEMAND] 検索開始: keyword=" + keyword);
  var hit = findEmailByKeyword_(keyword);
  if (!hit) {
    postChatworkMessage_(apiToken, myChatRoom,
      "[info](NG) 該当メールが見つかりません: 「" + keyword + "」\n"
      + "差出人 → 件名 → 全文の順で検索しましたがヒットしませんでした。"
      + "[/info]");
    return;
  }
  var draft = buildOnDemandDraft_(hit.thread, replyBody, keyword, hit.matchedBy);
  presentOnDemandDraft_(apiToken, myChatRoom, draft);
  PropertiesService.getScriptProperties().setProperty("ACTIVE_DRAFT", JSON.stringify(draft));
}


// --- ハンドラ：承認 → 送信 ---
function handleOnDemandApprove_(apiToken, myChatRoom, draft) {
  Logger.log("[ONDEMAND] 送信実行: thread=" + draft.thread_id);
  var ok = sendEmailReply_(draft.thread_id, draft.message_id, draft.subject, draft.to, draft.body);
  if (ok) {
    postChatworkMessage_(apiToken, myChatRoom,
      "[info](OK) Gmail送信完了\n"
      + "宛先: " + draft.to + "\n"
      + "件名: " + draft.subject + "[/info]");
  } else {
    postChatworkMessage_(apiToken, myChatRoom,
      "[info](NG) Gmail送信失敗。GASログを確認してください。[/info]");
  }
}


// --- ハンドラ：キャンセル ---
function handleOnDemandCancel_(apiToken, myChatRoom, draft) {
  postChatworkMessage_(apiToken, myChatRoom,
    "[info](info) 下書きを破棄しました。\n件名: " + draft.subject + "[/info]");
}


// --- ハンドラ：本文修正 → 再生成・再提示 ---
function handleOnDemandRewrite_(apiToken, myChatRoom, draft, newReplyBody) {
  try {
    var thread = GmailApp.getThreadById(draft.thread_id);
    if (!thread) throw new Error("thread not found: " + draft.thread_id);
    var newDraft = buildOnDemandDraft_(thread, newReplyBody, draft.matched_keyword, draft.matched_by);
    presentOnDemandDraft_(apiToken, myChatRoom, newDraft);
    PropertiesService.getScriptProperties().setProperty("ACTIVE_DRAFT", JSON.stringify(newDraft));
  } catch (e) {
    Logger.log("[ERROR] 修正失敗: " + e.message);
    postChatworkMessage_(apiToken, myChatRoom,
      "[info](NG) 修正に失敗しました: " + e.message + "[/info]");
  }
}


// =============================================================
// デバッグ: LAST_PROCESSED_MSG_ID をリセット
// =============================================================
function resetLastProcessedMsgId() {
  PropertiesService.getScriptProperties().deleteProperty("LAST_PROCESSED_MSG_ID");
  Logger.log("LAST_PROCESSED_MSG_ID をクリアしました。次回 executeBossCommand で再初期化されます。");
}
