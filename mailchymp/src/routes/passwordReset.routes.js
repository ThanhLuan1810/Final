const router = require("express").Router();
const {
  requestPasswordResetOtp,
  verifyOtp,
  resetPassword,
} = require("../services/passwordReset.service");

router.post("/forgot", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email)
      return res.status(400).json({ ok: false, message: "Thiếu email" });

    await requestPasswordResetOtp(String(email).trim().toLowerCase());
    // luôn trả ok để tránh dò email
    res.json({ ok: true, message: "Nếu email tồn tại, OTP đã được gửi." });
  } catch (e) {
    console.error(e);
    res.json({ ok: true, message: "Nếu email tồn tại, OTP đã được gửi." });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp)
      return res.status(400).json({ ok: false, message: "Thiếu dữ liệu" });

    const r = await verifyOtp({
      email: String(email).trim().toLowerCase(),
      otp: String(otp).trim(),
    });

    res.json(r);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Lỗi server" });
  }
});

router.post("/reset", async (req, res) => {
  try {
    const { email, reset_id, new_password } = req.body || {};
    if (!email || !reset_id || !new_password)
      return res.status(400).json({ ok: false, message: "Thiếu dữ liệu" });

    if (String(new_password).length < 6)
      return res
        .status(400)
        .json({ ok: false, message: "Mật khẩu tối thiểu 6 ký tự" });

    const r = await resetPassword({
      email: String(email).trim().toLowerCase(),
      reset_id: Number(reset_id),
      new_password: String(new_password),
    });

    res.json(r);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Lỗi server" });
  }
});

module.exports = router;
