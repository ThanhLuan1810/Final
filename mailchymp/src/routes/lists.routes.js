const router = require("express").Router();
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

// Helpers
const normEmail = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();
const isEmail = (s) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

// Ownership check: list must belong to current user
async function ensureListOwned(listId, userId) {
  const [[row]] = await pool.query(
    `SELECT id, name
     FROM lists
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [listId, userId],
  );
  return row || null;
}

/**
 * GET /api/lists
 * Return lists of current user with member counts
 */
router.get("/lists", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [rows] = await pool.query(
      `SELECT l.id, l.name, l.created_at,
              COUNT(ls.subscriber_id) AS total
       FROM lists l
       LEFT JOIN list_subscribers ls ON ls.list_id = l.id
       WHERE l.user_id = ?
       GROUP BY l.id
       ORDER BY l.created_at DESC`,
      [userId],
    );

    res.json({ ok: true, lists: rows });
  } catch (err) {
    console.error("GET /api/lists error:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/lists
 * Create empty list
 * body: { name }
 */
router.post("/lists", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const name = String(req.body?.name || "").trim();

    if (!name) {
      return res
        .status(400)
        .json({ ok: false, message: "List name is required" });
    }

    const [ins] = await pool.query(
      `INSERT INTO lists (user_id, name) VALUES (?, ?)`,
      [userId, name],
    );

    res.json({ ok: true, list: { id: ins.insertId, name } });
  } catch (err) {
    console.error("POST /api/lists error:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/lists/:id/members
 * Get members in list
 */
router.get("/lists/:id/members", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const listId = Number(req.params.id);

    const list = await ensureListOwned(listId, userId);
    if (!list)
      return res.status(404).json({ ok: false, message: "List not found" });

    const [rows] = await pool.query(
      `SELECT s.id AS subscriber_id, s.email, s.name, s.status, s.created_at
       FROM list_subscribers ls
       JOIN subscribers s ON s.id = ls.subscriber_id
       WHERE ls.list_id = ?
       ORDER BY s.email ASC`,
      [listId],
    );

    res.json({ ok: true, members: rows });
  } catch (err) {
    console.error("GET /api/lists/:id/members error:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/lists/:id/members
 * Add email to list (find or create subscriber)
 * body: { email, name? }
 */
router.post("/lists/:id/members", requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.session.user.id;
    const listId = Number(req.params.id);

    const email = normEmail(req.body?.email);
    const name = req.body?.name == null ? null : String(req.body.name).trim();

    if (!isEmail(email)) {
      conn.release();
      return res.status(400).json({ ok: false, message: "Invalid email" });
    }

    const list = await ensureListOwned(listId, userId);
    if (!list) {
      conn.release();
      return res.status(404).json({ ok: false, message: "List not found" });
    }

    await conn.beginTransaction();

    // Find subscriber by email
    const [[found]] = await conn.query(
      `SELECT id FROM subscribers WHERE email = ? LIMIT 1`,
      [email],
    );

    let subscriberId;
    if (found) {
      subscriberId = found.id;
      // optional: set name if subscriber name is null
      if (name) {
        await conn.query(
          `UPDATE subscribers
           SET name = COALESCE(name, ?), updated_at = NOW()
           WHERE id = ?`,
          [name, subscriberId],
        );
      }
    } else {
      const [ins] = await conn.query(
        `INSERT INTO subscribers (email, name) VALUES (?, ?)`,
        [email, name],
      );
      subscriberId = ins.insertId;
    }

    // Link to list (PK(list_id, subscriber_id) prevents duplicates)
    await conn.query(
      `INSERT IGNORE INTO list_subscribers (list_id, subscriber_id)
       VALUES (?, ?)`,
      [listId, subscriberId],
    );

    await conn.commit();
    conn.release();

    res.json({ ok: true });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {}
    conn.release();

    // Unique email conflict (if uq_subscribers_email exists)
    if (err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062)) {
      // Normalize: if duplicate happens, treat as ok
      return res.json({ ok: true });
    }

    console.error("POST /api/lists/:id/members error:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * PUT /api/lists/:id/members/:subscriberId
 * Edit subscriber email (GLOBAL) but only allowed if that subscriber is in this list
 * body: { email, name? }
 */
router.put(
  "/lists/:id/members/:subscriberId",
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.session.user.id;
      const listId = Number(req.params.id);
      const subscriberId = Number(req.params.subscriberId);

      const email = normEmail(req.body?.email);
      const name = req.body?.name == null ? null : String(req.body.name).trim();

      if (!isEmail(email)) {
        return res.status(400).json({ ok: false, message: "Invalid email" });
      }

      const list = await ensureListOwned(listId, userId);
      if (!list)
        return res.status(404).json({ ok: false, message: "List not found" });

      const [[link]] = await pool.query(
        `SELECT 1
       FROM list_subscribers
       WHERE list_id = ? AND subscriber_id = ?
       LIMIT 1`,
        [listId, subscriberId],
      );
      if (!link)
        return res.status(404).json({ ok: false, message: "Member not found" });

      await pool.query(
        `UPDATE subscribers
       SET email = ?, name = COALESCE(?, name), updated_at = NOW()
       WHERE id = ?`,
        [email, name, subscriberId],
      );

      res.json({ ok: true });
    } catch (err) {
      if (err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062)) {
        return res
          .status(409)
          .json({ ok: false, message: "Email already exists" });
      }
      console.error("PUT /api/lists/:id/members/:subscriberId error:", err);
      res.status(500).json({ ok: false, message: "Server error" });
    }
  },
);

/**
 * DELETE /api/lists/:id/members/:subscriberId
 * Remove subscriber from list (mapping only)
 */
router.delete(
  "/lists/:id/members/:subscriberId",
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.session.user.id;
      const listId = Number(req.params.id);
      const subscriberId = Number(req.params.subscriberId);

      const list = await ensureListOwned(listId, userId);
      if (!list)
        return res.status(404).json({ ok: false, message: "List not found" });

      const [del] = await pool.query(
        `DELETE FROM list_subscribers
       WHERE list_id = ? AND subscriber_id = ?`,
        [listId, subscriberId],
      );

      res.json({ ok: true, affected: del.affectedRows });
    } catch (err) {
      console.error("DELETE /api/lists/:id/members/:subscriberId error:", err);
      res.status(500).json({ ok: false, message: "Server error" });
    }
  },
);

module.exports = router;
