const router = require("express").Router();
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

router.get("/api/debug/db", requireAuth, async (req, res) => {
  const [db] = await pool.query("SELECT DATABASE() AS db");
  const [cols] = await pool.query("SHOW COLUMNS FROM campaign_sends");
  res.json({ db: db[0].db, cols });
});

module.exports = router;
