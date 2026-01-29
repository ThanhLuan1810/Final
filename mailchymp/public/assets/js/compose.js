// assets/js/compose.js
(() => {
  const { $, api, showToast } = window.MC;

  // Tabs + Panels
  const tabLogin = $("tabLogin");
  const tabReg = $("tabReg");

  const panelLogin = $("panelLogin");
  const panelReg = $("panelReg");
  const panelForgot = $("panelForgot");

  function showPanel(which) {
    panelLogin.style.display = which === "login" ? "block" : "none";
    panelReg.style.display = which === "reg" ? "block" : "none";
    panelForgot.style.display = which === "forgot" ? "block" : "none";

    // tabs only apply login/reg UI
    if (which === "login") {
      tabLogin.classList.add("active");
      tabReg.classList.remove("active");
    } else if (which === "reg") {
      tabReg.classList.add("active");
      tabLogin.classList.remove("active");
    } else {
      tabReg.classList.remove("active");
      tabLogin.classList.remove("active");
    }
  }

  tabLogin.onclick = () => showPanel("login");
  tabReg.onclick = () => showPanel("reg");

  // Auto redirect nếu đã login
  (async () => {
    try {
      const me = await api("/api/auth/me");
      if (me.user) location.href = "eblast.html";
    } catch {}
  })();

  async function doLogin() {
    const email = $("loginEmail").value.trim().toLowerCase();
    const password = $("loginPass").value;
    const remember = $("rememberMe").checked;

    if (!email || !password) {
      showToast("Missing email/password", "bad", 2200);
      return;
    }

    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, remember }),
    });

    showToast("Login OK", "ok", 1200);
    setTimeout(() => (location.href = "eblast.html"), 600);
  }

  async function doRegister() {
    const name = $("regName").value.trim();
    const email = $("regEmail").value.trim().toLowerCase();
    const password = $("regPass").value;

    await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });

    showToast("Register OK", "ok", 1200);
    setTimeout(() => (location.href = "eblast.html"), 600);
  }

  $("btnLogin").onclick = async () => {
    try {
      await doLogin();
    } catch (e) {
      showToast(e.message || "Login failed", "bad", 3200);
    }
  };

  $("btnReg").onclick = async () => {
    try {
      await doRegister();
    } catch (e) {
      showToast(e.message || "Register failed", "bad", 3200);
    }
  };

  // Enter submit
  $("loginEmail").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("loginPass").focus();
  });
  $("loginPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnLogin").click();
  });
  $("regPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnReg").click();
  });

  // ========= Forgot Password UI =========
  const btnOpenForgot = $("btnOpenForgot");
  const btnBackToLogin = $("btnBackToLogin");
  const btnSendOtp = $("btnSendOtp");
  const btnResendOtp = $("btnResendOtp");
  const btnVerifyAndReset = $("btnVerifyAndReset");

  let fpCooldownUntil = 0;

  function cooldown(seconds) {
    fpCooldownUntil = Date.now() + seconds * 1000;
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((fpCooldownUntil - Date.now()) / 1000),
      );
      const disabled = left > 0;
      btnSendOtp.disabled = disabled;
      btnResendOtp.disabled = disabled;
      btnSendOtp.textContent = disabled ? `Send OTP (${left}s)` : "Send OTP";
      btnResendOtp.textContent = disabled
        ? `Resend OTP (${left}s)`
        : "Resend OTP";
      if (disabled) requestAnimationFrame(tick);
      else {
        btnSendOtp.textContent = "Send OTP";
        btnResendOtp.textContent = "Resend OTP";
      }
    };
    tick();
  }

  btnOpenForgot.onclick = () => {
    $("fpEmail").value = $("loginEmail").value.trim().toLowerCase();
    showPanel("forgot");
    setTimeout(() => $("fpEmail").focus(), 50);
  };

  btnBackToLogin.onclick = () => {
    showPanel("login");
    setTimeout(() => $("loginEmail").focus(), 50);
  };

  async function sendOtp(isResend = false) {
    const email = $("fpEmail").value.trim().toLowerCase();
    if (!email) {
      showToast("Missing email", "bad", 2200);
      return;
    }

    await api("/api/password/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    showToast("OTP sent (if email exists)", "ok", 2200);
    cooldown(60);
    if (!isResend) setTimeout(() => $("fpOtp").focus(), 50);
  }

  btnSendOtp.onclick = async () => {
    try {
      await sendOtp(false);
    } catch (e) {
      showToast(e.message || "Send OTP failed", "bad", 3200);
    }
  };

  btnResendOtp.onclick = async () => {
    try {
      await sendOtp(true);
    } catch (e) {
      showToast(e.message || "Resend OTP failed", "bad", 3200);
    }
  };

  btnVerifyAndReset.onclick = async () => {
    try {
      const email = $("fpEmail").value.trim().toLowerCase();
      const otp = $("fpOtp").value.trim();
      const new_password = $("fpNewPass").value;

      if (!email || !otp || !new_password) {
        showToast("Missing email/otp/new password", "bad", 2500);
        return;
      }
      if (new_password.length < 6) {
        showToast("Password must be >= 6 chars", "bad", 2500);
        return;
      }

      // 1) verify OTP
      const v = await api("/api/password/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email, otp }),
      });

      if (!v.ok || !v.reset_id) {
        showToast(v.message || "OTP invalid", "bad", 3200);
        return;
      }

      // 2) reset password
      const r = await api("/api/password/reset", {
        method: "POST",
        body: JSON.stringify({ email, reset_id: v.reset_id, new_password }),
      });

      if (!r.ok) {
        showToast(r.message || "Reset failed", "bad", 3200);
        return;
      }

      showToast("Password updated. Please login.", "ok", 2500);
      // back to login with email prefilled
      $("loginEmail").value = email;
      $("loginPass").value = "";
      showPanel("login");
      setTimeout(() => $("loginPass").focus(), 50);
    } catch (e) {
      showToast(e.message || "Verify/Reset failed", "bad", 3200);
    }
  };

  // ========= Google Login =========
  async function initGoogle() {
    let cfg;
    try {
      cfg = await api("/api/config");
    } catch {
      showToast("Cannot load /api/config", "bad", 3000);
      return;
    }

    const cid = cfg.google_client_id || "";
    if (!cid) {
      showToast("Missing GOOGLE_CLIENT_ID in .env", "bad", 3500);
      return;
    }

    const start = Date.now();
    function wait() {
      if (Date.now() - start > 8000) {
        showToast("Google script bị chặn (adblock/firewall)", "bad", 4000);
        return;
      }
      if (!window.google?.accounts?.id) {
        setTimeout(wait, 200);
        return;
      }

      google.accounts.id.initialize({
        client_id: cid,
        callback: async (resp) => {
          try {
            await api("/api/auth/google", {
              method: "POST",
              body: JSON.stringify({ credential: resp.credential }),
            });
            showToast("Google login OK", "ok", 1200);
            setTimeout(() => (location.href = "eblast.html"), 600);
          } catch (e) {
            showToast(e.message || "Google login failed", "bad", 3200);
          }
        },
      });

      google.accounts.id.renderButton($("googleBtn"), {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 320,
      });
    }

    wait();
  }

  // Toggle show/hide password
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".pwBtn");
    if (!btn) return;

    const id = btn.getAttribute("data-toggle");
    const input = document.getElementById(id);
    if (!input) return;

    const showing = input.type === "text";
    input.type = showing ? "password" : "text";

    btn.classList.toggle("on", !showing);
    btn.textContent = showing ? "👁" : "🙈";
  });

  initGoogle();
})();
