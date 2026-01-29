const router = require("express").Router();
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { getUserGmailAuth } = require("../services/gmail.service");
const { sendCampaignToList } = require("../services/campaign.service");

const PORT = Number(process.env.PORT || 3000);

// ===== Helpers =====
function normStatus(s) {
  return String(s || "")
    .trim()
    .toUpperCase();
}

function pickCampaignFields(body) {
  return {
    title: String(body.title || "").trim(),
    subject: String(body.subject || "").trim(),
    from_name: String(body.from_name || "").trim(),
    reply_to: String(body.reply_to || "").trim() || null,
    html: String(body.html || ""),
  };
}

// List campaigns (used by Campaigns page)
router.get("/api/campaigns", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const status = normStatus(req.query.status);
    const search = String(req.query.search || "").trim();
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const where = ["c.user_id=?"];
    const params = [userId];

    if (status) {
      where.push("UPPER(c.status)=?");
      params.push(status);
    }
    if (search) {
      where.push(
        "(c.title LIKE ? OR c.subject LIKE ? OR c.from_email LIKE ? OR c.from_name LIKE ?)",
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const sql = `
      SELECT
        c.id, c.title, c.subject, c.from_name, c.from_email, c.reply_to,
        c.html, UPPER(c.status) AS status, c.list_id, c.scheduled_at, c.created_at, c.updated_at,
        MAX(cs.sent_at) AS sent_at
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

// Get campaign detail (used by Preview + Eblast load)
router.get("/api/campaigns/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT id, user_id, title, subject, from_name, from_email, reply_to, html, UPPER(status) AS status, list_id, scheduled_at, created_at, updated_at
       FROM campaigns
       WHERE id=? AND user_id=?
       LIMIT 1`,
      [id, userId],
    );
    if (!rows.length)
      return res.status(404).json({ ok: false, message: "Not found" });
    res.json({ ok: true, campaign: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Failed to load campaign" });
  }
});

// Update campaign (DRAFT/SCHEDULED only)
router.put("/api/campaigns/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const id = Number(req.params.id);

    const [rows] = await pool.query(
      `SELECT id, status FROM campaigns WHERE id=? AND user_id=? LIMIT 1`,
      [id, userId],
    );
    if (!rows.length)
      return res.status(404).json({ ok: false, message: "Not found" });

    const st = normStatus(rows[0].status);
    if (st === "SENT" || st === "SENDING") {
      return res.status(400).json({
        ok: false,
        message: "Campaign đã gửi/đang gửi nên không sửa được.",
      });
    }

    const p = pickCampaignFields(req.body || {});
    if (!p.title || !p.subject || !p.from_name || !p.html.trim()) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu fields (title/subject/from/html)",
      });
    }

    // Optional: allow update list_id & scheduled_at if provided
    const list_id = req.body.list_id ? Number(req.body.list_id) : null;
    const scheduled_at = req.body.scheduled_at
      ? new Date(String(req.body.scheduled_at))
      : null;
    const hasScheduleUpdate = Boolean(req.body.scheduled_at);

    if (hasScheduleUpdate && isNaN(scheduled_at.getTime())) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid scheduled_at" });
    }

    // if schedule update requested, validate list exists
    if (hasScheduleUpdate) {
      if (!list_id) {
        return res.status(400).json({ ok: false, message: "Missing list_id" });
      }
      const [lRows] = await pool.query(
        `SELECT id FROM lists WHERE id=? AND user_id=? LIMIT 1`,
        [list_id, userId],
      );
      if (!lRows.length)
        return res.status(404).json({ ok: false, message: "List not found" });
    }

    if (hasScheduleUpdate && scheduled_at) {
      if (scheduled_at.getTime() < Date.now() + 15 * 1000) {
        return res
          .status(400)
          .json({ ok: false, message: "Schedule must be in the future" });
      }
      await pool.query(
        `UPDATE campaigns
         SET title=?, subject=?, from_name=?, reply_to=?, html=?,
             status='SCHEDULED', scheduled_at=?, list_id=?, updated_at=NOW()
         WHERE id=? AND user_id=?`,
        [
          p.title,
          p.subject,
          p.from_name,
          p.reply_to,
          p.html,
          scheduled_at,
          list_id,
          id,
          userId,
        ],
      );
    } else {
      await pool.query(
        `UPDATE campaigns
         SET title=?, subject=?, from_name=?, reply_to=?, html=?,
             updated_at=NOW()
         WHERE id=? AND user_id=?`,
        [p.title, p.subject, p.from_name, p.reply_to, p.html, id, userId],
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Update failed" });
  }
});

// Duplicate campaign (primarily for SENT)
router.post("/api/campaigns/:id/duplicate", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT title, subject, from_name, from_email, reply_to, html
       FROM campaigns WHERE id=? AND user_id=? LIMIT 1`,
      [id, userId],
    );
    if (!rows.length)
      return res.status(404).json({ ok: false, message: "Not found" });
    const c = rows[0];

    const [ins] = await pool.query(
      `INSERT INTO campaigns (user_id, title, subject, from_name, from_email, reply_to, html, status, scheduled_at, list_id)
       VALUES (?,?,?,?,?,?,?,'DRAFT',NULL,NULL)`,
      [
        userId,
        c.title,
        c.subject,
        c.from_name,
        c.from_email,
        c.reply_to,
        c.html,
      ],
    );

    res.json({ ok: true, new_campaign_id: ins.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Duplicate failed" });
  }
});

// Delete campaign (SENT/DRAFT/SCHEDULED đều xóa được)
router.delete("/api/campaigns/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const id = Number(req.params.id);

    await pool.query(`DELETE FROM campaign_sends WHERE campaign_id=?`, [id]);
    const [del] = await pool.query(
      `DELETE FROM campaigns WHERE id=? AND user_id=?`,
      [id, userId],
    );
    if (!del.affectedRows)
      return res.status(404).json({ ok: false, message: "Not found" });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Delete failed" });
  }
});

// Cancel scheduled (turn into DRAFT)
router.post("/api/campaigns/:id/cancel", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const id = Number(req.params.id);

    const [u] = await pool.query(
      `UPDATE campaigns
       SET status='DRAFT', scheduled_at=NULL, list_id=NULL, updated_at=NOW()
       WHERE id=? AND user_id=? AND UPPER(status)='SCHEDULED'`,
      [id, userId],
    );

    if (u.affectedRows === 0) {
      return res.status(400).json({
        ok: false,
        message: "Only SCHEDULED campaigns can be cancelled (or not found).",
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Cancel failed" });
  }
});

// Create campaign
router.post("/api/campaigns", requireAuth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const subject = String(req.body.subject || "").trim();
    const from_name = String(req.body.from_name || "").trim();
    const reply_to = String(req.body.reply_to || "").trim() || null;
    const html = String(req.body.html || "");

    if (!title || !subject || !from_name || !html.trim()) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu fields (title/subject/from/html)",
      });
    }

    const auth = await getUserGmailAuth(req.session.user.id);
    if (!auth)
      return res
        .status(400)
        .json({ ok: false, message: "Gmail not connected" });

    const from_email = auth.gmailEmail;

    const [ins] = await pool.query(
      `INSERT INTO campaigns (user_id, title, subject, from_name, from_email, reply_to, html, status)
       VALUES (?,?,?,?,?,?,?, 'DRAFT')`,
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

// Send now
router.post("/api/campaigns/send", requireAuth, async (req, res) => {
  try {
    const campaign_id = Number(req.body.campaign_id);
    const list_id = Number(req.body.list_id);

    if (!campaign_id || !list_id) {
      return res
        .status(400)
        .json({ ok: false, message: "Missing campaign_id or list_id" });
    }

    await pool.query(
      `UPDATE campaigns SET status='SENDING' WHERE id=? AND user_id=?`,
      [campaign_id, req.session.user.id],
    );

    const result = await sendCampaignToList({
      campaign_id,
      list_id,
      user_id: req.session.user.id,
      port: PORT,
    });

    res.json({ ok: true, sent: result.sent, failed: result.failed });
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

// Schedule
router.post("/api/campaigns/schedule", requireAuth, async (req, res) => {
  try {
    const campaign_id = Number(req.body.campaign_id);
    const list_id = Number(req.body.list_id);
    const scheduled_at = String(req.body.scheduled_at || "").trim();

    if (!campaign_id || !list_id || !scheduled_at) {
      return res.status(400).json({
        ok: false,
        message: "Missing campaign_id/list_id/scheduled_at",
      });
    }

    const when = new Date(scheduled_at);
    if (isNaN(when.getTime())) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid scheduled_at" });
    }

    if (when.getTime() < Date.now() + 15 * 1000) {
      return res
        .status(400)
        .json({ ok: false, message: "Schedule must be in the future" });
    }

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
       SET status='SCHEDULED', scheduled_at=?, list_id=?
       WHERE id=? AND user_id=?`,
      [when, list_id, campaign_id, req.session.user.id],
    );

    res.json({ ok: true, message: "Scheduled." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Schedule failed" });
  }
});

module.exports = router;
