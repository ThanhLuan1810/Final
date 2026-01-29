// public/assets/js/topbar.js
(() => {
  const ACTIVE_MAP = {
    "eblast.html": "eblast",
    "campaign.html": "campaign",
    "dashboard.html": "dashboard",
  };

  async function injectTopbar() {
    const holder = document.querySelector("#topbarMount");
    if (!holder) return;

    const res = await fetch("partials/topbar.html", { credentials: "include" });
    const html = await res.text();
    holder.innerHTML = html;

    // set active
    const file = (location.pathname.split("/").pop() || "").toLowerCase();
    const key = ACTIVE_MAP[file] || null;
    if (key) {
      holder.querySelectorAll("[data-nav]").forEach((a) => {
        if (a.getAttribute("data-nav") === key) a.classList.add("active");
      });
    }

    // show gmail mini only on eblast
    const miniGmail = holder.querySelector("#miniGmail");
    if (miniGmail) {
      miniGmail.style.display =
        file === "eblast.html" ? "inline-block" : "none";
    }

    // bind logout (uses MC api if exists; fallback fetch)
    const btnLogout = holder.querySelector("#btnLogout");
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        try {
          if (window.MC?.api) {
            await window.MC.api("/api/auth/logout", { method: "POST" });
          } else {
            await fetch("/api/auth/logout", {
              method: "POST",
              credentials: "include",
            });
          }
          // optional toast
          if (window.MC?.showToast)
            window.MC.showToast("Logged out.", "ok", 1400);
          setTimeout(() => (location.href = "compose.html"), 300);
        } catch (e) {
          if (window.MC?.showToast)
            window.MC.showToast("Logout failed", "bad", 2500);
          else alert("Logout failed");
        }
      });
    }

    // refresh mini session text if lib provides helper
    if (window.MC?.refreshMiniTopbar) {
      window.MC.refreshMiniTopbar();
    }
  }

  window.injectTopbar = injectTopbar;
})();
