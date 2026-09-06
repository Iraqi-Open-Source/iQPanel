
  const siteRowMarkup = (site, index) => {
    const repo = site.repo_url || site.repo || "";
    const port = site.port ? ":" + site.port : "";
    const status = site.status || "online";
    return `<div class="site-row" data-site-slug="${escapeHtml(site.slug)}">${siteLogo(site, index)}<div class="site-meta"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(typeLabel(site.type))} · <code>${escapeHtml(repo)}</code></small></div><span class="site-port">${escapeHtml(String(port))}</span><span class="status">${escapeHtml(status)}</span></div>`;
  };
