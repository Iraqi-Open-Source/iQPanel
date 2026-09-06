
  const showView = async (view) => {
    state.currentView = view;
    $$(".view").forEach((item) => item.classList.remove("active"));
    document.getElementById(view + "-view")?.classList.add("active");
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    $("#breadcrumb").textContent = view.charAt(0).toUpperCase() + view.slice(1);
    if (view === "deployments") await loadDeployments();
    if (view === "databases") await loadDatabases();
    if (view === "backups") await loadBackups();
    if (view === "services") await loadServices();
    if (view === "logs") await loadLogsView();
    if (view === "cron") await loadCron();
    if (view === "settings") renderSettings();
    if (view !== "logs") stopLogsStream();
  };

  const logout = async () => {
    try { await api("/api/logout", { method: "POST" }); } catch { /* ignore */ }
    state.authenticated = false;
    showLogin();
  };

  const initSession = async () => {
    const session = await fetchSession();
    state.authRequired = Boolean(session.body.auth_required);
    state.authenticated = session.ok && session.body.authenticated;
    if (state.authRequired && !state.authenticated) {
      showLogin();
      return;
    }
    showApp();
    await refreshDashboard();
  };

  const bindEvents = () => {
    $$("[data-view], [data-view-link]").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.view || button.dataset.viewLink));
    });

    $$("[data-open-modal]").forEach((button) => {
      button.addEventListener("click", () => openModal(button.dataset.openModal));
    });

    $$("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModals));
    modals().forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) closeModals(); }));

    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = new FormData(event.currentTarget).get("password");
      const errorEl = $("#login-error");
      try {
        await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
        state.authenticated = true;
        errorEl.hidden = true;
        showApp();
        await refreshDashboard();
      } catch (error) {
        errorEl.textContent = error.body?.error || error.message;
        errorEl.hidden = false;
      }
    });

    ["#logout-button", "#logout-button-top", "#settings-logout"].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener("click", logout);
    });

    $("#site-search")?.addEventListener("input", applySiteFilter);
    $("#site-filter-tabs")?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter]");
      if (!button) return;
      state.siteFilter = button.dataset.filter;
      $$("#site-filter-tabs button").forEach((item) => item.classList.toggle("selected", item === button));
      applySiteFilter();
    });

    document.getElementById("full-site-list")?.addEventListener("click", async (event) => {
      const actionBtn = event.target.closest("[data-site-action]");
      if (!actionBtn) return;
      await runSiteAction(actionBtn.dataset.siteAction, actionBtn.dataset.slug);
    });

    $("#services-site-select")?.addEventListener("change", async (event) => {
      state.servicesSiteSlug = event.target.value;
      await loadServices();
    });

    $("#create-service-button")?.addEventListener("click", async () => {
      const slug = state.servicesSiteSlug || $("#services-site-select")?.value;
      if (!slug) return;
      await api(`/api/sites/${encodeURIComponent(slug)}/services`, { method: "POST", body: JSON.stringify({ template: "laravel-queue" }) });
      showToast("Service created");
      await loadServices();
    });

    $("#services-list")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-svc-action]");
      if (!button) return;
      const { svcAction: action, slug, id } = button.dataset;
      if (action === "delete") {
        await api(`/api/sites/${encodeURIComponent(slug)}/services/${encodeURIComponent(id)}`, { method: "DELETE" });
      } else {
        await api(`/api/sites/${encodeURIComponent(slug)}/services/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      }
      showToast("Service updated");
      await loadServices();
    });

    $("#logs-site-select")?.addEventListener("change", loadLogsView);
    $("#logs-file-select")?.addEventListener("change", loadLogsView);
    $("#logs-refresh")?.addEventListener("click", loadLogsView);
    $("#logs-stream-toggle")?.addEventListener("change", (event) => {
      if (event.target.checked) startLogsStream();
      else loadLogSnapshot();
    });

    $("#databases-list")?.addEventListener("click", async (event) => {
      const dump = event.target.closest("[data-db-dump]");
      const del = event.target.closest("[data-db-delete]");
      if (dump) {
        await api(`/api/databases/${encodeURIComponent(dump.dataset.dbDump)}/dump`, { method: "POST" });
        showToast("Database dump queued");
        return;
      }
      if (del) {
        if (!window.confirm("Remove database record from panel?")) return;
        await api(`/api/databases/${encodeURIComponent(del.dataset.dbDelete)}`, { method: "DELETE" });
        showToast("Database deleted");
        await loadDatabases();
      }
    });

    $("#cron-list")?.addEventListener("click", async (event) => {
      const toggle = event.target.closest("[data-cron-toggle]");
      const del = event.target.closest("[data-cron-delete]");
      if (toggle) {
        const job = state.cronJobs.find((item) => item.id === toggle.dataset.cronToggle);
        if (!job) return;
        await api(`/api/cron/${encodeURIComponent(job.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: !job.enabled }) });
        await loadCron();
        return;
      }
      if (del) {
        await api(`/api/cron/${encodeURIComponent(del.dataset.cronDelete)}`, { method: "DELETE" });
        showToast("Cron job deleted");
        await loadCron();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeModals();
    });
  };

  bindSiteModal();
  bindDataModals();
  bindEvents();
  initSession();
})();
