const router = require("express").Router();
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

router.get("/api/dashboard/campaigns", requireAuth, async (req, res) => {
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
        c.scheduled_at, c.created_at, c.updated_at,

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

router.get("/api/dashboard/campaigns/:id", requireAuth, async (req, res) => {
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
      `SELECT id, to_email AS email, status, error_text AS error, sent_at, created_at,
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

module.exports = router;
