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

module.exports = { getOAuthClient, getUserGmailAuth };
