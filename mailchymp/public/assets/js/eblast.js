/* assets/js/eblast.js (FULL - FINAL, matches your current routes)
  Gmail:
    GET  /api/gmail/status
    GET  /api/gmail/connect (redirect)
    POST /api/gmail/disconnect

  Lists:
    GET  /api/lists
    POST /api/lists {name}
    GET  /api/lists/:id/members
    POST /api/lists/:id/members {email}
    PUT  /api/lists/:id/members/:subscriberId {email}
    DELETE /api/lists/:id/members/:subscriberId

  Campaigns:
    POST /api/campaigns
    PUT  /api/campaigns/:id
    POST /api/campaigns/send {campaign_id, list_id}
    POST /api/campaigns/schedule {campaign_id, list_id, scheduled_at}
*/

(() => {
  const API = {
    gmailStatus: "/api/gmail/status",
    gmailConnect: "/api/gmail/connect",
    gmailDisconnect: "/api/gmail/disconnect",

    lists: "/api/lists",
    listMembers: (listId) => `/api/lists/${listId}/members`,
    listMember: (listId, subscriberId) =>
      `/api/lists/${listId}/members/${subscriberId}`,

    campaigns: "/api/campaigns",
    campaign: (id) => `/api/campaigns/${id}`,
    sendNow: "/api/campaigns/send",
    schedule: "/api/campaigns/schedule",
  };

  // ===== helpers =====
  const $ = (id) => document.getElementById(id);
  const normEmail = (s) =>
    String(s || "")
      .trim()
      .toLowerCase();
  const isEmail = (s) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

  function toast(msg, type) {
    if (typeof window.showToast === "function")
      return window.showToast(msg, type);
    console.log(type ? `[${type}]` : "", msg);
    alert(msg);
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    let data = {};
    try {
      data = await res.json();
    } catch {}
    if (!res.ok || data.ok === false)
      throw new Error(data.message || `Request failed: ${res.status}`);
    return data;
  }

  function splitEmails(raw) {
    return String(raw || "")
      .split(/[,\n;\s]+/g)
      .map((x) => normEmail(x))
      .filter(Boolean);
  }

  function toSqlDatetime(dtLocalValue) {
    if (!dtLocalValue) return null;
    const v = String(dtLocalValue).trim();
    if (!v.includes("T")) return null;
    return v.replace("T", " ") + ":00";
  }

  // ===== elements =====
  const gmailStatusText = $("gmailStatusText");
  const btnConnect = $("btnConnect");
  const btnDisconnect = $("btnDisconnect");

  const listSelect = $("listSelect");
  const newListName = $("newListName");
  const btnCreateList = $("btnCreateList");
  const emailsInput = $("emailsInput");
  const btnAddEmails = $("btnAddEmails");

  const title = $("title");
  const subject = $("subject");
  const fromName = $("fromName");
  const replyTo = $("replyTo");
  const htmlInput = $("htmlInput");

  const btnSaveDraft = $("btnSaveDraft");
  const btnNewDraft = $("btnNewDraft");
  const btnCreateCampaign = $("btnCreateCampaign");
  const btnSendNow = $("btnSendNow");
  const scheduleAt = $("scheduleAt");
  const btnSchedule = $("btnSchedule");

  const campaignId = $("campaignId");
  const draftMeta = $("draftMeta");
  const scheduleMeta = $("scheduleMeta");

  const previewFrame = $("previewFrame");
  const btnPreviewRefresh = $("btnPreviewRefresh");
  const btnPreviewPop = $("btnPreviewPop");

  // Optional: modal list manager UI
  const listManager = $("listManager");
  const btnOpenListModal = $("btnOpenListModal");
  const listNameText = $("listNameText");

  const listModal = $("listModal");
  const listModalOverlay = $("listModalOverlay");
  const btnCloseListModal = $("btnCloseListModal");
  const btnCloseListModal2 = $("btnCloseListModal2");
  const listModalSub = $("listModalSub");
  const listMembersBody = $("listMembersBody");
  const singleEmailInput = $("singleEmailInput");
  const btnAddSingleEmail = $("btnAddSingleEmail");
  const btnRefreshMembers = $("btnRefreshMembers");

  // ===== state =====
  const LS_KEY = "mailchymp_eblast_draft_final";
  let currentListId = null;
  let previewTimer = null;
  let gmailConnected = false;

  // ===== Gmail =====
  async function loadGmailStatus() {
    if (!gmailStatusText) return;
    try {
      const data = await api(API.gmailStatus);
      gmailConnected = !!data.connected;
      gmailStatusText.textContent = data.connected
        ? `Connected: ${data.email || ""}`.trim()
        : "Not connected";
    } catch (e) {
      gmailConnected = false;
      gmailStatusText.textContent = "Status unavailable";
      console.error(e);
    }
  }

  function bindGmail() {
    btnConnect?.addEventListener(
      "click",
      () => (window.location.href = API.gmailConnect),
    );
    btnDisconnect?.addEventListener("click", async () => {
      try {
        await api(API.gmailDisconnect, { method: "POST" });
        toast("Disconnected");
        await loadGmailStatus();
      } catch (e) {
        toast(e.message, "danger");
      }
    });
  }

  // ===== Lists =====
  function syncListLauncher() {
    currentListId = listSelect?.value || null;
    if (!listManager) return;

    if (!currentListId) {
      listManager.style.display = "none";
      return;
    }

    listManager.style.display = "block";
    const opt = listSelect.options[listSelect.selectedIndex];
    const txt = opt ? opt.textContent : "—";
    if (listNameText) listNameText.textContent = txt;
    if (listModalSub) listModalSub.textContent = txt;
  }

  async function loadLists(keepSelection = true) {
    if (!listSelect) return;
    const prev = keepSelection ? listSelect.value : "";

    const data = await api(API.lists);
    const lists = data.lists || [];

    listSelect.innerHTML =
      `<option value="">-- Select a list --</option>` +
      lists
        .map((l) => `<option value="${l.id}">${l.name} (${l.total})</option>`)
        .join("");

    if (
      keepSelection &&
      prev &&
      lists.some((x) => String(x.id) === String(prev))
    ) {
      listSelect.value = prev;
    }

    syncListLauncher();
  }

  async function createList() {
    const name =
      String(newListName?.value || "").trim() || prompt("Nhập tên list mới:");
    if (!name) return;

    try {
      await api(API.lists, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      toast("List created");
      if (newListName) newListName.value = "";

      await loadLists(false);

      // auto-select by name prefix
      for (const opt of listSelect.options) {
        if (opt.value && opt.textContent.startsWith(name)) {
          listSelect.value = opt.value;
          break;
        }
      }
      syncListLauncher();
    } catch (e) {
      toast(e.message, "danger");
    }
  }

  async function addEmailsBulk() {
    if (!currentListId) return toast("Chọn list trước đã", "danger");

    const emails = splitEmails(emailsInput?.value);
    if (!emails.length) return toast("Nhập email trước đã", "danger");

    const bad = emails.filter((x) => !isEmail(x));
    if (bad.length) {
      return toast(
        `Email sai: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? "..." : ""}`,
        "danger",
      );
    }

    try {
      for (const email of emails) {
        await api(API.listMembers(currentListId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
      }
      toast(`Added ${emails.length} emails`);
      if (emailsInput) emailsInput.value = "";
      await loadLists(true);
    } catch (e) {
      toast(e.message, "danger");
    }
  }

  function bindLists() {
    btnCreateList?.addEventListener("click", createList);
    btnAddEmails?.addEventListener("click", addEmailsBulk);
    listSelect?.addEventListener("change", syncListLauncher);
  }

  // ===== List Modal =====
  function modalOpen(open) {
    if (!listModal) return;
    listModal.style.display = open ? "block" : "none";
    listModal.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.style.overflow = open ? "hidden" : "";
  }

  function renderMembers(members) {
    if (!listMembersBody) return;
    if (!members || !members.length) {
      listMembersBody.innerHTML = `<tr><td colspan="2" class="muted">No emails in this list</td></tr>`;
      return;
    }

    listMembersBody.innerHTML = members
      .map(
        (m) => `
        <tr>
          <td>${m.email}</td>
          <td>
            <button class="btn small" data-act="edit" data-id="${m.subscriber_id}" data-email="${m.email}">Edit</button>
            <button class="btn small danger" data-act="del" data-id="${m.subscriber_id}">Delete</button>
          </td>
        </tr>
      `,
      )
      .join("");
  }

  async function loadMembers() {
    if (!currentListId) return;
    const data = await api(API.listMembers(currentListId));
    renderMembers(data.members || []);
  }

  function bindListModal() {
    if (!listModal || !btnOpenListModal) return;

    btnOpenListModal.addEventListener("click", async () => {
      if (!currentListId) return toast("Chọn list trước đã", "danger");
      syncListLauncher();
      modalOpen(true);
      try {
        await loadMembers();
      } catch (e) {
        toast(e.message, "danger");
      }
    });

    const close = () => modalOpen(false);
    listModalOverlay?.addEventListener("click", close);
    btnCloseListModal?.addEventListener("click", close);
    btnCloseListModal2?.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && listModal.style.display === "block") close();
    });

    btnRefreshMembers?.addEventListener("click", async () => {
      try {
        await loadMembers();
        toast("Refreshed");
      } catch (e) {
        toast(e.message, "danger");
      }
    });

    btnAddSingleEmail?.addEventListener("click", async () => {
      if (!currentListId) return toast("Chọn list trước đã", "danger");
      const email = normEmail(singleEmailInput?.value);
      if (!isEmail(email)) return toast("Email không hợp lệ", "danger");

      try {
        await api(API.listMembers(currentListId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (singleEmailInput) singleEmailInput.value = "";
        await loadMembers();
        await loadLists(true);
        toast("Added");
      } catch (e) {
        toast(e.message, "danger");
      }
    });

    listMembersBody?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn || !currentListId) return;

      const act = btn.getAttribute("data-act");
      const sid = btn.getAttribute("data-id");

      if (act === "del") {
        if (!confirm("Remove this email from list?")) return;
        try {
          await api(API.listMember(currentListId, sid), { method: "DELETE" });
          await loadMembers();
          await loadLists(true);
          toast("Removed");
        } catch (err) {
          toast(err.message, "danger");
        }
        return;
      }

      if (act === "edit") {
        const oldEmail = btn.getAttribute("data-email") || "";
        const nextEmail = normEmail(prompt("Edit email:", oldEmail));
        if (!nextEmail || nextEmail === normEmail(oldEmail)) return;
        if (!isEmail(nextEmail)) return toast("Email không hợp lệ", "danger");

        try {
          await api(API.listMember(currentListId, sid), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: nextEmail }),
          });
          await loadMembers();
          toast("Updated");
        } catch (err) {
          toast(err.message, "danger");
        }
      }
    });
  }

  // ===== Campaigns / Draft =====
  function getPayload() {
    return {
      list_id: listSelect?.value ? Number(listSelect.value) : null,
      title: String(title?.value || "").trim(),
      subject: String(subject?.value || "").trim(),
      from_name: String(fromName?.value || "").trim(),
      reply_to: String(replyTo?.value || "").trim() || null,
      html: String(htmlInput?.value || ""),
    };
  }

  function saveLocal(meta = {}) {
    const payload = {
      ...getPayload(),
      campaign_id: String(campaignId?.value || "").trim(),
      schedule_at: scheduleAt?.value || "",
      _meta: { ...meta, saved_at: new Date().toISOString() },
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearLocal() {
    localStorage.removeItem(LS_KEY);
  }

  async function createCampaign() {
    const p = getPayload();
    if (!p.title || !p.subject || !p.from_name || !p.html.trim()) {
      throw new Error("Thiếu fields (title/subject/from/html)");
    }
    // backend requires Gmail connected to create
    if (!gmailConnected) throw new Error("Gmail not connected");

    const resp = await api(API.campaigns, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: p.title,
        subject: p.subject,
        from_name: p.from_name,
        reply_to: p.reply_to,
        html: p.html,
      }),
    });

    if (resp.campaign_id && campaignId) campaignId.value = resp.campaign_id;
    return resp.campaign_id;
  }

  async function updateCampaign(id) {
    const p = getPayload();
    if (!p.title || !p.subject || !p.from_name || !p.html.trim()) {
      throw new Error("Thiếu fields (title/subject/from/html)");
    }

    await api(API.campaign(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: p.title,
        subject: p.subject,
        from_name: p.from_name,
        reply_to: p.reply_to,
        html: p.html,
      }),
    });
  }

  async function saveDraft() {
    try {
      let id = Number(String(campaignId?.value || "").trim());
      if (!id) id = await createCampaign(); // creates DRAFT row
      await updateCampaign(id); // updates content

      if (draftMeta)
        draftMeta.textContent = `Draft: saved (${new Date().toLocaleString()})`;
      saveLocal({ server: true, campaign_id: id });
      toast("Draft saved");
    } catch (e) {
      saveLocal({ server: false, reason: e.message });
      toast(e.message || "Save draft failed", "danger");
    }
  }

  async function createOrUpdateCampaign() {
    try {
      let id = Number(String(campaignId?.value || "").trim());
      if (!id) {
        id = await createCampaign();
        toast("Campaign created");
      } else {
        toast("Campaign updated");
      }
      await updateCampaign(id);
      saveLocal({ server: true, campaign_id: id });
    } catch (e) {
      toast(e.message || "Create/Update campaign failed", "danger");
    }
  }

  async function sendNow() {
    try {
      const id = Number(String(campaignId?.value || "").trim());
      const list_id = Number(String(listSelect?.value || "").trim());
      if (!id)
        return toast(
          "Campaign ID trống. Bấm Create Campaign/Save Draft trước.",
          "danger",
        );
      if (!list_id) return toast("Chọn list trước đã", "danger");

      await api(API.sendNow, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: id, list_id }),
      });

      toast("Send started");
      if (scheduleMeta)
        scheduleMeta.textContent = `Sent: ${new Date().toLocaleString()}`;
    } catch (e) {
      toast(e.message || "Send failed", "danger");
    }
  }

  async function schedule() {
    try {
      const id = Number(String(campaignId?.value || "").trim());
      const list_id = Number(String(listSelect?.value || "").trim());
      const scheduled_at = toSqlDatetime(scheduleAt?.value);

      if (!id)
        return toast(
          "Campaign ID trống. Bấm Create Campaign/Save Draft trước.",
          "danger",
        );
      if (!list_id) return toast("Chọn list trước đã", "danger");
      if (!scheduled_at)
        return toast("Chọn thời gian schedule hợp lệ", "danger");

      await api(API.schedule, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: id, list_id, scheduled_at }),
      });

      toast("Scheduled");
      if (scheduleMeta)
        scheduleMeta.textContent = `Scheduled at: ${scheduled_at}`;
    } catch (e) {
      toast(e.message || "Schedule failed", "danger");
    }
  }

  function newDraft() {
    if (!confirm("New Draft? (Xoá nội dung đang soạn)")) return;

    const keepList = listSelect?.value || "";

    if (title) title.value = "";
    if (subject) subject.value = "";
    if (fromName) fromName.value = "";
    if (replyTo) replyTo.value = "";
    if (htmlInput) htmlInput.value = "";
    if (campaignId) campaignId.value = "";
    if (scheduleAt) scheduleAt.value = "";

    if (listSelect) listSelect.value = keepList;
    syncListLauncher();

    clearLocal();
    if (draftMeta) draftMeta.textContent = "Draft: not saved yet";
    if (scheduleMeta) scheduleMeta.textContent = "";
    refreshPreviewNow();
    toast("New draft ready");
  }

  function bindCampaignUI() {
    btnSaveDraft?.addEventListener("click", saveDraft);
    btnNewDraft?.addEventListener("click", newDraft);
    btnCreateCampaign?.addEventListener("click", createOrUpdateCampaign);
    btnSendNow?.addEventListener("click", sendNow);
    btnSchedule?.addEventListener("click", schedule);
  }

  // ===== Preview =====
  function refreshPreviewNow() {
    if (!previewFrame) return;
    const html = String(htmlInput?.value || "");
    previewFrame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreviewNow, 250);
  }

  function bindPreview() {
    htmlInput?.addEventListener("input", schedulePreview);
    btnPreviewRefresh?.addEventListener("click", refreshPreviewNow);

    btnPreviewPop?.addEventListener("click", () => {
      const html = String(htmlInput?.value || "");
      const win = window.open("", "_blank");
      if (!win) return toast("Popup bị chặn 🥲", "danger");
      win.document.open();
      win.document.write(html || "<p>(empty)</p>");
      win.document.close();
    });

    refreshPreviewNow();
  }

  // ===== Restore local draft quietly =====
  function restoreLocalIfEmpty() {
    const d = loadLocal();
    if (!d) return;

    const hasTyped =
      (title && title.value) ||
      (subject && subject.value) ||
      (fromName && fromName.value) ||
      (replyTo && replyTo.value) ||
      (htmlInput && htmlInput.value);

    if (hasTyped) return;

    if (listSelect && d.list_id) listSelect.value = String(d.list_id);
    if (title) title.value = d.title || "";
    if (subject) subject.value = d.subject || "";
    if (fromName) fromName.value = d.from_name || "";
    if (replyTo) replyTo.value = d.reply_to || "";
    if (htmlInput) htmlInput.value = d.html || "";
    if (campaignId) campaignId.value = d.campaign_id || "";
    if (scheduleAt) scheduleAt.value = d.schedule_at || "";

    syncListLauncher();
    refreshPreviewNow();

    const t = d?._meta?.saved_at
      ? new Date(d._meta.saved_at).toLocaleString()
      : "unknown";
    if (draftMeta) draftMeta.textContent = `Draft: restored from local (${t})`;
  }

  // ===== Init =====
  async function init() {
    bindGmail();
    bindLists();
    bindListModal();
    bindCampaignUI();
    bindPreview();

    await loadGmailStatus();

    try {
      await loadLists(false);
    } catch (e) {
      console.error(e);
    }

    restoreLocalIfEmpty();
  }

  init();
})();
