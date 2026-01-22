require("dotenv").config();

const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const { OAuth2Client } = require("google-auth-library");
const { google } = require("googleapis");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "doan_mail",
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
});

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || "";

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET ||
  process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
  "";

const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  process.env.GOOGLE_OAUTH_REDIRECT ||
  process.env.GOOGLE_OAUTH_REDIRECT_URI ||
  "";

const googleIdClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 2,
    },
  }),
);

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
function requireAuth(req, res, next) {
  if (!req.session?.user)
    return res.status(401).json({ ok: false, message: "Chưa đăng nhập" });
  next();
}

// ===== Remember-me middleware =====
async function rememberMeMiddleware(req, res, next) {
  try {
    if (req.session?.user) return next();
    const token = req.cookies?.remember_token;
    if (!token) return next();

    const token_hash = sha256(token);
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.name
       FROM remember_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash=? AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
       LIMIT 1`,
      [token_hash],
    );

    if (rows.length)
      req.session.user = {
        id: rows[0].id,
        email: rows[0].email,
        name: rows[0].name,
      };
  } catch (e) {
    console.error("rememberMeMiddleware:", e);
  }
  next();
}
app.use(rememberMeMiddleware);

// ===== Static =====
app.use("/public", express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.redirect("/public/compose.html"));

// ===== Config for frontend =====
app.get("/api/config", (req, res) => {
  res.json({ ok: true, google_client_id: GOOGLE_CLIENT_ID || "" });
});

// ===================== AUTH =====================
app.get("/api/auth/me", (req, res) =>
  res.json({ ok: true, user: req.session?.user || null }),
);

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");

    if (!email || password.length < 6) {
      return res.status(400).json({
        ok: false,
        message: "Email hoặc mật khẩu không hợp lệ (>=6 ký tự)",
      });
    }

    const [exists] = await pool.query(
      "SELECT id FROM users WHERE email=? LIMIT 1",
      [email],
    );
    if (exists.length)
      return res.status(409).json({ ok: false, message: "Email đã tồn tại" });

    const password_hash = await bcrypt.hash(password, 10);

    const [ins] = await pool.query(
      "INSERT INTO users (email, name, password_hash, created_at) VALUES (?,?,?,NOW())",
      [email, name || null, password_hash],
    );

    req.session.user = { id: ins.insertId, email, name: name || null };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Register failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    const remember = !!req.body.remember;

    if (!email || !password)
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu email hoặc mật khẩu" });

    const [rows] = await pool.query(
      "SELECT id, email, name, password_hash FROM users WHERE email=? LIMIT 1",
      [email],
    );
    if (!rows.length)
      return res
        .status(401)
        .json({ ok: false, message: "Sai email hoặc mật khẩu" });

    const user = rows[0];
    if (!user.password_hash)
      return res
        .status(401)
        .json({ ok: false, message: "Tài khoản này đăng nhập bằng Google" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok)
      return res
        .status(401)
        .json({ ok: false, message: "Sai email hoặc mật khẩu" });

    req.session.user = { id: user.id, email: user.email, name: user.name };

    if (remember) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const token_hash = sha256(rawToken);
      const days = 30;

      await pool.query(
        "INSERT INTO remember_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))",
        [user.id, token_hash, days],
      );

      res.cookie("remember_token", rawToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: days * 24 * 60 * 60 * 1000,
      });
    }

    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Login failed" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = req.cookies?.remember_token;
    if (token)
      await pool.query(
        "UPDATE remember_tokens SET revoked_at=NOW() WHERE token_hash=?",
        [sha256(token)],
      );
    res.clearCookie("remember_token");
    req.session.destroy(() => res.json({ ok: true }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Logout failed" });
  }
});

// Google login (GIS)
app.post("/api/auth/google", async (req, res) => {
  try {
    const credential = String(req.body.credential || "");
    if (!credential)
      return res.status(400).json({ ok: false, message: "Missing credential" });

    const ticket = await googleIdClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = String(payload.email || "").toLowerCase();
    const name = String(payload.name || payload.given_name || "").trim();

    if (!email)
      return res.status(400).json({ ok: false, message: "No email in token" });

    const [rows] = await pool.query(
      "SELECT id, email, name FROM users WHERE email=? LIMIT 1",
      [email],
    );

    let user;
    if (rows.length) user = rows[0];
    else {
      const [ins] = await pool.query(
        "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, NULL, NOW())",
        [email, name || null],
      );
      user = { id: ins.insertId, email, name: name || null };
    }

    req.session.user = { id: user.id, email: user.email, name: user.name };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error(e);
    res.status(401).json({ ok: false, message: "Google token invalid" });
  }
});

// ===================== GMAIL CONNECT =====================
function getOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
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

app.get("/api/gmail/status", requireAuth, async (req, res) => {
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

app.get("/api/gmail/connect", requireAuth, (req, res) => {
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

// NOTE: route name must match redirect in Google console
app.get("/api/gmail/oauth/callback", requireAuth, async (req, res) => {
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

    res.redirect("http://127.0.0.1:3000/public/eblast.html");
  } catch (e) {
    console.error(e);
    res.status(500).send("Gmail connect failed");
  }
});

app.post("/api/gmail/disconnect", requireAuth, async (req, res) => {
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

// ===================== LISTS + SUBSCRIBERS =====================
app.post("/api/lists", requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name)
      return res.status(400).json({ ok: false, message: "Missing list name" });

    const [ins] = await pool.query(
      "INSERT INTO lists (user_id, name) VALUES (?,?)",
      [req.session.user.id, name],
    );
    res.json({ ok: true, id: ins.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Create list failed" });
  }
});

app.get("/api/lists", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.id, l.name, COUNT(ls.subscriber_id) AS count
       FROM lists l
       LEFT JOIN list_subscribers ls ON l.id = ls.list_id
       WHERE l.user_id=?
       GROUP BY l.id
       ORDER BY l.created_at DESC`,
      [req.session.user.id],
    );
    res.json({ ok: true, lists: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Load lists failed" });
  }
});

app.post("/api/lists/:id/subscribers", requireAuth, async (req, res) => {
  try {
    const listId = Number(req.params.id);
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];
    if (!listId)
      return res.status(400).json({ ok: false, message: "Invalid list id" });
    if (!emails.length)
      return res.status(400).json({ ok: false, message: "No emails" });

    const [lRows] = await pool.query(
      "SELECT id FROM lists WHERE id=? AND user_id=? LIMIT 1",
      [listId, req.session.user.id],
    );
    if (!lRows.length)
      return res.status(404).json({ ok: false, message: "List not found" });

    let added = 0;
    for (const e of emails) {
      const email = String(e || "")
        .trim()
        .toLowerCase();
      if (!email || !email.includes("@")) continue;

      let subId;
      const [sRows] = await pool.query(
        "SELECT id FROM subscribers WHERE email=? LIMIT 1",
        [email],
      );
      if (sRows.length) subId = sRows[0].id;
      else {
        const [ins] = await pool.query(
          "INSERT INTO subscribers (email) VALUES (?)",
          [email],
        );
        subId = ins.insertId;
      }

      await pool.query(
        "INSERT IGNORE INTO list_subscribers (list_id, subscriber_id) VALUES (?,?)",
        [listId, subId],
      );
      added++;
    }

    res.json({ ok: true, added });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Add subscribers failed" });
  }
});

// ===================== TRACKING HELPERS =====================
function makeToken32() {
  return crypto.randomBytes(16).toString("hex"); // 32 chars hex
}

function injectOpenPixel(html, token) {
  const pixel = `<img src="http://127.0.0.1:${PORT}/t/o/${token}.gif" width="1" height="1" style="display:none" alt="">`;
  if (/<\/body>/i.test(html))
    return html.replace(/<\/body>/i, pixel + "</body>");
  return html + pixel;
}

function rewriteLinksForClick(html, token) {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (m, url) => {
    const encoded = encodeURIComponent(url);
    return `href="http://127.0.0.1:${PORT}/t/c/${token}?url=${encoded}"`;
  });
}

function injectTracking(html, token) {
  let out = html;
  out = rewriteLinksForClick(out, token);
  out = injectOpenPixel(out, token);
  return out;
}

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

// 1x1 gif
const GIF_1x1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

// Open pixel
app.get("/t/o/:token.gif", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (token) {
      await pool.query(
        `UPDATE campaign_sends
         SET open_count=open_count+1,
             opened_at=COALESCE(opened_at, NOW())
         WHERE tracking_token=?
         LIMIT 1`,
        [token],
      );
    }
  } catch {}
  res.setHeader("Content-Type", "image/gif");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.end(GIF_1x1);
});

// Click redirect
app.get("/t/c/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    const url = String(req.query.url || "");
    if (!token || !url) return res.status(400).send("Bad request");

    const decoded = decodeURIComponent(url);

    await pool.query(
      `UPDATE campaign_sends
       SET click_count=click_count+1,
           last_clicked_at=NOW()
       WHERE tracking_token=?
       LIMIT 1`,
      [token],
    );

    if (!/^https?:\/\//i.test(decoded))
      return res.status(400).send("Invalid URL");
    res.redirect(decoded);
  } catch {
    res.status(400).send("Tracking error");
  }
});

// ===================== CAMPAIGNS =====================
app.post("/api/campaigns", requireAuth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const subject = String(req.body.subject || "").trim();
    const from_name = String(req.body.from_name || "").trim();
    const reply_to = String(req.body.reply_to || "").trim() || null;
    const html = String(req.body.html || "");

    if (!title || !subject || !from_name || !html.trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu fields (title/subject/from/html)" });
    }

    const auth = await getUserGmailAuth(req.session.user.id);
    if (!auth)
      return res
        .status(400)
        .json({ ok: false, message: "Gmail not connected" });

    const from_email = auth.gmailEmail;

    const [ins] = await pool.query(
      `INSERT INTO campaigns (user_id, title, subject, from_name, from_email, reply_to, html, status, created_at)
       VALUES (?,?,?,?,?,?,?, 'DRAFT', NOW())`,
      [
        req.session.user.id,
        title,
        subject,
        from_name,
        from_email,
        reply_to,
        html,
      ],
    );

    res.json({ ok: true, campaign_id: ins.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Create campaign failed" });
  }
});

async function sendCampaignToList({ userId, campaignId, listId }) {
  const [cRows] = await pool.query(
    `SELECT id, subject, html, from_name, from_email, reply_to
     FROM campaigns WHERE id=? AND user_id=? LIMIT 1`,
    [campaignId, userId],
  );
  if (!cRows.length) throw new Error("Campaign not found");
  const camp = cRows[0];

  const [lRows] = await pool.query(
    "SELECT id FROM lists WHERE id=? AND user_id=? LIMIT 1",
    [listId, userId],
  );
  if (!lRows.length) throw new Error("List not found");

  const [subs] = await pool.query(
    `SELECT s.id AS subscriber_id, s.email
     FROM subscribers s
     JOIN list_subscribers ls ON ls.subscriber_id=s.id
     WHERE ls.list_id=?`,
    [listId],
  );
  if (!subs.length) throw new Error("List is empty");

  const auth = await getUserGmailAuth(userId);
  if (!auth) throw new Error("Gmail not connected");

  const gmail = google.gmail({ version: "v1", auth: auth.oAuth2Client });

  await pool.query(
    `UPDATE campaigns SET status='SENDING' WHERE id=? AND user_id=?`,
    [campaignId, userId],
  );

  let sent = 0,
    failed = 0;

  for (const s of subs) {
    const token = makeToken32();

    // IMPORTANT: schema của Luân: to_email NOT NULL, status enum queued/sent/failed, error_text
    const [logIns] = await pool.query(
      `INSERT INTO campaign_sends
       (campaign_id, subscriber_id, email, to_email, status, tracking_token, created_at)
       VALUES (?,?,?,?,?,?, NOW())`,
      [campaignId, s.subscriber_id, s.email, s.email, "queued", token],
    );

    try {
      const trackedHtml = injectTracking(camp.html, token);

      const raw = buildRawEmail({
        to: s.email,
        subject: camp.subject,
        html: trackedHtml,
        from: `${camp.from_name} <${auth.gmailEmail}>`,
        replyTo: camp.reply_to || undefined,
      });

      const r = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
      const msgId = r?.data?.id || null;

      await pool.query(
        `UPDATE campaign_sends
         SET status='sent', sent_at=NOW(), error_text=NULL, gmail_message_id=?
         WHERE id=?`,
        [msgId, logIns.insertId],
      );

      sent++;
    } catch (e) {
      failed++;
      await pool.query(
        `UPDATE campaign_sends
         SET status='failed', error_text=?
         WHERE id=?`,
        [String(e?.message || e), logIns.insertId],
      );
    }
  }

  const finalStatus = failed > 0 ? "FAILED" : "SENT";
  await pool.query(
    `UPDATE campaigns SET status=?, scheduled_at=NULL, scheduled_list_id=NULL WHERE id=? AND user_id=?`,
    [finalStatus, campaignId, userId],
  );

  return { sent, failed };
}

// Send now by list
app.post("/api/campaigns/send", requireAuth, async (req, res) => {
  try {
    const campaign_id = Number(req.body.campaign_id);
    const list_id = Number(req.body.list_id);
    if (!campaign_id || !list_id)
      return res
        .status(400)
        .json({ ok: false, message: "Missing campaign_id or list_id" });

    const out = await sendCampaignToList({
      userId: req.session.user.id,
      campaignId: campaign_id,
      listId: list_id,
    });

    res.json({ ok: true, ...out });
  } catch (e) {
    console.error("SEND ERROR >>>", e);
    res.status(500).json({
      ok: false,
      message: e?.message || "Send failed",
      stack: String(e?.stack || "")
        .split("\n")
        .slice(0, 8)
        .join("\n"),
    });
  }
});

// ===== SCHEDULE APIs =====
app.post("/api/campaigns/schedule", requireAuth, async (req, res) => {
  try {
    const campaign_id = Number(req.body.campaign_id);
    const list_id = Number(req.body.list_id);
    const scheduled_at = String(req.body.scheduled_at || "").trim(); // ISO string from browser

    if (!campaign_id || !list_id || !scheduled_at)
      return res
        .status(400)
        .json({
          ok: false,
          message: "Missing campaign_id/list_id/scheduled_at",
        });

    // Validate date
    const dt = new Date(scheduled_at);
    if (isNaN(dt.getTime()))
      return res
        .status(400)
        .json({ ok: false, message: "Invalid scheduled_at" });

    // must be in future (allow small grace)
    if (dt.getTime() < Date.now() - 5000)
      return res
        .status(400)
        .json({ ok: false, message: "Scheduled time must be in the future" });

    // ensure ownership
    const [cRows] = await pool.query(
      `SELECT id FROM campaigns WHERE id=? AND user_id=? LIMIT 1`,
      [campaign_id, req.session.user.id],
    );
    if (!cRows.length)
      return res.status(404).json({ ok: false, message: "Campaign not found" });

    const [lRows] = await pool.query(
      `SELECT id FROM lists WHERE id=? AND user_id=? LIMIT 1`,
      [list_id, req.session.user.id],
    );
    if (!lRows.length)
      return res.status(404).json({ ok: false, message: "List not found" });

    await pool.query(
      `UPDATE campaigns
       SET status='SCHEDULED', scheduled_at=?, scheduled_list_id=?
       WHERE id=? AND user_id=?`,
      [dt, list_id, campaign_id, req.session.user.id],
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Schedule failed" });
  }
});

app.post("/api/campaigns/cancel", requireAuth, async (req, res) => {
  try {
    const campaign_id = Number(req.body.campaign_id);
    if (!campaign_id)
      return res
        .status(400)
        .json({ ok: false, message: "Missing campaign_id" });

    await pool.query(
      `UPDATE campaigns
       SET status='CANCELLED', scheduled_at=NULL, scheduled_list_id=NULL
       WHERE id=? AND user_id=? AND status='SCHEDULED'`,
      [campaign_id, req.session.user.id],
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Cancel failed" });
  }
});

// ===================== DASHBOARD APIs =====================
app.get("/api/dashboard/campaigns", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const status = String(req.query.status || "")
      .trim()
      .toUpperCase();
    const search = String(req.query.search || "").trim();
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const where = ["c.user_id=?"];
    const params = [userId];

    if (status) {
      where.push("c.status=?");
      params.push(status);
    }
    if (search) {
      where.push("(c.title LIKE ? OR c.subject LIKE ? OR c.from_email LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const sql = `
      SELECT
        c.id, c.title, c.subject, c.from_name, c.from_email, c.status,
        c.scheduled_at, c.scheduled_list_id, c.created_at, c.updated_at,
        COALESCE(SUM(CASE WHEN cs.status='sent' THEN 1 ELSE 0 END),0) AS sent_count,
        COALESCE(SUM(CASE WHEN cs.status='failed' THEN 1 ELSE 0 END),0) AS failed_count,
        COALESCE(SUM(CASE WHEN cs.open_count > 0 THEN 1 ELSE 0 END),0) AS opened_unique,
        COALESCE(SUM(cs.open_count),0) AS total_opens,
        COALESCE(SUM(CASE WHEN cs.click_count > 0 THEN 1 ELSE 0 END),0) AS clicked_unique,
        COALESCE(SUM(cs.click_count),0) AS total_clicks
      FROM campaigns c
      LEFT JOIN campaign_sends cs ON cs.campaign_id = c.id
      WHERE ${where.join(" AND ")}
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(sql, [...params, limit, offset]);
    res.json({ ok: true, campaigns: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Failed to load campaigns" });
  }
});

app.get("/api/dashboard/campaigns/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const id = Number(req.params.id);

    const [cRows] = await pool.query(
      "SELECT * FROM campaigns WHERE id=? AND user_id=? LIMIT 1",
      [id, userId],
    );
    if (!cRows.length)
      return res.status(404).json({ ok: false, message: "Not found" });

    const [sRows] = await pool.query(
      `SELECT id,
              COALESCE(to_email, email) AS email,
              status,
              error_text,
              sent_at, created_at,
              open_count, opened_at, click_count, last_clicked_at
       FROM campaign_sends
       WHERE campaign_id=?
       ORDER BY created_at DESC
       LIMIT 500`,
      [id],
    );

    const [sumRows] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END),0) AS sent,
         COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed,
         COALESCE(SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END),0) AS opened_unique,
         COALESCE(SUM(open_count),0) AS total_opens,
         COALESCE(SUM(CASE WHEN click_count > 0 THEN 1 ELSE 0 END),0) AS clicked_unique,
         COALESCE(SUM(click_count),0) AS total_clicks,
         COUNT(*) AS total
       FROM campaign_sends
       WHERE campaign_id=?`,
      [id],
    );

    res.json({
      ok: true,
      campaign: cRows[0],
      logs: sRows,
      summary: sumRows[0],
    });
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ ok: false, message: "Failed to load campaign detail" });
  }
});

// ===================== SCHEDULE WORKER =====================
// chạy mỗi 15s: gom campaign tới giờ, "claim" bằng update sang SENDING rồi gửi
async function scheduleTick() {
  try {
    const [due] = await pool.query(
      `SELECT id, user_id, scheduled_list_id
       FROM campaigns
       WHERE status='SCHEDULED'
         AND scheduled_at IS NOT NULL
         AND scheduled_at <= NOW()
         AND scheduled_list_id IS NOT NULL
       ORDER BY scheduled_at ASC
       LIMIT 3`,
    );

    for (const c of due) {
      // claim to avoid double-send
      const [up] = await pool.query(
        `UPDATE campaigns
         SET status='SENDING'
         WHERE id=? AND status='SCHEDULED'`,
        [c.id],
      );
      if (!up.affectedRows) continue;

      try {
        await sendCampaignToList({
          userId: c.user_id,
          campaignId: c.id,
          listId: c.scheduled_list_id,
        });
      } catch (e) {
        console.error("Scheduled send failed:", c.id, e?.message || e);
        await pool.query(`UPDATE campaigns SET status='FAILED' WHERE id=?`, [
          c.id,
        ]);
      }
    }
  } catch (e) {
    console.error("scheduleTick:", e?.message || e);
  }
}
setInterval(scheduleTick, 15000);

app.listen(PORT, () =>
  console.log("Server running:", `http://127.0.0.1:${PORT}`),
);

// debug
app.get("/api/debug/db", async (req, res) => {
  const [db] = await pool.query("SELECT DATABASE() AS db");
  const [cols] = await pool.query("SHOW COLUMNS FROM campaign_sends");
  res.json({ db: db[0].db, cols });
});
