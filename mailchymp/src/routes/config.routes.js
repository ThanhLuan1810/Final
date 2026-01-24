const router = require("express").Router();

router.get("/api/config", (req, res) => {
  res.json({ ok: true, google_client_id: process.env.GOOGLE_CLIENT_ID || "" });
});

module.exports = router;
