
  const loadCron = async () => {
    const items = await api("/api/cron");
    state.cronJobs = items;
    const list = $("#cron-list");
    if (!items.length) {
      list.innerHTML = emptyRow("No cron jobs yet.");
      return;
    }
    list.innerHTML = items.map((job) => `<div class="data-row"><span><strong>${escapeHtml(job.schedule)}</strong><small>${escapeHtml(job.command)} · ${escapeHtml(job.run_as_user)}</small></span><span class="badge ${job.enabled ? "badge-ok" : "badge-warn"}">${job.enabled ? "Enabled" : "Disabled"}</span><div class="row-actions"><button type="button" class="secondary-button" data-cron-toggle="${escapeHtml(job.id)}">${job.enabled ? "Disable" : "Enable"}</button><button type="button" class="secondary-button" data-cron-delete="${escapeHtml(job.id)}">Delete</button></div></div>`).join("");
  };

  const runSiteAction = async (action, slug) => {
    if (action === "delete") {
      if (!window.confirm("Delete this site and its agent resources?")) return;
      await api(`/api/sites/${encodeURIComponent(slug)}`, { method: "DELETE" });
      showToast("Site deleted");
      await refreshDashboard();
      return;
    }
    const path = `/api/sites/${encodeURIComponent(slug)}/${action}`;
    const result = await api(path, { method: "POST" });
    showToast(result.status ? `Job ${result.status}` : "Request accepted");
    await refreshDashboard();
  };
