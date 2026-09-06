
  const siteLogo = (site, index) => {
    const initials = (site.name || site.slug || "??").slice(0, 2).toUpperCase();
    const cls = logoClasses[index % logoClasses.length];
    return `<div class="site-logo ${cls}">${escapeHtml(initials)}</div>`;
  };
