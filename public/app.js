(() => {
  const state = {
    dashboard: null,
    sites: [],
    authRequired: false,
    authenticated: false,
    currentView: "overview",
    siteFilter: "all",
    pendingSiteSlug: "",
    servicesSiteSlug: "",
    logsStream: null,
    cronJobs: [],
    databases: [],
    filesPath: ".",
    selectedFile: "",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const showToast = (message) => {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3500);
  };

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: "include",
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (response.status === 401 && state.authenticated && !path.endsWith("/api/session")) {
      state.authenticated = false;
      showLogin();
    }
    if (!response.ok) {
      const error = new Error(body?.error || response.statusText || "Request failed");
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  };

  const fetchSession = async () => {
    const response = await fetch("/api/session", { credentials: "include" });
    let body = {};
    try { body = await response.json(); } catch { body = {}; }
    return { ok: response.ok, status: response.status, body };
  };

  const showLogin = () => {
    $("#login-screen").hidden = false;
    $("#app-shell").hidden = true;
    $("#login-error").hidden = true;
  };

  const showApp = () => {
    $("#login-screen").hidden = true;
    $("#app-shell").hidden = false;
  };

  const typeLabel = (type) => ({ php: "PHP / Laravel", node: "Node.js", python: "Python", static: "Static site" }[type] || type);
  const logoClasses = ["logo-green", "logo-purple", "logo-orange", "logo-blue"];

  const formatWhen = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const diff = Date.now() - date.getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m";
    const hours = Math.round(mins / 60);
    if (hours < 48) return hours + "h";
    return date.toLocaleDateString();
  };

  const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const siteLogo = (site, index) => {
    const initials = (site.name || site.slug || "??").slice(0, 2).toUpperCase();
    const cls = logoClasses[index % logoClasses.length];
    return `<div class="site-logo ${cls}">${escapeHtml(initials)}</div>`;
  };

  const siteRowMarkup = (site, index) => {
    const repo = site.repo_url || site.repo || "";
    const port = site.port ? ":" + site.port : "";
    const status = site.status || "online";
    return `<div class="site-row" data-site-slug="${escapeHtml(site.slug)}">${siteLogo(site, index)}<div class="site-meta"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(typeLabel(site.type))} · <code>${escapeHtml(repo)}</code></small></div><span class="site-port">${escapeHtml(String(port))}</span><span class="status">${escapeHtml(status)}</span></div>`;
  };

  const siteCardMarkup = (site, index) => {
    const repo = site.repo_url || site.repo || "";
    const port = site.port ? String(site.port) : "—";
    const status = site.status || "online";
    return `<article class="full-site-card" data-site-slug="${escapeHtml(site.slug)}" data-site-name="${escapeHtml((site.name || "").toLowerCase())}" data-status="${escapeHtml(status)}" data-config="${escapeHtml(site.config_status || "")}"><div class="site-card-top">${siteLogo(site, index)}<div class="site-meta"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(typeLabel(site.type))}</small></div><span class="status">${escapeHtml(status)}</span></div><div class="site-card-details"><div><span>Repository</span><b>${escapeHtml(repo)}</b></div><div><span>Port</span><b>${escapeHtml(port)}</b></div></div><div class="site-card-actions"><button type="button" class="secondary-button" data-site-action="deploy" data-slug="${escapeHtml(site.slug)}">Deploy</button><button type="button" class="secondary-button" data-site-action="backup" data-slug="${escapeHtml(site.slug)}">Backup</button><button type="button" class="secondary-button" data-site-action="config" data-slug="${escapeHtml(site.slug)}">Apply config</button><button type="button" class="secondary-button" data-site-action="delete" data-slug="${escapeHtml(site.slug)}">Delete</button></div></article>`;
  };

  const renderSites = (sites) => {
    state.sites = sites;
    const list = $("#site-list");
    const full = $("#full-site-list");
    if (!sites.length) {
      list.innerHTML = '<p class="empty-inline">No sites yet. Create one to get started.</p>';
      full.innerHTML = '<p class="empty-inline">No sites yet.</p>';
      $("#nav-sites-count").textContent = "";
      return;
    }
    list.innerHTML = sites.map((site, index) => siteRowMarkup(site, index)).join("");
    full.innerHTML = sites.map((site, index) => siteCardMarkup(site, index)).join("");
    $("#nav-sites-count").textContent = String(sites.length);
    applySiteFilter();
  };

  const applySiteFilter = () => {
    const query = ($("#site-search")?.value || "").toLowerCase();
    $$(".full-site-card").forEach((card) => {
      const name = card.dataset.siteName || "";
      const status = card.dataset.status || "";
      const config = card.dataset.config || "";
      let visible = name.includes(query);
      if (state.siteFilter === "online") visible = visible && status === "online";
      if (state.siteFilter === "attention") visible = visible && (status !== "online" || (config && config !== "applied"));
      card.hidden = !visible;
    });
  };

  const renderMetrics = (server, sites) => {
    const online = sites.filter((s) => s.status === "online").length;
    const total = sites.length || 0;
    const cpu = server?.cpu ?? 0;
    const memory = server?.memory ?? 0;
    const disk = server?.disk ?? 0;
    const load = server?.load ?? 0;
    $("#metric-grid").innerHTML = `<article class="metric-card accent-cyan"><div class="metric-top"><span>Sites online</span><span class="metric-icon">⌘</span></div><strong>${online} <small>/ ${total}</small></strong><div class="metric-foot"><span class="up">Live</span> from panel store</div></article><article class="metric-card accent-lime"><div class="metric-top"><span>CPU usage</span><span class="metric-icon">◒</span></div><strong>${cpu}<span class="unit">%</span></strong><div class="meter"><i style="width:${cpu}%"></i></div><div class="metric-foot">load <b>${load}</b></div></article><article class="metric-card accent-violet"><div class="metric-top"><span>Memory</span><span class="metric-icon">▤</span></div><strong>${memory}<span class="unit">%</span></strong><div class="meter violet"><i style="width:${memory}%"></i></div><div class="metric-foot">host memory pressure</div></article><article class="metric-card accent-orange"><div class="metric-top"><span>Disk space</span><span class="metric-icon">◫</span></div><strong>${disk}<span class="unit">%</span></strong><div class="meter orange"><i style="width:${disk}%"></i></div><div class="metric-foot">root filesystem</div></article>`;
  };

  const activityTone = (action) => {
    const key = String(action || "").toLowerCase();
    if (key.includes("deploy")) return ["green", "↗"];
    if (key.includes("database")) return ["purple", "◉"];
    if (key.includes("backup")) return ["orange", "↻"];
    return ["blue", "⚙"];
  };

  const renderActivity = (items) => {
    const list = $("#activity-list");
    if (!items?.length) {
      list.innerHTML = '<p class="empty-inline">No activity recorded yet.</p>';
      return;
    }
    list.innerHTML = items.map((item) => {
      const [tone, glyph] = activityTone(item.action);
      const details = item.details ? ` · <code>${escapeHtml(item.details)}</code>` : "";
      return `<div class="activity-item"><span class="activity-icon ${tone}">${glyph}</span><div><strong>${escapeHtml(item.action)}</strong><p>${escapeHtml(item.target)}${details}</p></div><time>${formatWhen(item.created_at)}</time></div>`;
    }).join("");
  };

  const renderServiceHealth = (server) => {
    const services = server?.services || {};
    const entries = Object.entries(services);
    const container = $("#service-health");
    if (!entries.length) {
      container.innerHTML = '<p class="empty-inline">Service status unavailable.</p>';
      $("#health-badge").hidden = true;
      return;
    }
    const healthy = entries.every(([, value]) => String(value).toLowerCase() === "active");
    $("#health-badge").hidden = !healthy;
    container.innerHTML = entries.map(([name, value]) => {
      const ok = String(value).toLowerCase() === "active";
      return `<div><span class="health-check">${ok ? "✓" : "!"}</span><span><strong>${escapeHtml(name.replace(/_/g, " "))}</strong><small>${escapeHtml(String(value))}</small></span><b>${ok ? "Running" : "Check"}</b></div>`;
    }).join("");
  };

  const updateSidebarAgent = (server) => {
    const online = server?.agent === "online";
    $("#sidebar-agent-label").textContent = online ? "Agent online" : "Agent offline";
    $("#sidebar-agent-meta").textContent = "Mode: " + (server?.agent_mode || "local");
    $("#server-label").textContent = online ? "Connected" : "Disconnected";
    const dot = $("#sidebar-agent-dot");
    if (dot) dot.style.background = online ? "var(--lime)" : "var(--red)";
  };

  const renderSettings = () => {
    const server = state.dashboard?.server || {};
    $("#settings-agent-mode").textContent = server.agent_mode || "local";
    $("#settings-agent-status").textContent = server.agent || "unknown";
    $("#settings-data-root").textContent = server.data_root || state.dashboard?.data_root || "—";
    $("#settings-auth").textContent = state.authRequired ? "Password required" : "Open (no password set)";
  };

  const renderOverviewDate = () => {
    const stamp = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    $("#overview-date").innerHTML = stamp.toUpperCase() + ' <span class="live-label"><i></i>LIVE</span>';
    const sub = $("#overview-subheading");
    if (sub) sub.textContent = state.sites.length ? "Your server dashboard is up to date." : "Create a site to start deploying.";
  };

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
    if (state.currentView === "files") await loadFiles();
  };

  const loadDeployments = async () => {
    const items = await api("/api/deployments");
    const list = $("#deployments-list");
    if (!items.length) {
      list.innerHTML = emptyRow("No deployments yet.");
      return;
    }
    list.innerHTML = items.map((item) => `<div class="data-row"><span>${escapeHtml(item.site_name || "Site")}</span><span class="badge ${item.status === "succeeded" ? "badge-ok" : item.status === "failed" ? "badge-warn" : ""}">${escapeHtml(item.status || "queued")}</span><code>${escapeHtml(item.log || "")}</code><time>${formatWhen(item.created_at)}</time></div>`).join("");
  };
  window.loadDeployments = loadDeployments;

  const loadDatabases = async () => {
    const items = await api("/api/databases");
    state.databases = items;
    const list = $("#databases-list");
    if (!items.length) {
      list.innerHTML = emptyRow("No databases yet.");
      return;
    }
    list.innerHTML = items.map((db) => `<div class="data-row"><span><strong>${escapeHtml(db.db_name)}</strong><small>${escapeHtml(db.engine)} · ${escapeHtml(db.db_user)}</small></span><div class="row-actions"><button type="button" class="secondary-button" data-db-dump="${escapeHtml(db.id)}">Dump</button><button type="button" class="secondary-button" data-db-delete="${escapeHtml(db.id)}">Delete</button></div></div>`).join("");
  };

  const loadBackups = async () => {
    const items = await api("/api/backups");
    const list = $("#backups-list");
    if (!items.length) {
      list.innerHTML = emptyRow("No backups recorded yet.");
      return;
    }
    list.innerHTML = items.map((item) => `<div class="data-row"><span><strong>${escapeHtml(item.path || item.id)}</strong><small>${escapeHtml(item.site_id || "")}</small></span><span>${escapeHtml(item.size || "")}</span><time>${formatWhen(item.created_at)}</time></div>`).join("");
  };

  const populateSiteSelects = () => {
    const options = state.sites.map((site) => `<option value="${escapeHtml(site.slug)}">${escapeHtml(site.name)}</option>`).join("");
    const dbSelect = $("#database-site-select");
    const cronSelect = $("#cron-site-select");
    const servicesSelect = $("#services-site-select");
    const logsSelect = $("#logs-site-select");
    const filesSelect = $("#files-site-select");
    if (dbSelect) dbSelect.innerHTML = options;
    if (cronSelect) cronSelect.innerHTML = '<option value="">Server-wide</option>' + options;
    if (servicesSelect) {
      servicesSelect.innerHTML = options;
      if (!state.servicesSiteSlug && state.sites[0]) state.servicesSiteSlug = state.sites[0].slug;
      if (state.servicesSiteSlug) servicesSelect.value = state.servicesSiteSlug;
      $("#create-service-button").disabled = !state.servicesSiteSlug;
    }
    if (logsSelect) {
      logsSelect.innerHTML = options;
      if (state.sites[0]) logsSelect.value = state.sites[0].slug;
    }
    if (filesSelect) {
      filesSelect.innerHTML = options;
      if (state.sites[0]) filesSelect.value = filesSelect.value || state.sites[0].slug;
    }
  };

  const loadServices = async () => {
    const slug = state.servicesSiteSlug || $("#services-site-select")?.value;
    if (!slug) {
      $("#services-list").innerHTML = emptyRow("Select a site with services.");
      return;
    }
    state.servicesSiteSlug = slug;
    const items = await api(`/api/sites/${encodeURIComponent(slug)}/services`);
    const list = $("#services-list");
    if (!items.length) {
      list.innerHTML = emptyRow("No systemd services for this site.");
      return;
    }
    list.innerHTML = items.map((svc) => `<div class="data-row"><span><strong>${escapeHtml(svc.unit_name)}</strong><small>${escapeHtml(svc.template)}</small></span><span class="badge ${svc.status === "running" ? "badge-ok" : "badge-warn"}">${escapeHtml(svc.status)}</span><div class="row-actions"><button type="button" class="secondary-button" data-svc-action="start" data-slug="${escapeHtml(slug)}" data-id="${escapeHtml(svc.id)}">Start</button><button type="button" class="secondary-button" data-svc-action="stop" data-slug="${escapeHtml(slug)}" data-id="${escapeHtml(svc.id)}">Stop</button><button type="button" class="secondary-button" data-svc-action="restart" data-slug="${escapeHtml(slug)}" data-id="${escapeHtml(svc.id)}">Restart</button><button type="button" class="secondary-button" data-svc-action="delete" data-slug="${escapeHtml(slug)}" data-id="${escapeHtml(svc.id)}">Delete</button></div></div>`).join("");
  };

  const stopLogsStream = () => {
    if (state.logsStream) {
      state.logsStream.close();
      state.logsStream = null;
    }
  };

  const loadLogFiles = async () => {
    const slug = $("#logs-site-select")?.value;
    const fileSelect = $("#logs-file-select");
    if (!slug) return;
    const files = await api(`/api/sites/${encodeURIComponent(slug)}/logs`);
    const list = Array.isArray(files) ? files : [];
    fileSelect.innerHTML = list.map((item) => {
      const name = typeof item === "string" ? item : item.name;
      return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    }).join("");
  };

  const loadLogSnapshot = async () => {
    stopLogsStream();
    const slug = $("#logs-site-select")?.value;
    const file = $("#logs-file-select")?.value;
    if (!slug || !file) {
      $("#logs-output").textContent = "";
      return;
    }
    const result = await api(`/api/sites/${encodeURIComponent(slug)}/logs/${encodeURIComponent(file)}`);
    $("#logs-output").textContent = result.text || "";
  };

  const startLogsStream = () => {
    stopLogsStream();
    const slug = $("#logs-site-select")?.value;
    const file = $("#logs-file-select")?.value;
    if (!slug || !file) return;
    const source = new EventSource(`/api/sites/${encodeURIComponent(slug)}/logs/${encodeURIComponent(file)}/stream`);
    state.logsStream = source;
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const output = $("#logs-output");
        output.textContent += payload.chunk || "";
        output.scrollTop = output.scrollHeight;
      } catch {
        /* ignore malformed chunks */
      }
    };
    source.onerror = () => {
      stopLogsStream();
      $("#logs-stream-toggle").checked = false;
    };
  };

  const loadLogsView = async () => {
    await loadLogFiles();
    if ($("#logs-stream-toggle")?.checked) startLogsStream();
    else await loadLogSnapshot();
  };

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

  const loadFiles = async () => {
    const slug = $("#files-site-select")?.value;
    const relative = $("#files-path")?.value || ".";
    if (!slug) return;
    state.filesPath = relative;
    const result = await api(`/api/sites/${encodeURIComponent(slug)}/files?path=${encodeURIComponent(relative)}`);
    $("#files-list").innerHTML = (result.entries || []).map((entry) => `<div class="data-row"><button type="button" class="text-button" data-file-name="${escapeHtml(entry.name)}" data-file-type="${escapeHtml(entry.type)}">${entry.type === "directory" ? "□" : "▤"} ${escapeHtml(entry.name)}</button><small>${escapeHtml(String(entry.size))} bytes</small><div class="row-actions"><button type="button" class="secondary-button" data-file-action="rename" data-file-name="${escapeHtml(entry.name)}">Rename</button>${entry.type === "file" ? `<button type="button" class="secondary-button" data-file-action="download" data-file-name="${escapeHtml(entry.name)}">Download</button>` : ""}<button type="button" class="secondary-button" data-file-action="delete" data-file-name="${escapeHtml(entry.name)}">Delete</button></div></div>`).join("") || emptyRow("Directory is empty.");
  };

  const filePathFor = (name) => state.filesPath === "." ? name : `${state.filesPath.replace(/\/$/, "")}/${name}`;

  const selectFile = async (name, type) => {
    const slug = $("#files-site-select")?.value;
    if (!slug) return;
    const filePath = filePathFor(name);
    if (type === "directory") {
      $("#files-path").value = filePath;
      await loadFiles();
      return;
    }
    const result = await api(`/api/sites/${encodeURIComponent(slug)}/files/content?path=${encodeURIComponent(filePath)}`);
    state.selectedFile = filePath;
    $("#file-editor-title").textContent = filePath;
    $("#file-editor").value = result.content || "";
    $("#file-editor").disabled = false;
    $("#file-save").disabled = false;
  };

  const loadPackageOptions = async () => {
    const select = $("#service-package-select");
    if (!select) return;
    const result = await api("/api/system/packages");
    select.innerHTML = '<option value="">Install package…</option>' + (result.packages || []).map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  };

  const loadAlertSettings = async () => {
    const form = $("#alerts-form");
    if (!form) return;
    const [alerts, settings] = await Promise.all([api("/api/alerts"), api("/api/settings")]);
    form.elements.cpu.value = alerts.thresholds?.cpu || 90;
    form.elements.memory.value = alerts.thresholds?.memory || 90;
    form.elements.disk.value = alerts.thresholds?.disk || 90;
    form.elements.cooldown_minutes.value = alerts.cooldown_minutes || 60;
    form.elements.telegram_chat_id.value = settings.telegram_chat_id || "";
    $("#alerts-status").textContent = `${alerts.discord_configured ? "Discord" : "No Discord"} · ${alerts.telegram_configured ? "Telegram" : "No Telegram"}`;
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

  const modals = () => $$(".modal-backdrop");

  const openModal = (id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (id === "site-modal") resetSiteModal();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modal.querySelector("input,select,button")?.focus();
  };

  const closeModals = () => {
    modals().forEach((modal) => { modal.hidden = true; });
    document.body.style.overflow = "";
  };

  const resetSiteModal = () => {
    $("#new-site-form").reset();
    $("#new-site-form").hidden = false;
    $("#deploy-success").hidden = true;
    $("#site-modal-eyebrow").textContent = "NEW SITE / STEP 1 OF 3";
    $("#site-modal-kicker").innerHTML = '<span class="step-dot active"></span><span></span><span class="step-dot"></span><span></span><span class="step-dot"></span>';
    state.pendingSiteSlug = "";
  };

  const bindSiteModal = () => {
    $("#new-site-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Generating key…";
      try {
        const result = await api("/api/sites", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) });
        state.pendingSiteSlug = result.slug;
        $("#deploy-key").textContent = result.deploy_key_public;
        $("#new-site-form").hidden = true;
        $("#site-modal-kicker").innerHTML = '<span class="step-dot active"></span><span></span><span class="step-dot active"></span><span></span><span class="step-dot"></span>';
        $("#site-modal-eyebrow").textContent = "NEW SITE / STEP 2 OF 3";
        $("#deploy-success").hidden = false;
        showToast("Deploy key generated");
      } catch (error) {
        showToast(error.message);
      } finally {
        submit.disabled = false;
        submit.innerHTML = 'Generate deploy key <span>→</span>';
      }
    });

    $("#copy-key").addEventListener("click", async () => {
      const key = $("#deploy-key").textContent;
      try { await navigator.clipboard.writeText(key); } catch { /* clipboard may be unavailable */ }
      const button = $("#copy-key");
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy"; }, 1500);
    });

    $("#finish-site").addEventListener("click", async () => {
      closeModals();
      if (!state.pendingSiteSlug) return;
      try {
        const result = await api(`/api/sites/${encodeURIComponent(state.pendingSiteSlug)}/deploy`, { method: "POST" });
        showToast(result.status === "queued" ? "Clone job queued" : "Deployment requested");
      } catch (error) {
        showToast(error.message);
      }
      await refreshDashboard();
    });
  };

  const bindDataModals = () => {
    $("#database-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      try {
        const result = await api("/api/databases", { method: "POST", body: JSON.stringify(payload) });
        closeModals();
        showToast(`Database ${result.db_name} ready`);
        if (result.password) showToast("Password: " + result.password);
        await refreshDashboard();
        if (state.currentView === "databases") await loadDatabases();
      } catch (error) {
        showToast(error.message);
      }
    });

    $("#cron-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      payload.enabled = form.get("enabled") === "on";
      payload.escalate = form.get("escalate") === "on";
      if (!payload.site_slug) delete payload.site_slug;
      if (!payload.run_as_user) delete payload.run_as_user;
      try {
        await api("/api/cron", { method: "POST", body: JSON.stringify(payload) });
        closeModals();
        event.currentTarget.reset();
        showToast("Cron job saved");
        await loadCron();
      } catch (error) {
        showToast(error.message);
      }
    });
  };

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
    if (view === "files") await loadFiles();
    if (view === "services") loadPackageOptions().catch(() => {});
    if (view === "settings") loadAlertSettings().catch(() => {});
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
      const form = new FormData(event.currentTarget);
      const password = form.get("password");
      const email = form.get("email");
      const totp = form.get("totp");
      const errorEl = $("#login-error");
      try {
        await api("/api/login", { method: "POST", body: JSON.stringify({ password, email: email || undefined, totp: totp || undefined }) });
        state.authenticated = true;
        errorEl.hidden = true;
        showApp();
        await refreshDashboard();
      } catch (error) {
        if (error.body?.totp_required) {
          $("#login-totp-label").hidden = false;
        }
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

    $("#files-site-select")?.addEventListener("change", loadFiles);
    $("#files-path")?.addEventListener("change", loadFiles);
    $("#files-refresh")?.addEventListener("click", loadFiles);
    $("#files-list")?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-file-action]");
      if (action) {
        const slug = $("#files-site-select")?.value;
        const filePath = filePathFor(action.dataset.fileName);
        if (action.dataset.fileAction === "download") {
          window.open(`/api/sites/${encodeURIComponent(slug)}/files/download?path=${encodeURIComponent(filePath)}`, "_blank", "noopener");
          return;
        }
        if (action.dataset.fileAction === "delete") {
          if (!window.confirm(`Delete ${filePath}?`)) return;
          await api(`/api/sites/${encodeURIComponent(slug)}/files`, { method: "PUT", body: JSON.stringify({ action: "delete", path: filePath }) });
          showToast("File deleted");
          await loadFiles();
          return;
        }
        const nextName = window.prompt("New file or directory name", action.dataset.fileName);
        if (!nextName || /[\\/]/.test(nextName)) return;
        await api(`/api/sites/${encodeURIComponent(slug)}/files`, { method: "PUT", body: JSON.stringify({ action: "rename", path: filePath, target: filePathFor(nextName) }) });
        showToast("Renamed");
        await loadFiles();
        return;
      }
      const item = event.target.closest("[data-file-name]");
      if (item) await selectFile(item.dataset.fileName, item.dataset.fileType);
    });
    $("#file-save")?.addEventListener("click", async () => {
      const slug = $("#files-site-select").value;
      await api(`/api/sites/${encodeURIComponent(slug)}/files`, { method: "POST", body: JSON.stringify({ path: state.selectedFile, content: $("#file-editor").value }) });
      showToast("File saved");
    });
    $("#files-upload")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      const slug = $("#files-site-select")?.value;
      if (!file || !slug) return;
      const path = state.filesPath === "." ? file.name : `${state.filesPath.replace(/\/$/, "")}/${file.name}`;
      await api(`/api/sites/${encodeURIComponent(slug)}/files`, { method: "POST", body: JSON.stringify({ path, content: await file.text() }) });
      event.target.value = "";
      showToast("File uploaded");
      await loadFiles();
    });
    $("#wordpress-output")?.parentElement.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-wp-action]");
      const slug = $("#files-site-select")?.value;
      if (!button || !slug) return;
      const action = button.dataset.wpAction;
      let result;
      if (action === "install") {
        const input = {
          url: window.prompt("WordPress URL", "https://example.com"),
          title: window.prompt("Site title", "WordPress site"),
          admin_user: window.prompt("Admin username", "admin"),
          admin_password: window.prompt("Admin password"),
          admin_email: window.prompt("Admin email"),
          db_name: window.prompt("Database name"),
          db_user: window.prompt("Database user"),
          db_password: window.prompt("Database password"),
        };
        result = await api(`/api/sites/${encodeURIComponent(slug)}/wordpress/install`, { method: "POST", body: JSON.stringify(input) });
      } else if (action === "staging") {
        result = await api(`/api/sites/${encodeURIComponent(slug)}/wordpress/staging`, { method: "POST", body: JSON.stringify({ target_slug: window.prompt("Staging site slug", `${slug}-staging`) }) });
      } else if (action === "backup") {
        result = await api(`/api/sites/${encodeURIComponent(slug)}/wordpress/backup`, { method: "POST", body: "{}" });
      } else if (action === "restore") {
        result = await api(`/api/sites/${encodeURIComponent(slug)}/wordpress/restore`, { method: "POST", body: JSON.stringify({ path: window.prompt("Backup path") }) });
      } else if (["plugin_activate", "plugin_deactivate", "theme_activate", "theme_deactivate"].includes(action)) {
        result = await api(`/api/sites/${encodeURIComponent(slug)}/wordpress/${action}`, { method: "POST", body: JSON.stringify({ args: [window.prompt("Slug")] }) });
      } else {
        result = await api(`/api/sites/${encodeURIComponent(slug)}/wordpress/${action}`);
      }
      $("#wordpress-output").textContent = result.stdout || result.path || result.error || "No output";
    });
    $("#install-package-button")?.addEventListener("click", async () => {
      const packageName = $("#service-package-select")?.value;
      if (!packageName) return;
      await api("/api/system/packages/install", { method: "POST", body: JSON.stringify({ package: packageName }) });
      showToast("Package installation queued");
    });
    $("#alerts-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      await api("/api/alerts", { method: "PUT", body: JSON.stringify({ cpu: Number(values.cpu), memory: Number(values.memory), disk: Number(values.disk), cooldown_minutes: Number(values.cooldown_minutes), discord_webhook: values.discord_webhook || undefined }) });
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ telegram_bot_token: values.telegram_bot_token || undefined, telegram_chat_id: values.telegram_chat_id || undefined }) });
      showToast("Alert settings saved");
      await loadAlertSettings();
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
