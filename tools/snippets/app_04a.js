
  const populateSiteSelects = () => {
    const options = state.sites.map((site) => `<option value="${escapeHtml(site.slug)}">${escapeHtml(site.name)}</option>`).join("");
    const dbSelect = $("#database-site-select");
    const cronSelect = $("#cron-site-select");
    const servicesSelect = $("#services-site-select");
    const logsSelect = $("#logs-site-select");
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
