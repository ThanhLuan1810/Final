// assets/js/campaign.js
(() => {
  const { $, api, showToast, escapeHtml } = window.MC;

  async function ensureAuth() {
    const me = await api("/api/auth/me");
    if (!me.user) {
      location.href = "compose.html";
      return null;
    }
    $("miniSession").textContent = `Session: ${me.user.email}`;
    return me.user;
  }

  const listEl = $("list");
  const qEl = $("q");
  const statusEl = $("status");

  let all = [];
  let pvCurrent = null;

  function closeAllMenus() {
    document
      .querySelectorAll(".dd")
      .forEach((el) => (el.style.display = "none"));
  }

  document.addEventListener("click", () => closeAllMenus());

  function statusText(st) {
    st = String(st || "").toUpperCase();
    if (st === "SENT") return "ĐÃ GỬI";
    if (st === "SCHEDULED") return "HẸN GIỜ";
    if (st === "SENDING") return "ĐANG GỬI";
    if (st === "FAILED") return "FAILED";
    return "NHÁP";
  }

  function fmt(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  }

  function getFiltered() {
    const q = (qEl.value || "").trim().toLowerCase();
    const st = String(statusEl.value || "")
      .trim()
      .toUpperCase();
    return all.filter((c) => {
      const matchSt = !st || String(c.status || "").toUpperCase() === st;
      if (!matchSt) return false;
      if (!q) return true;
      const blob = [c.title, c.subject, c.from_email, c.from_name]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  function render() {
    const rows = getFiltered();
    if (!rows.length) {
      listEl.innerHTML = `<div class="muted" style="padding:10px">No campaigns.</div>`;
      return;
    }

    listEl.innerHTML = "";
    rows.forEach((c) => {
      const st = String(c.status || "").toUpperCase();
      const isDraft = st === "DRAFT";
      const isScheduled = st === "SCHEDULED";
      const isSent = st === "SENT";

      const node = document.createElement("div");
      node.className = "camp";
      node.style.cursor = "pointer";
      node.onclick = () => openPreview(c.id);

      node.innerHTML = `
        <div>
          <div class="t">${escapeHtml(c.title || "(Untitled)")}</div>
          <div class="muted s">${escapeHtml(c.subject || "")}</div>
          <div class="muted" style="margin-top:6px">From: ${escapeHtml(c.from_email || "-")}</div>
        </div>
        <div><span class="tag ${escapeHtml(st)}">${escapeHtml(st)}</span></div>
        <div class="muted">${fmt(c.updated_at || c.created_at)}</div>
        <div class="menuWrap" onclick="event.stopPropagation()">
          <button class="dots" data-dots="${c.id}" title="Menu">⋯</button>
          <div class="dd" data-dd="${c.id}">
            <button data-act="preview" data-id="${c.id}">Preview</button>
            ${isDraft ? `<button data-act="edit" data-id="${c.id}">Sửa</button>` : ""}
            ${
              isScheduled
                ? `
              <button data-act="edit" data-id="${c.id}">Sửa</button>
              <button data-act="cancel" data-id="${c.id}">Cancel schedule</button>
            `
                : ""
            }
            ${isSent ? `<button data-act="dup" data-id="${c.id}">Duplicate</button>` : ""}
            <button class="danger" data-act="del" data-id="${c.id}">Xóa</button>
          </div>
        </div>
      `;

      listEl.appendChild(node);
    });

    document.querySelectorAll("[data-dots]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-dots");
        const dd = document.querySelector(`[data-dd="${id}"]`);
        if (!dd) return;
        const open = dd.style.display === "block";
        closeAllMenus();
        dd.style.display = open ? "none" : "block";
      };
    });

    document.querySelectorAll("[data-act]").forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const act = b.getAttribute("data-act");
        const id = Number(b.getAttribute("data-id"));
        closeAllMenus();
        if (act === "preview") return openPreview(id);
        if (act === "edit") return openEdit(id);
        if (act === "dup") return duplicate(id);
        if (act === "cancel") return cancelSchedule(id);
        if (act === "del") return del(id);
      };
    });
  }

  async function load() {
    const q = encodeURIComponent(qEl.value.trim());
    const st = encodeURIComponent(statusEl.value.trim());
    const res = await api(
      `/api/campaigns?search=${q}&status=${st}&limit=200&offset=0`,
    );
    all = res.campaigns || [];
    render();
  }

  // ===== Preview modal =====
  function pvOpen() {
    $("pvBackdrop").style.display = "block";
    $("pv").style.display = "block";
  }
  function pvClose() {
    $("pvBackdrop").style.display = "none";
    $("pv").style.display = "none";
    $("pvFrame").srcdoc = "";
    pvCurrent = null;
  }

  $("pvBackdrop").onclick = pvClose;
  $("pvClose").onclick = pvClose;

  async function openPreview(id) {
    try {
      const res = await api(`/api/campaigns/${id}`);
      const c = res.campaign;
      pvCurrent = c;

      $("pvTitle").textContent = c.title || "(Untitled)";
      $("pvMeta").textContent =
        `${statusText(c.status)} • Updated: ${fmt(c.updated_at || c.created_at)}`;

      const info = {
        id: c.id,
        status: c.status,
        subject: c.subject,
        from: `${c.from_name || ""} <${c.from_email || ""}>`.trim(),
        reply_to: c.reply_to || null,
        list_id: c.list_id || null,
        scheduled_at: c.scheduled_at || null,
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
      $("pvInfo").textContent = JSON.stringify(info, null, 2);
      $("pvFrame").srcdoc =
        c.html ||
        "<div style='font-family:system-ui;padding:16px;color:#6b7280'>No HTML</div>";

      const st = String(c.status || "").toUpperCase();
      $("pvEdit").style.display =
        st === "DRAFT" || st === "SCHEDULED" ? "inline-block" : "none";
      $("pvDup").style.display = st === "SENT" ? "inline-block" : "none";
      $("pvCancel").style.display =
        st === "SCHEDULED" ? "inline-block" : "none";

      $("pvEdit").onclick = () => openEdit(c.id);
      $("pvDup").onclick = () => duplicate(c.id);
      $("pvCancel").onclick = () => cancelSchedule(c.id);

      pvOpen();
    } catch (e) {
      showToast(e.message || "Preview failed", "bad", 3000);
    }
  }

  function openEdit(id) {
    location.href = `eblast.html?campaign_id=${encodeURIComponent(id)}&mode=edit`;
  }

  async function duplicate(id) {
    try {
      const res = await api(`/api/campaigns/${id}/duplicate`, {
        method: "POST",
      });
      showToast("Duplicated.", "ok", 1600);
      location.href = `eblast.html?campaign_id=${encodeURIComponent(res.new_campaign_id)}&mode=edit`;
    } catch (e) {
      showToast(e.message || "Duplicate failed", "bad", 3000);
    }
  }

  async function cancelSchedule(id) {
    const ok = confirm("Cancel lịch gửi? Campaign sẽ chuyển về NHÁP.");
    if (!ok) return;
    try {
      await api(`/api/campaigns/${id}/cancel`, { method: "POST" });
      showToast("Schedule cancelled (now Draft).", "ok", 2000);
      await load();
      if (pvCurrent && pvCurrent.id === id) openPreview(id);
    } catch (e) {
      showToast(e.message || "Cancel failed", "bad", 3000);
    }
  }

  async function del(id) {
    const ok = confirm("Xóa campaign này luôn? Không hoàn tác được.");
    if (!ok) return;
    try {
      await api(`/api/campaigns/${id}`, { method: "DELETE" });
      showToast("Deleted.", "ok", 1600);
      await load();
      if (pvCurrent && pvCurrent.id === id) pvClose();
    } catch (e) {
      showToast(e.message || "Delete failed", "bad", 3000);
    }
  }

  $("btnRefresh").onclick = () => load();
  qEl.addEventListener("input", () => render());
  statusEl.addEventListener("change", () => load());

  (async () => {
    await ensureAuth();
    await load();
  })();
})();
