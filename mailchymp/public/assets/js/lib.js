// assets/js/lib.js
// Shared helpers for Mailchymp pages (no hardcode host/port)
(() => {
  const API_BASE = ""; // same-origin

  function $(id) {
    return document.getElementById(id);
  }

  // ---- Toast ----
  let toastTimer = null;

  function showToast(text, type = "ok", ms = 2500) {
    const toast = $("toast");
    const toastText = $("toastText");
    if (!toast || !toastText) {
      // fallback: if toast not mounted
      console[type === "bad" ? "error" : "log"]("[toast]", text);
      return;
    }

    toastText.textContent = text;
    toast.classList.toggle("bad", type === "bad");
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), ms);
  }

  function initToast() {
    const toastX = $("toastX");
    const toast = $("toast");
    if (!toastX || !toast) return;

    toastX.onclick = () => {
      toast.classList.remove("show");
      clearTimeout(toastTimer);
    };
  }

  // ---- Robust fetch (debug-friendly) ----
  async function api(path, options = {}) {
    const r = await fetch(API_BASE + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      credentials: "include",
    });

    const text = await r.text();

    // try parse json, else keep null
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!r.ok) {
      // Show status + snippet so we can see redirects/html/express default messages
      const snippet = (text || "").slice(0, 180).replace(/\s+/g, " ").trim();
      const msg =
        (data && data.message) ||
        `HTTP ${r.status} ${r.statusText} — ${snippet || "no body"}`;
      throw new Error(msg);
    }

    // if ok but not JSON, still return raw text for debugging
    return data ?? { ok: true, raw: text };
  }

  // ---- Helpers ----
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );
  }

  function pct(num, den) {
    const n = Number(num || 0);
    const d = Number(den || 0);
    if (!d) return "0.0";
    return ((n / d) * 100).toFixed(1);
  }

  // expose to window for non-module scripts
  window.MC = {
    API_BASE,
    $,
    api,
    showToast,
    initToast,
    escapeHtml,
    pct,
  };

  // auto init toast once DOM ready
  window.addEventListener("DOMContentLoaded", () => {
    initToast();
  });
})();
