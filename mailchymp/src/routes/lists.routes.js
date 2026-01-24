const router = require("express").Router();
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

router.post("/api/lists", requireAuth, async (req, res) => {
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

router.get("/api/lists", requireAuth, async (req, res) => {
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

router.post("/api/lists/:id/subscribers", requireAuth, async (req, res) => {
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

      // ✅ FIX: đếm added chuẩn theo affectedRows
      const [r] = await pool.query(
        "INSERT IGNORE INTO list_subscribers (list_id, subscriber_id) VALUES (?,?)",
        [listId, subId],
      );
      if (r.affectedRows > 0) added++;
    }

    res.json({ ok: true, added });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Add subscribers failed" });
  }
});

module.exports = router;
