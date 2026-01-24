const router = require("express").Router();
const { pool } = require("../config/db");
const { validateRedirectUrl } = require("../services/tracking.service");

// 1x1 gif
const GIF_1x1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

// Open pixel
router.get("/t/o/:token.gif", async (req, res) => {
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
router.get("/t/c/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  const raw = String(req.query.url || "");
  if (!token || !raw) return res.status(400).send("Bad request");

  const safeUrl = validateRedirectUrl(raw);
  if (!safeUrl) return res.status(400).send("Invalid URL");

  try {
    await pool.query(
      `UPDATE campaign_sends
       SET click_count=click_count+1,
           last_clicked_at=NOW()
       WHERE tracking_token=?
       LIMIT 1`,
      [token],
    );
  } catch {}

  res.redirect(safeUrl);
});

module.exports = router;
