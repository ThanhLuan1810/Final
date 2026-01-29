// assets/js/eblast.js
(() => {
  const { $, api, showToast } = window.MC;

  // ===== Mini session + gmail =====
  const gmailStatusText = $("gmailStatusText");
  const btnConnect = $("btnConnect");
  const btnDisconnect = $("btnDisconnect");

  function renderGmailStatus(st) {
    if (st.connected) {
      gmailStatusText.textContent = `Connected: ${st.email}`;
      btnConnect.disabled = true;
      btnDisconnect.disabled = false;
    } else {
      gmailStatusText.textContent = "Not connected";
      btnConnect.disabled = false;
      btnDisconnect.disabled = true;
    }
  }

  async function refreshMini() {
    const me = await api("/api/auth/me");
    if (!me.user) {
      location.href = "compose.html";
      return;
    }
    $("miniSession").textContent = `Session: ${me.user.email}`;

    const st = await api("/api/gmail/status");
    $("miniGmail").textContent = st.connected
      ? `Gmail: ${st.email}`
      : "Gmail: NOT_CONNECTED";
    renderGmailStatus(st);
  }

  btnConnect.onclick = () => (window.location.href = "/api/gmail/connect");
  btnDisconnect.onclick = async () => {
    try {
      await api("/api/gmail/disconnect", { method: "POST" });
      showToast("Disconnected.", "ok", 1400);
      await refreshMini();
    } catch (e) {
      showToast(e.message || "Disconnect failed", "bad", 3000);
    }
  };

  // ===== Elements =====
  const titleEl = $("title");
  const subjectEl = $("subject");
  const fromNameEl = $("fromName");
  const replyToEl = $("replyTo");
  const htmlEl = $("htmlInput");
  const campaignIdEl = $("campaignId");
  const draftMetaEl = $("draftMeta");
  const scheduleMetaEl = $("scheduleMeta");
  const listSelect = $("listSelect");
  const scheduleAtEl = $("scheduleAt");

  // URL params: ?campaign_id=123&mode=edit|view
  const urlParams = new URLSearchParams(location.search || "");
  const paramCampaignId = Number(urlParams.get("campaign_id") || 0);
  const paramMode = String(urlParams.get("mode") || "")
    .trim()
    .toLowerCase();
  let loadedCampaignStatus = ""; // DRAFT/SCHEDULED/SENT...

  // ===== Preview =====
  const previewFrame = $("previewFrame");

  function setPreview(html) {
    const doc =
      previewFrame.contentDocument || previewFrame.contentWindow.document;
    doc.open();
    doc.write(
      html ||
        "<div style='font-family:system-ui;padding:16px;color:#6b7280'>No HTML</div>",
    );
    doc.close();
  }

  function refreshPreview() {
    setPreview(htmlEl.value);
  }

  let previewTimer = null;
  htmlEl.addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 150);
  });

  $("btnPreviewRefresh").onclick = refreshPreview;

  $("btnPreviewPop").onclick = () => {
    const w = window.open("", "_blank");
    w.document.open();
    w.document.write(htmlEl.value || "<div>No HTML</div>");
    w.document.close();
  };

  // ===== Draft local =====
  const DRAFT_KEY = "mailchymp:eblast:draft:v4";
  let lastHash = "";

  function formatLocalDatetime(val) {
    if (!val) return "";
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString();
  }

  function loadDraft() {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      titleEl.value = d.title || "";
      subjectEl.value = d.subject || "";
      fromNameEl.value = d.from_name || "";
      replyToEl.value = d.reply_to || "";
      htmlEl.value = d.html || "";
      campaignIdEl.value = d.campaign_id || "";
      scheduleAtEl.value = d.schedule_at || "";
      draftMetaEl.textContent = d.saved_at
        ? `Draft saved at: ${new Date(d.saved_at).toLocaleString()}`
        : "Draft loaded";
      scheduleMetaEl.textContent = d.schedule_at
        ? `Schedule set: ${formatLocalDatetime(d.schedule_at)}`
        : "";
      refreshPreview();
    } catch {}
  }

  function saveDraftLocal() {
    const payload = {
      title: titleEl.value.trim(),
      subject: subjectEl.value.trim(),
      from_name: fromNameEl.value.trim(),
      reply_to: replyToEl.value.trim(),
      html: htmlEl.value,
      campaign_id: campaignIdEl.value.trim(),
      schedule_at: scheduleAtEl.value || "",
      saved_at: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    draftMetaEl.textContent = `Draft saved at: ${new Date(payload.saved_at).toLocaleString()}`;
    scheduleMetaEl.textContent = payload.schedule_at
      ? `Schedule set: ${formatLocalDatetime(payload.schedule_at)}`
      : "";
  }

  async function saveDraftServer({ schedule = false } = {}) {
    // For DRAFT/SCHEDULED edit mode
    const p = requireFields();
    const existing = campaignIdEl.value.trim();

    if (existing) {
      // update
      const body = {
        title: p.title,
        subject: p.subject,
        from_name: p.from_name,
        reply_to: p.reply_to,
        html: p.html,
      };
      if (schedule) {
        const listId = listSelect.value;
        const whenLocal = scheduleAtEl.value;
        const iso = toIsoFromLocalInput(whenLocal);
        if (!listId) throw new Error("Please select a list");
        if (!whenLocal) throw new Error("Please pick schedule time");
        if (!iso) throw new Error("Invalid schedule time");
        if (new Date(iso).getTime() < Date.now() + 15 * 1000) {
          throw new Error("Schedule time must be in the future");
        }
        body.list_id = Number(listId);
        body.scheduled_at = iso;
      }

      await api(`/api/campaigns/${encodeURIComponent(existing)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return Number(existing);
    }

    // create
    const data = await api("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        title: p.title,
        subject: p.subject,
        from_name: p.from_name,
        reply_to: p.reply_to,
        html: p.html,
      }),
    });
    campaignIdEl.value = String(data.campaign_id);
    return data.campaign_id;
  }

  /*$("btnSaveDraft").onclick = async () => {
    try {
      if (paramMode === "view" || loadedCampaignStatus === "SENT") {
        throw new Error("Campaign đã gửi: không thể lưu/sửa.");
      }
      const id = await saveDraftServer({ schedule: false });
      saveDraftLocal();
      showToast(`Saved. Campaign ID: ${id}`, "ok", 1800);
    } catch (e) {
      showToast(e.message || "Save draft failed", "bad", 3200);
    }
  };*/

  $("btnSaveDraft").onclick = async () => {
    try {
      if (paramMode === "view" || loadedCampaignStatus === "SENT") {
        throw new Error("Campaign đã gửi: không thể lưu/sửa.");
      }
      const id = await saveDraftServer({ schedule: false });
      showToast(`Draft saved (#${id}). Creating new draft...`, "ok", 1600);
      resetComposer({ keepList: true });
      draftMetaEl.textContent = "Draft: new";
      scheduleMetaEl.textContent = "";
    } catch (e) {
      showToast(e.message || "Save draft failed", "bad", 3200);
    }
  };

  function hashDraft() {
    return [
      titleEl.value,
      subjectEl.value,
      fromNameEl.value,
      replyToEl.value,
      htmlEl.value,
      campaignIdEl.value,
      scheduleAtEl.value,
    ].join("||");
  }

  function hasMeaningfulDraft() {
    return (
      (titleEl.value || "").trim() ||
      (subjectEl.value || "").trim() ||
      (fromNameEl.value || "").trim() ||
      (replyToEl.value || "").trim() ||
      (htmlEl.value || "").trim() ||
      (campaignIdEl.value || "").trim() ||
      (scheduleAtEl.value || "").trim()
    );
  }

  setInterval(() => {
    const h = hashDraft();
    if (h !== lastHash) {
      lastHash = h;
      if (hasMeaningfulDraft()) saveDraftLocal();
    }
  }, 8000);

  // ===== RESET after send/schedule =====
  function resetComposer({ keepList = true } = {}) {
    const currentList = listSelect.value;

    titleEl.value = "";
    subjectEl.value = "";
    fromNameEl.value = "";
    replyToEl.value = "";
    htmlEl.value = "";
    campaignIdEl.value = "";
    scheduleAtEl.value = "";
    draftMetaEl.textContent = "Draft: new";
    scheduleMetaEl.textContent = "";

    localStorage.removeItem(DRAFT_KEY);

    setPreview(
      "<div style='font-family:system-ui;padding:16px;color:#6b7280'>No HTML</div>",
    );

    if (keepList) listSelect.value = currentList;
    lastHash = "";

    // clear any ?campaign_id=... so user doesn't get stuck
    try {
      history.replaceState(null, "", "eblast.html");
      loadedCampaignStatus = "";
    } catch {}
  }

  $("btnNewDraft").onclick = () => {
    resetComposer({ keepList: true });
    showToast("New draft ready.", "ok", 1400);
  };

  // ===== Lists =====
  async function loadLists() {
    const res = await api("/api/lists");
    listSelect.innerHTML = `<option value="">-- Select a list --</option>`;
    (res.lists || []).forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = `${l.name} (${l.count} emails)`;
      listSelect.appendChild(opt);
    });
  }

  $("btnCreateList").onclick = async () => {
    try {
      const name = $("newListName").value.trim();
      if (!name) throw new Error("Missing list name");
      await api("/api/lists", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      showToast("List created.", "ok", 1500);
      $("newListName").value = "";
      await loadLists();
    } catch (e) {
      showToast(e.message || "Create list failed", "bad", 3000);
    }
  };

  $("btnAddEmails").onclick = async () => {
    try {
      const listId = listSelect.value;
      if (!listId) throw new Error("Please select a list first");
      const raw = $("emailsInput").value;
      const emails = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!emails.length) throw new Error("No emails");

      const resp = await api(`/api/lists/${listId}/subscribers`, {
        method: "POST",
        body: JSON.stringify({ emails }),
      });

      showToast(`Added ${resp.added} email(s).`, "ok", 2000);
      $("emailsInput").value = "";
      await loadLists();
    } catch (e) {
      showToast(e.message || "Add emails failed", "bad", 3200);
    }
  };

  // ===== Campaign create/send/schedule =====
  function requireFields() {
    const title = titleEl.value.trim();
    const subject = subjectEl.value.trim();
    const from_name = fromNameEl.value.trim();
    const html = htmlEl.value;

    if (!title) throw new Error("Missing title");
    if (!subject) throw new Error("Missing subject");
    if (!from_name) throw new Error("Missing from name");
    if (!html || !html.trim()) throw new Error("Missing html");

    return {
      title,
      subject,
      from_name,
      reply_to: replyToEl.value.trim(),
      html,
    };
  }

  async function createCampaignIfNeeded() {
    const existing = campaignIdEl.value.trim();
    if (existing) return Number(existing);

    const id = await saveDraftServer({ schedule: false });
    showToast(`Created campaign ID: ${id}`, "ok", 2500);
    saveDraftLocal();
    return id;
  }

  $("btnCreateCampaign").onclick = async () => {
    try {
      await createCampaignIfNeeded();
    } catch (e) {
      showToast(e.message || "Create failed", "bad", 3200);
    }
  };

  $("btnSendNow").onclick = async () => {
    try {
      const st = await api("/api/gmail/status");
      if (!st.connected) throw new Error("Gmail not connected");

      const listId = listSelect.value;
      if (!listId) throw new Error("Please select a list");

      const campaignId = await createCampaignIfNeeded();

      const resp = await api("/api/campaigns/send", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: campaignId,
          list_id: Number(listId),
        }),
      });

      showToast(
        `Send done. Sent: ${resp.sent} Failed: ${resp.failed}`,
        "ok",
        3500,
      );
      resetComposer({ keepList: true });
    } catch (e) {
      showToast(e.message || "Send failed", "bad", 3500);
    }
  };

  function toIsoFromLocalInput(val) {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  $("btnSchedule").onclick = async () => {
    try {
      const st = await api("/api/gmail/status");
      if (!st.connected) throw new Error("Gmail not connected");

      const listId = listSelect.value;
      if (!listId) throw new Error("Please select a list");

      const whenLocal = scheduleAtEl.value;
      if (!whenLocal) throw new Error("Please pick schedule time");

      const iso = toIsoFromLocalInput(whenLocal);
      if (!iso) throw new Error("Invalid schedule time");

      if (new Date(iso).getTime() < Date.now() + 15 * 1000) {
        throw new Error("Schedule time must be in the future");
      }

      // Prefer single-source-of-truth: update campaign to SCHEDULED via PUT
      const campaignId = await saveDraftServer({ schedule: true });

      // Keep old endpoint for backward compatibility
      const resp = await api("/api/campaigns/schedule", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: campaignId,
          list_id: Number(listId),
          scheduled_at: iso,
        }),
      });

      showToast(
        resp?.message || `Scheduled OK: ${formatLocalDatetime(whenLocal)}`,
        "ok",
        3500,
      );
      resetComposer({ keepList: true });
    } catch (e) {
      showToast(e.message || "Schedule failed", "bad", 3500);
    }
  };

  function setDefaultScheduleTime() {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    const v =
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes());
    if (!scheduleAtEl.value) scheduleAtEl.value = v;
  }

  window.addEventListener("load", async () => {
    loadDraft();
    refreshPreview();
    setDefaultScheduleTime();
    await refreshMini();
    await loadLists();

    // If opened from Campaigns page, load campaign from DB
    if (paramCampaignId) {
      try {
        const r = await api(
          `/api/campaigns/${encodeURIComponent(paramCampaignId)}`,
        );
        const c = r.campaign;
        loadedCampaignStatus = String(c.status || "").toUpperCase();

        titleEl.value = c.title || "";
        subjectEl.value = c.subject || "";
        fromNameEl.value = c.from_name || "";
        replyToEl.value = c.reply_to || "";
        htmlEl.value = c.html || "";
        campaignIdEl.value = String(c.id || "");

        if (c.list_id) listSelect.value = String(c.list_id);
        if (c.scheduled_at) {
          const d = new Date(c.scheduled_at);
          if (!isNaN(d.getTime())) {
            const pad = (n) => String(n).padStart(2, "0");
            scheduleAtEl.value =
              d.getFullYear() +
              "-" +
              pad(d.getMonth() + 1) +
              "-" +
              pad(d.getDate()) +
              "T" +
              pad(d.getHours()) +
              ":" +
              pad(d.getMinutes());
          }
        }

        draftMetaEl.textContent = `Loaded campaign #${c.id} (${loadedCampaignStatus})`;
        scheduleMetaEl.textContent = c.scheduled_at
          ? `Scheduled at: ${formatLocalDatetime(c.scheduled_at)}`
          : "";
        refreshPreview();

        const viewOnly =
          paramMode === "view" || loadedCampaignStatus === "SENT";
        if (viewOnly) {
          [
            titleEl,
            subjectEl,
            fromNameEl,
            replyToEl,
            htmlEl,
            listSelect,
            scheduleAtEl,
          ].forEach((el) => (el.disabled = true));
          $("btnSaveDraft").disabled = true;
          $("btnCreateCampaign").disabled = true;
          $("btnSendNow").disabled = true;
          $("btnSchedule").disabled = true;
          $("btnNewDraft").disabled = false;
          showToast(
            "Campaign đã gửi: chỉ xem preview (không sửa).",
            "ok",
            2200,
          );
        }
      } catch (e) {
        showToast(e.message || "Load campaign failed", "bad", 3200);
      }
    }
  });
})();
