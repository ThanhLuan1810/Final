const { google } = require("googleapis");
const { pool } = require("../config/db");

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

async function getUserGmailAuth(userId) {
  const [rows] = await pool.query(
    "SELECT email, refresh_token FROM gmail_accounts WHERE user_id=? LIMIT 1",
    [userId],
  );
  if (!rows.length || !rows[0].refresh_token) return null;

  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({ refresh_token: rows[0].refresh_token });

  return { oAuth2Client, gmailEmail: rows[0].email };
}

/**
 * System Gmail: dùng để gửi OTP/notification cho các user chưa connect Gmail.
 * Ưu tiên env GMAIL_SYSTEM_USER_ID, nếu không có thì lấy account đầu tiên có refresh_token.
 */
async function getSystemGmailAuth() {
  const sysId = Number(process.env.GMAIL_SYSTEM_USER_ID || 0);

  if (sysId > 0) {
    const auth = await getUserGmailAuth(sysId);
    if (auth) return auth;
  }

  const [rows] = await pool.query(
    "SELECT email, refresh_token FROM gmail_accounts WHERE refresh_token IS NOT NULL AND refresh_token<>'' ORDER BY id ASC LIMIT 1",
  );
  if (!rows.length) return null;

  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({ refresh_token: rows[0].refresh_token });

  return { oAuth2Client, gmailEmail: rows[0].email };
}

module.exports = { getOAuthClient, getUserGmailAuth, getSystemGmailAuth };
