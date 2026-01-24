// assets/js/compose.js
(() => {
  const { $, api, showToast } = window.MC;

  // Tabs
  const tabLogin = $("tabLogin");
  const tabReg = $("tabReg");
  const panelLogin = $("panelLogin");
  const panelReg = $("panelReg");

  tabLogin.onclick = () => {
    tabLogin.classList.add("active");
    tabReg.classList.remove("active");
    panelLogin.style.display = "block";
    panelReg.style.display = "none";
  };

  tabReg.onclick = () => {
    tabReg.classList.add("active");
    tabLogin.classList.remove("active");
    panelReg.style.display = "block";
    panelLogin.style.display = "none";
  };

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

  initGoogle();
})();
