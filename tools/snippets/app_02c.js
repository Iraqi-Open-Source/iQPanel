
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
