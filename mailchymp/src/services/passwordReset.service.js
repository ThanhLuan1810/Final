// src/services/passwordReset.service.js
const { google } = require("googleapis");
const bcrypt = require("bcrypt");
const { pool } = require("../config/db");
const { sha256, makeOtp6, safeCompareHash } = require("../utils/crypto");
const { getSystemGmailAuth } = require("./gmail.service");

/**
 * Encode header theo MIME encoded-word để Subject/From có tiếng Việt không bị "Ã..."
 */
function encodeHeaderUtf8(str) {
  const s = String(str || "");
  // ASCII thì để nguyên
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/**
 * Build raw RFC822 email then base64url encode for Gmail API
 */
function buildRawEmail({ to, subject, html, from, replyTo }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${encodeHeaderUtf8(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
  ];
  if (from) headers.unshift(`From: ${encodeHeaderUtf8(from)}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);

  const msg = headers.join("\r\n") + "\r\n\r\n" + html;
  const b64 = Buffer.from(msg, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

async function sendOtpEmailViaSystemGmail({ toEmail, otp }) {
  const sys = await getSystemGmailAuth();
  if (!sys?.oAuth2Client) {
    throw new Error("System Gmail not connected");
  }

  const gmail = google.gmail({ version: "v1", auth: sys.oAuth2Client });

  const subject = "OTP đổi mật khẩu (Mailchymp)";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px">Mã OTP đổi mật khẩu</h2>
      <p>Mã của bạn là:</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:4px;margin:10px 0 14px">
        ${otp}
      </div>
      <p>Mã có hiệu lực <b>5 phút</b>. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
    </div>
  `;

  const raw = buildRawEmail({
    to: toEmail,
    subject,
    html,
    from: sys.gmailEmail ? `Mailchymp <${sys.gmailEmail}>` : undefined,
  });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

/**
 * Request OTP (anti-enumeration: luôn trả ok = true)
 * - Cooldown 60s per user
 * - OTP expire 5 minutes
 */
async function requestPasswordResetOtp(email) {
  const e = normalizeEmail(email);
  if (!e) return { ok: true };

  // 1) tìm user theo email
  const [users] = await pool.query(
    "SELECT id, email FROM users WHERE email=? LIMIT 1",
    [e],
  );

  // Anti-enumeration: email không tồn tại vẫn trả ok
  if (!users.length) return { ok: true };

  const user = users[0];

  // 2) cooldown 60s (nếu đã xin OTP gần đây thì thôi)
  const [last] = await pool.query(
    `SELECT created_at
       FROM password_resets
      WHERE user_id=?
      ORDER BY created_at DESC
      LIMIT 1`,
    [user.id],
  );

  if (last.length) {
    const createdAt = new Date(last[0].created_at).getTime();
    if (Date.now() - createdAt < 60_000) {
      return { ok: true };
    }
  }

  // 3) create otp + store hash
  const otp = makeOtp6(); // 6 digits
  const otp_hash = sha256(otp);

  // NOTE: schema của bạn KHÔNG có cột attempts, nên không insert attempts
  await pool.query(
    `INSERT INTO password_resets (user_id, otp_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
    [user.id, otp_hash],
  );

  // 4) gửi email OTP bằng Gmail hệ thống
  await sendOtpEmailViaSystemGmail({ toEmail: user.email, otp });

  return { ok: true };
}

/**
 * Verify OTP -> return reset_id để dùng cho bước reset password
 * - OTP must be latest, not used, not expired
 */
async function verifyOtp({ email, otp }) {
  const e = normalizeEmail(email);
  const o = String(otp || "").trim();

  if (!e || !o) return { ok: false, message: "Thiếu dữ liệu" };

  const [users] = await pool.query(
    "SELECT id FROM users WHERE email=? LIMIT 1",
    [e],
  );
  if (!users.length) return { ok: false, message: "OTP không hợp lệ" };

  const userId = users[0].id;

  // lấy OTP mới nhất còn hiệu lực, chưa dùng
  const [rs] = await pool.query(
    `SELECT id, otp_hash
       FROM password_resets
      WHERE user_id=?
        AND used_at IS NULL
        AND expires_at >= NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );

  if (!rs.length)
    return { ok: false, message: "OTP hết hạn hoặc không tồn tại" };

  const row = rs[0];

  // so sánh OTP input với otp_hash (constant-time nếu bạn có safeCompareHash)
  // nếu bạn chưa muốn dùng safeCompareHash thì dùng sha256(o) === row.otp_hash
  const isOk =
    typeof safeCompareHash === "function"
      ? safeCompareHash(o, row.otp_hash)
      : sha256(o) === row.otp_hash;

  if (!isOk) {
    return { ok: false, message: "OTP sai" };
  }

  return { ok: true, reset_id: row.id };
}

/**
 * Reset password using reset_id from verifyOtp
 * - reset_id must belong to user, not used, not expired
 * - update users.password (bcrypt)
 * - mark password_resets.used_at
 */
async function resetPassword({ email, reset_id, new_password }) {
  const e = normalizeEmail(email);
  const rid = Number(reset_id);
  const np = String(new_password || "");

  if (!e || !rid || !np) return { ok: false, message: "Thiếu dữ liệu" };
  if (np.length < 6)
    return { ok: false, message: "Mật khẩu tối thiểu 6 ký tự" };

  const [users] = await pool.query(
    "SELECT id FROM users WHERE email=? LIMIT 1",
    [e],
  );
  if (!users.length) return { ok: false, message: "Không hợp lệ" };

  const userId = users[0].id;

  const [rs] = await pool.query(
    `SELECT id
       FROM password_resets
      WHERE id=?
        AND user_id=?
        AND used_at IS NULL
        AND expires_at >= NOW()
      LIMIT 1`,
    [rid, userId],
  );

  if (!rs.length) {
    return { ok: false, message: "Phiên đặt lại mật khẩu không hợp lệ" };
  }

  const hash = await bcrypt.hash(np, 10);

  await pool.query("UPDATE users SET password=? WHERE id=?", [hash, userId]);
  await pool.query("UPDATE password_resets SET used_at = NOW() WHERE id=?", [
    rid,
  ]);

  return { ok: true };
}

module.exports = {
  requestPasswordResetOtp,
  verifyOtp,
  resetPassword,
};
