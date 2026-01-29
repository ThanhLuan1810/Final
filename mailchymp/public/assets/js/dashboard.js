// assets/js/dashboard.js
(() => {
  const { $, api, showToast, escapeHtml, pct } = window.MC;

  async function ensureAuth() {
    const me = await api("/api/auth/me");
    if (!me.user) {
      location.href = "compose.html";
      return null;
    }
    $("miniSession").textContent = `Session: ${me.user.email}`;
    return me.user;
  }

  const tbody = $("tbody");
  const qEl = $("q");

  let currentCampaignId = null;

  async function loadCampaigns() {
    const q = encodeURIComponent(qEl.value.trim());
    const res = await api(
      `/api/dashboard/campaigns?search=${q}&status=SENT&limit=80&offset=0`,
    );

    tbody.innerHTML = "";
    (res.campaigns || []).forEach((c) => {
      const sent = Number(c.sent_count || 0);
      const failed = Number(c.failed_count || 0);
      const openedU = Number(c.opened_unique || 0);
      const clickedU = Number(c.clicked_unique || 0);

      const sentAtText = c.sent_at ? new Date(c.sent_at).toLocaleString() : "-";

      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.innerHTML = `
        <td class="mono">${c.id}</td>
        <td>
          <div style="font-weight:900">${escapeHtml(c.title || "")}</div>
          <div class="muted">${escapeHtml(c.subject || "")}</div>
        </td>
        <td>
          <div><b>${sent}</b> sent</div>
          <div class="muted">${failed} failed</div>
        </td>
        <td>
          <div><b>${openedU}</b> unique</div>
          <div class="muted">${pct(openedU, sent)}%</div>
        </td>
        <td>
          <div><b>${clickedU}</b> unique</div>
          <div class="muted">${pct(clickedU, sent)}%</div>
        </td>
        <td class="muted">${sentAtText}</td>
        <td class="muted">${c.updated_at ? new Date(c.updated_at).toLocaleString() : "-"}</td>
      `;
      tr.onclick = () => loadDetail(c.id);
      tbody.appendChild(tr);
    });
  }

  const detailHint = $("detailHint");
  const detail = $("detail");
  const logBody = $("logBody");
  const campInfo = $("campInfo");

  const kSent = $("kSent");
  const kFailed = $("kFailed");
  const kOpenedU = $("kOpenedU");
  const kOpenRate = $("kOpenRate");
  const kClickedU = $("kClickedU");
  const kClickRate = $("kClickRate");

  async function loadDetail(id) {
    try {
      currentCampaignId = id;
      const res = await api(`/api/dashboard/campaigns/${id}`);

      detailHint.style.display = "none";
      detail.style.display = "grid";

      const s = res.summary || {};
      const sent = Number(s.sent || 0);
      const failed = Number(s.failed || 0);
      const openedU = Number(s.opened_unique || 0);
      const clickedU = Number(s.clicked_unique || 0);

      kSent.textContent = sent;
      kFailed.textContent = failed;
      kOpenedU.textContent = openedU;
      kOpenRate.textContent = pct(openedU, sent) + "%";
      kClickedU.textContent = clickedU;
      kClickRate.textContent = pct(clickedU, sent) + "%";

      campInfo.textContent = JSON.stringify(
        {
          id: res.campaign.id,
          title: res.campaign.title,
          subject: res.campaign.subject,
          from: `${res.campaign.from_name} <${res.campaign.from_email}>`,
          status: res.campaign.status,
          scheduled_at: res.campaign.scheduled_at,
          created_at: res.campaign.created_at,
          updated_at: res.campaign.updated_at,
        },
        null,
        2,
      );

      logBody.innerHTML = "";
      (res.logs || []).forEach((l) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="mono">${escapeHtml(l.email || "")}</td>
          <td><span class="tag ${l.status}">${l.status}</span></td>
          <td>
            <div><b>${Number(l.open_count || 0)}</b></div>
            <div class="muted">${l.opened_at ? new Date(l.opened_at).toLocaleString() : "-"}</div>
          </td>
          <td>
            <div><b>${Number(l.click_count || 0)}</b></div>
            <div class="muted">${l.last_clicked_at ? new Date(l.last_clicked_at).toLocaleString() : "-"}</div>
          </td>
          <td class="muted">${l.sent_at ? new Date(l.sent_at).toLocaleString() : "-"}</td>
          <td class="muted">${escapeHtml(l.error || "")}</td>
        `;
        logBody.appendChild(tr);
      });
    } catch (e) {
      showToast(e.message || "Load detail failed", "bad", 3000);
    }
  }

  $("btnRefresh").onclick = () => loadCampaigns();

  (async () => {
    await ensureAuth();
    await loadCampaigns();
  })();
})();
