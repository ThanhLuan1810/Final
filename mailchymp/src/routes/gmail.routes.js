const router = require("express").Router();
const { google } = require("googleapis");

const { pool } = require("../config/db");
const { crypto } = require("../utils/crypto");
const { requireAuth } = require("../middleware/auth");
const { getOAuthClient } = require("../services/gmail.service");

router.get("/api/gmail/status", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT email, refresh_token FROM gmail_accounts WHERE user_id=? LIMIT 1",
      [req.session.user.id],
    );
    if (!rows.length || !rows[0].refresh_token)
      return res.json({ ok: true, connected: false });
    res.json({ ok: true, connected: true, email: rows[0].email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Gmail status failed" });
  }
});

router.get("/api/gmail/connect", requireAuth, (req, res) => {
  const oAuth2Client = getOAuthClient();
  const scopes = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
  ];

  const state = crypto.randomBytes(16).toString("hex");
  req.session.gmail_oauth_state = state;

  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state,
  });

  res.redirect(url);
});

router.get("/api/gmail/oauth2callback", requireAuth, async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("Missing code");
    if (!state || state !== req.session.gmail_oauth_state)
      return res.status(400).send("Invalid state");

    const oAuth2Client = getOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oAuth2Client });
    const me = await oauth2.userinfo.get();
    const gmailEmail = me?.data?.email || null;

    if (!tokens.refresh_token) {
      return res
        .status(400)
        .send("No refresh_token returned. Please revoke and connect again.");
    }

    await pool.query(
      `INSERT INTO gmail_accounts (user_id, email, provider, refresh_token, created_at)
       VALUES (?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE
         email=VALUES(email),
         provider=VALUES(provider),
         refresh_token=VALUES(refresh_token),
         updated_at=NOW()`,
      [req.session.user.id, gmailEmail, "google", tokens.refresh_token],
    );

    // ✅ FIX: không hardcode host/port
    res.redirect("/public/eblast.html");
  } catch (e) {
    console.error(e);
    res.status(500).send("Gmail connect failed");
  }
});

router.post("/api/gmail/disconnect", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM gmail_accounts WHERE user_id=?", [
      req.session.user.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Disconnect failed" });
  }
});

module.exports = router;
