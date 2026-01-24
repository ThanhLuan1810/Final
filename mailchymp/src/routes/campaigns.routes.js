const router = require("express").Router();
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { getUserGmailAuth } = require("../services/gmail.service");
const { sendCampaignToList } = require("../services/campaign.service");

const PORT = Number(process.env.PORT || 3000);

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

// Cancel scheduled
router.post("/api/campaigns/cancel", requireAuth, async (req, res) => {
  try {
    const campaign_id = Number(req.body.campaign_id);
    if (!campaign_id)
      return res
        .status(400)
        .json({ ok: false, message: "Missing campaign_id" });

    const [u] = await pool.query(
      `UPDATE campaigns
       SET status='CANCELLED', scheduled_at=NULL
       WHERE id=? AND user_id=? AND status='SCHEDULED'`,
      [campaign_id, req.session.user.id],
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

module.exports = router;
