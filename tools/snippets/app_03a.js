
  const emptyRow = (text) => `<div class="data-row empty-row"><span>${escapeHtml(text)}</span></div>`;

  const refreshDashboard = async () => {
    const dashboard = await api("/api/dashboard");
    state.dashboard = dashboard;
    renderSites(dashboard.sites || []);
    renderMetrics(dashboard.server || {}, dashboard.sites || []);
    renderActivity(dashboard.activity || []);
    renderServiceHealth(dashboard.server || {});
    updateSidebarAgent(dashboard.server || {});
    renderSettings();
    renderOverviewDate();
    populateSiteSelects();
    if (state.currentView === "deployments") await loadDeployments();
    if (state.currentView === "databases") await loadDatabases();
    if (state.currentView === "backups") await loadBackups();
    if (state.currentView === "services") await loadServices();
    if (state.currentView === "logs") await loadLogsView();
    if (state.currentView === "cron") await loadCron();
  };
