/**
 * Lightweight UI component helpers for the vanilla iQPanel dashboard.
 * Exposed as window.IQPanelUI for app.js and phase scripts.
 */
(() => {
  const LOGO_CLASSES = ['logo-green', 'logo-purple', 'logo-orange', 'logo-blue'];

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const attrs = (map = {}) => Object.entries(map)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => {
      if (value === true) return escapeHtml(key);
      return `${escapeHtml(key)}="${escapeHtml(value)}"`;
    })
    .join(' ');

  const button = ({
    variant = 'secondary',
    text,
    icon,
    type = 'button',
    className = '',
    ...rest
  }) => {
    const classes = {
      primary: 'primary-button',
      secondary: 'secondary-button',
      text: 'text-button',
      icon: 'icon-button',
    };
    const base = classes[variant] || classes.secondary;
    const iconMarkup = icon ? `<span>${escapeHtml(icon)}</span>` : '';
    return `<button type="${escapeHtml(type)}" class="${escapeHtml(`${base} ${className}`.trim())}" ${attrs(rest)}>${iconMarkup}${escapeHtml(text || '')}</button>`;
  };

  const badge = ({ text, tone = 'default' }) => {
    const toneClass = tone === 'ok' ? 'badge-ok' : tone === 'warn' ? 'badge-warn' : '';
    return `<span class="badge ${toneClass}">${escapeHtml(text)}</span>`;
  };

  const panelHeading = ({ title, description = '', actions = '' }) => `
    <div class="panel-heading">
      <div>
        <h2>${escapeHtml(title)}</h2>
        ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      </div>
      ${actions}
    </div>`;

  const emptyInline = (message) => `<p class="empty-inline">${escapeHtml(message)}</p>`;

  const emptyRow = (message) => `<div class="data-row empty-row"><span>${escapeHtml(message)}</span></div>`;

  const dataRow = ({ title, meta = '', actions = '', tag = 'div' }) => `
    <${tag} class="data-row">
      <span><strong>${escapeHtml(title)}</strong>${meta ? `<small>${meta}</small>` : ''}</span>
      ${actions ? `<div class="row-actions">${actions}</div>` : ''}
    </${tag}>`;

  const siteLogo = (site, index) => {
    const initials = (site.name || site.slug || '??').slice(0, 2).toUpperCase();
    const cls = LOGO_CLASSES[index % LOGO_CLASSES.length];
    return `<div class="site-logo ${cls}">${escapeHtml(initials)}</div>`;
  };

  const statusPill = (status = 'online') => `<span class="status">${escapeHtml(status)}</span>`;

  const typeLabel = (type) => ({
    php: 'PHP / Laravel',
    node: 'Node.js',
    python: 'Python',
    static: 'Static site',
  }[type] || type);

  const siteRow = (site, index) => {
    const repo = site.repo_url || site.repo || '';
    const port = site.port ? `:${site.port}` : '';
    return `<div class="site-row" data-site-slug="${escapeHtml(site.slug)}">
      ${siteLogo(site, index)}
      <div class="site-meta">
        <strong>${escapeHtml(site.name)}</strong>
        <small>${escapeHtml(typeLabel(site.type))} · <code>${escapeHtml(repo)}</code></small>
      </div>
      <span class="site-port">${escapeHtml(String(port))}</span>
      ${statusPill(site.status || 'online')}
    </div>`;
  };

  const siteCard = (site, index) => {
    const repo = site.repo_url || site.repo || '';
    const port = site.port ? String(site.port) : '—';
    const slug = escapeHtml(site.slug);
    return `<article class="full-site-card" data-site-slug="${slug}" data-site-name="${escapeHtml((site.name || '').toLowerCase())}" data-status="${escapeHtml(site.status || 'online')}" data-config="${escapeHtml(site.config_status || '')}">
      <div class="site-card-top">
        ${siteLogo(site, index)}
        <div class="site-meta">
          <strong>${escapeHtml(site.name)}</strong>
          <small>${escapeHtml(typeLabel(site.type))}</small>
        </div>
        ${statusPill(site.status || 'online')}
      </div>
      <div class="site-card-details">
        <div><span>Repository</span><b>${escapeHtml(repo)}</b></div>
        <div><span>Port</span><b>${escapeHtml(port)}</b></div>
      </div>
      <div class="site-card-actions">
        ${button({ variant: 'secondary', text: 'Deploy', 'data-site-action': 'deploy', 'data-slug': site.slug })}
        ${button({ variant: 'secondary', text: 'Backup', 'data-site-action': 'backup', 'data-slug': site.slug })}
        ${button({ variant: 'secondary', text: 'Apply config', 'data-site-action': 'config', 'data-slug': site.slug })}
        ${button({ variant: 'secondary', text: 'Delete', 'data-site-action': 'delete', 'data-slug': site.slug })}
      </div>
    </article>`;
  };

  const theme = {
    storageKey: 'iqpanel-theme',
    get() {
      const stored = (() => {
        try { return localStorage.getItem(this.storageKey); } catch { return null; }
      })();
      return document.documentElement.dataset.theme || stored || 'dark';
    },
    apply(value) {
      const next = value === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(this.storageKey, next); } catch {}
      const toggle = document.getElementById('theme-toggle');
      if (toggle) toggle.textContent = next === 'light' ? '☀' : '◐';
      if (toggle) toggle.setAttribute('aria-label', next === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    },
    toggle() {
      this.apply(this.get() === 'light' ? 'dark' : 'light');
    },
    init() {
      this.apply(this.get());
      document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggle());
    },
  };

  window.IQPanelUI = {
    escapeHtml,
    attrs,
    button,
    badge,
    panelHeading,
    emptyInline,
    emptyRow,
    dataRow,
    siteLogo,
    siteRow,
    siteCard,
    statusPill,
    typeLabel,
    theme,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => theme.init());
  } else {
    theme.init();
  }
})();
