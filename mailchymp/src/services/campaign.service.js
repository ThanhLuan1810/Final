// services/campaign.service.js
const { google } = require("googleapis");
const { pool } = require("../config/db");
const { makeToken32 } = require("../utils/crypto");
const { getUserGmailAuth } = require("./gmail.service");
const { injectTracking, baseUrl } = require("./tracking.service");

function buildRawEmail({ to, subject, html, from, replyTo }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
  ];
  if (from) headers.unshift(`From: ${from}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);

  const msg = headers.join("\r\n") + "\r\n\r\n" + html;
  const b64 = Buffer.from(msg, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isLikelyEmail(s) {
  const v = String(s || "")
    .trim()
    .toLowerCase();
  // đủ xài: tránh rỗng / thiếu @ / thiếu domain
  return v && v.includes("@") && v.split("@")[1]?.includes(".");
}

function stringifyGmailError(e) {
  // ✅ Gmail API hay để lỗi xịn trong e.response.data
  if (e?.response?.data) {
    try {
      return JSON.stringify(e.response.data);
    } catch {
      // fallthrough
    }
  }
  if (e?.errors) {
    try {
      return JSON.stringify(e.errors);
    } catch {}
  }
  return String(e?.stack || e?.message || e || "");
}

function clip(s, max = 1200) {
  const t = String(s || "");
  return t.length > max ? t.slice(0, max) : t;
}

// Core send worker
async function sendCampaignToList({ campaign_id, list_id, user_id, port }) {
  const [cRows] = await pool.query(
    `SELECT id, subject, html, from_name, from_email, reply_to
     FROM campaigns
     WHERE id=? AND user_id=?
     LIMIT 1`,
    [campaign_id, user_id],
  );
  if (!cRows.length) throw new Error("Campaign not found");
  const camp = cRows[0];

  const [lRows] = await pool.query(
    "SELECT id FROM lists WHERE id=? AND user_id=? LIMIT 1",
    [list_id, user_id],
  );
  if (!lRows.length) throw new Error("List not found");

  const [subs] = await pool.query(
    `SELECT s.id AS subscriber_id, s.email
     FROM subscribers s
     JOIN list_subscribers ls ON ls.subscriber_id=s.id
     WHERE ls.list_id=?`,
    [list_id],
  );
  if (!subs.length) throw new Error("List is empty");

  const auth = await getUserGmailAuth(user_id);
  if (!auth) throw new Error("Gmail not connected");

  const gmail = google.gmail({ version: "v1", auth: auth.oAuth2Client });

  let sent = 0;
  let failed = 0;

  const base = baseUrl(port);

  for (const s of subs) {
    const token = makeToken32();
    const toEmail = String(s.email || "")
      .trim()
      .toLowerCase();

    // ✅ Validate email trước cho khỏi Gmail 400
    if (!isLikelyEmail(toEmail)) {
      failed++;

      // vẫn tạo/update log để dashboard thấy rõ
      const [logIns] = await pool.query(
        `INSERT INTO campaign_sends
           (campaign_id, subscriber_id, email, to_email, status, tracking_token, error_text, created_at)
         VALUES (?,?,?,?, 'failed', ?, 'Invalid email address', NOW())
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           email = VALUES(email),
           to_email = VALUES(to_email),
           status = 'failed',
           tracking_token = VALUES(tracking_token),
           error_text = 'Invalid email address',
           sent_at = NULL,
           gmail_message_id = NULL,
           open_count = 0,
           opened_at = NULL,
           click_count = 0,
           last_clicked_at = NULL,
           created_at = NOW()`,
        [campaign_id, s.subscriber_id, toEmail, toEmail, token],
      );

      // eslint-disable-next-line no-unused-vars
      const sendRowId = logIns.insertId;
      continue;
    }

    // Insert queued log row (upsert)
    const [logIns] = await pool.query(
      `INSERT INTO campaign_sends
         (campaign_id, subscriber_id, email, to_email, status, tracking_token, created_at)
       VALUES (?,?,?,?, 'queued', ?, NOW())
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         email = VALUES(email),
         to_email = VALUES(to_email),
         status = 'queued',
         tracking_token = VALUES(tracking_token),
         error_text = NULL,
         sent_at = NULL,
         gmail_message_id = NULL,
         open_count = 0,
         opened_at = NULL,
         click_count = 0,
         last_clicked_at = NULL,
         created_at = NOW()`,
      [campaign_id, s.subscriber_id, toEmail, toEmail, token],
    );

    const sendRowId = logIns.insertId;

    try {
      const trackedHtml = injectTracking(camp.html, token, base);

      const raw = buildRawEmail({
        to: toEmail,
        subject: camp.subject,
        html: trackedHtml,
        from: `${camp.from_name} <${auth.gmailEmail}>`,
        replyTo: camp.reply_to || undefined,
      });

      const resp = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });

      const msgId = resp?.data?.id || null;

      await pool.query(
        `UPDATE campaign_sends
         SET status='sent', sent_at=NOW(), error_text=NULL, gmail_message_id=?
         WHERE id=?`,
        [msgId, sendRowId],
      );

      sent++;
    } catch (e) {
      failed++;

      // ✅ lỗi Gmail “có thịt”
      const details = clip(stringifyGmailError(e), 1800);

      await pool.query(
        `UPDATE campaign_sends
         SET status='failed', error_text=?
         WHERE id=?`,
        [details, sendRowId],
      );
    }
  }

  // ✅ Status logic đỡ “hoảng”:
  // - gửi được ít nhất 1 cái: coi như SENT (dù có fail vài cái)
  // - không gửi được cái nào mà fail > 0: FAILED
  let finalStatus = "SENT";
  if (sent === 0 && failed > 0) finalStatus = "FAILED";

  await pool.query(
    `UPDATE campaigns SET status=?, scheduled_at=NULL WHERE id=? AND user_id=?`,
    [finalStatus, campaign_id, user_id],
  );

  return { sent, failed, total: subs.length };
}

module.exports = { sendCampaignToList };
