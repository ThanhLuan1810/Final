const { pool } = require("../config/db");
const { sha256 } = require("../utils/crypto");

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, message: "Chưa đăng nhập" });
  }
  next();
}

// Remember-me middleware
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

    if (rows.length) {
      req.session.user = {
        id: rows[0].id,
        email: rows[0].email,
        name: rows[0].name,
      };
    }
  } catch (e) {
    console.error("rememberMeMiddleware:", e);
  }
  next();
}

module.exports = { requireAuth, rememberMeMiddleware };
