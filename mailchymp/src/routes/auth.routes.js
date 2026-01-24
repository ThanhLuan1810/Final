const router = require("express").Router();
const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");

const { pool } = require("../config/db");
const { sha256, crypto } = require("../utils/crypto");

const googleIdClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ME
router.get("/api/auth/me", (req, res) => {
  res.json({ ok: true, user: req.session?.user || null });
});

// REGISTER
router.post("/api/auth/register", async (req, res) => {
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

// LOGIN (password)
router.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    const remember = !!req.body.remember;

    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu email hoặc mật khẩu" });
    }

    const [rows] = await pool.query(
      "SELECT id, email, name, password_hash FROM users WHERE email=? LIMIT 1",
      [email],
    );
    if (!rows.length) {
      return res
        .status(401)
        .json({ ok: false, message: "Sai email hoặc mật khẩu" });
    }

    const user = rows[0];
    if (!user.password_hash) {
      return res
        .status(401)
        .json({ ok: false, message: "Tài khoản này đăng nhập bằng Google" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ ok: false, message: "Sai email hoặc mật khẩu" });
    }

    req.session.user = { id: user.id, email: user.email, name: user.name };

    // remember-me
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
        secure: false, // prod: true (https)
        maxAge: days * 24 * 60 * 60 * 1000,
      });
    }

    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Login failed" });
  }
});

// LOGOUT
router.post("/api/auth/logout", async (req, res) => {
  try {
    const token = req.cookies?.remember_token;
    if (token) {
      await pool.query(
        "UPDATE remember_tokens SET revoked_at=NOW() WHERE token_hash=?",
        [sha256(token)],
      );
    }
    res.clearCookie("remember_token");
    req.session.destroy(() => res.json({ ok: true }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Logout failed" });
  }
});

// Google login (GIS)
router.post("/api/auth/google", async (req, res) => {
  try {
    const credential = String(req.body.credential || "");
    if (!credential)
      return res.status(400).json({ ok: false, message: "Missing credential" });

    const ticket = await googleIdClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
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

module.exports = router;
