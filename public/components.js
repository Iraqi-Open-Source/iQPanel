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

  const pathRow = (label, entry) => {
    const value = typeof entry === 'string' ? entry : entry?.path;
    if (!value) return '';
    const exists = typeof entry === 'object' ? entry.exists : undefined;
    const mark = exists === undefined
      ? ''
      : exists ? '<span class="badge badge-ok">exists</span>' : '<span class="badge">missing</span>';
    return `<div class="data-row"><span><strong>${escapeHtml(label)}</strong><small><code>${escapeHtml(value)}</code></small></span>${mark}<button type="button" class="text-button" data-copy-path="${escapeHtml(value)}">Copy</button></div>`;
  };

  const SITE_TABS = [
    ['overview', 'Overview'],
    ['databases', 'Databases'],
    ['files', 'Files'],
    ['php', 'PHP'],
    ['ssl', 'SSL / Domain'],
    ['cron', 'Cron'],
    ['logs', 'Logs'],
    ['backups', 'Backups'],
  ];

  const siteDetailHeader = (site) => `
    <div class="page-heading">
      <div>
        <button class="text-button" type="button" data-view-link="sites">← All sites</button>
        <p class="eyebrow">WORKSPACE / SITE</p>
        <h1>${escapeHtml(site.name || site.slug)}<span class="heading-period">.</span></h1>
        <p class="subheading">${escapeHtml(typeLabel(site.type))} · ${escapeHtml(site.status || 'online')} · port ${escapeHtml(String(site.port ?? '—'))}</p>
      </div>
      <div class="site-card-actions">
        ${button({ variant: 'secondary', text: 'Deploy', 'data-site-action': 'deploy', 'data-slug': site.slug })}
        ${button({ variant: 'secondary', text: 'Backup', 'data-site-action': 'backup', 'data-slug': site.slug })}
        ${button({ variant: 'secondary', text: 'Apply config', 'data-site-action': 'config', 'data-slug': site.slug })}
        ${button({ variant: 'secondary', text: 'Delete', 'data-site-action': 'delete', 'data-slug': site.slug })}
        ${button({ variant: 'primary', text: '+ Database', 'data-open-modal': 'database-modal' })}
      </div>
    </div>`;

  const siteTabs = (active = 'overview') => `
    <nav class="site-tabs filter-tabs" role="tablist">
      ${SITE_TABS.map(([id, label]) => `<button type="button" role="tab" class="${id === active ? 'selected' : ''}" data-site-tab="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}
    </nav>`;

  const siteTabOverview = (site) => {
    const paths = site.paths || {};
    const vhost = paths.vhost;
    const pool = paths.php_pool;
    const metaRows = [
      ['Repository', site.repo_url || site.repo || '—'],
      ['Domain', site.domain || '—'],
      ['Port', site.port ?? '—'],
      ['Web server', site.webserver || '—'],
      ['SSL', site.ssl_status || '—'],
      ['Runtime version', site.runtime_version || '—'],
      ['Run as user', site.run_as_user || '—'],
      ['Deploy branch', site.deploy_branch || '—'],
      ['Config status', site.config_status || '—'],
      ['Created', site.created_at || '—'],
    ].map(([key, value]) => `<div class="data-row"><span>${escapeHtml(key)}</span><code>${escapeHtml(String(value ?? '—'))}</code></div>`).join('');
    const pathRows = [
      pathRow('Site root', paths.site_root),
      pathRow('App root', paths.app_root),
      pathRow('Deploy key', paths.deploy_key),
      vhost ? pathRow('Vhost config (generated)', vhost.generated) : '',
      vhost && vhost.available ? pathRow('Vhost config (available)', vhost.available) : '',
      vhost && vhost.enabled ? pathRow('Vhost config (enabled)', vhost.enabled) : '',
      pool && pool.generated ? pathRow('PHP-FPM pool (generated)', pool.generated) : '',
      pool && pool.system ? pathRow('PHP-FPM pool (system)', pool.system) : '',
      ...(paths.logs || []).map((log) => pathRow(`Log: ${log.name}`, log)),
    ].join('');
    return `
      <div class="content-grid">
        <section class="panel">
          <div class="panel-heading"><div><h2>Site overview</h2><p>Identity, runtime, and routing.</p></div></div>
          ${metaRows}
        </section>
        <section class="panel">
          <div class="panel-heading"><div><h2>Paths on the server</h2><p>Where this site, its config, and its logs live.</p></div></div>
          ${pathRows || emptyInline('Path information is unavailable for this site.')}
        </section>
      </div>`;
  };

  const siteTabDatabases = (site, dbs = []) => {
    const rows = (dbs || []).length
      ? dbs.map((db) => {
        const id = escapeHtml(String(db.id));
        return `<div class="data-row"><span><strong>${escapeHtml(db.db_name)}</strong><small>${escapeHtml(db.engine)} · ${escapeHtml(db.db_user)} @ ${escapeHtml(db.host || 'localhost')}</small></span><span class="badge ${Number(db.granted) ? 'badge-ok' : 'badge-warn'}">${Number(db.granted) ? 'provisioned' : 'record only'}</span><div class="row-actions"><button type="button" class="secondary-button" data-db-dump="${id}">Dump</button><button type="button" class="secondary-button" data-db-delete="${id}">Delete</button></div></div>`;
      }).join('')
      : emptyInline('No databases attached. Create one with the + Database button.');
    return `
      <section class="panel">
        <div class="panel-heading"><div><h2>Databases</h2><p>Databases attached to this site.</p></div></div>
        <div class="data-list">${rows}</div>
      </section>`;
  };

  const siteTabFiles = () => `
    <section class="panel">
      <div class="panel-heading"><div><h2>File manager</h2><p>Browse and edit files inside this site's app directory.</p></div>
        <div class="row-actions">
          <button type="button" class="secondary-button" data-site-files-refresh>Refresh</button>
          <label class="secondary-button" for="site-files-upload">Upload<input id="site-files-upload" type="file" hidden /></label>
        </div>
      </div>
      <div class="toolbar"><label class="search-box">Path<input id="site-files-path" type="text" value="." /></label></div>
      <div class="data-list" id="site-files-list"></div>
    </section>
    <section class="panel">
      <div class="panel-heading"><div><h2>Editor</h2><p id="site-file-editor-title">Select a file to edit.</p></div>
        <div class="row-actions"><button type="button" class="secondary-button" id="site-file-save" disabled>Save</button></div>
      </div>
      <textarea id="site-file-editor" class="logs-output" rows="14" spellcheck="false" disabled></textarea>
    </section>`;

  const siteTabPhp = (site, php = null) => {
    const paths = site.paths || {};
    const pool = paths.php_pool || {};
    const versions = (php && (php.discovered?.length ? php.discovered : php.versions)) || [];
    const rows = [
      ['Runtime version', site.runtime_version || '—'],
      ['Installed PHP versions', versions.length ? versions.join(', ') : 'none discovered'],
    ].map(([key, value]) => `<div class="data-row"><span>${escapeHtml(key)}</span><code>${escapeHtml(String(value))}</code></div>`).join('');
    const poolRows = [
      pool.generated ? pathRow('PHP-FPM pool (generated)', pool.generated) : '',
      pool.system ? pathRow('PHP-FPM pool (system)', pool.system) : '',
    ].join('');
    return `
      <section class="panel">
        <div class="panel-heading"><div><h2>PHP settings</h2><p>Runtime and PHP-FPM pool configuration for this site.</p></div>
          <div class="row-actions"><button type="button" class="secondary-button" data-site-action="config" data-slug="${escapeHtml(site.slug)}">Apply config</button></div>
        </div>
        <div class="data-list">${rows}</div>
        ${site.type !== 'php' ? emptyInline('This site is not a PHP application — the runtime version column above is authoritative.') : ''}
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Pool config paths</h2><p>Where the PHP-FPM pool definition lives.</p></div></div>
        ${poolRows || emptyInline('No PHP-FPM pool for this site type.')}
      </section>`;
  };

  const siteTabSsl = (site) => {
    const ssl = site.ssl_status || 'none';
    const tone = ssl === 'issued' ? 'badge-ok' : ssl === 'pending' ? 'badge-warn' : '';
    return `
      <section class="panel">
        <div class="panel-heading"><div><h2>SSL / TLS</h2><p>Issue a Let's Encrypt certificate for this site's domain.</p></div></div>
        <div class="data-row"><span>Status</span><span class="badge ${tone}">${escapeHtml(ssl)}</span><div class="row-actions"><button type="button" class="secondary-button" data-site-ssl>Request certificate</button></div></div>
        <p class="empty-inline">A domain must be set below before a certificate can be issued.</p>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Domain &amp; routing</h2><p>Update the domain and public port, then apply the config.</p></div></div>
        <form id="site-domain-form">
          <div class="form-row">
            <label>Domain<input name="domain" type="text" value="${escapeHtml(site.domain || '')}" placeholder="example.com" /></label>
            <label>Port<input name="port" type="number" min="1" max="65535" value="${escapeHtml(String(site.port ?? ''))}" /></label>
          </div>
          <div class="modal-actions"><button type="submit" class="primary-button">Save &amp; apply</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Firewall</h2><p>Control whether this site's port is reachable from outside.</p></div></div>
        <div class="data-row"><span>Public access</span><span class="badge ${Number(site.public_access) ? 'badge-ok' : ''}">${Number(site.public_access) ? 'open' : 'closed'}</span><div class="row-actions">
          <button type="button" class="secondary-button" data-site-firewall="open">Open port</button>
          <button type="button" class="secondary-button" data-site-firewall="close">Close port</button>
        </div></div>
      </section>`;
  };

  const siteTabCron = (site, jobs = []) => {
    const rows = (jobs || []).length
      ? jobs.map((job) => `<div class="data-row"><span><strong>${escapeHtml(job.schedule)}</strong><small>${escapeHtml(job.command)} · ${escapeHtml(job.run_as_user || 'root')}</small></span><span class="badge ${job.enabled ? 'badge-ok' : 'badge-warn'}">${job.enabled ? 'Enabled' : 'Disabled'}</span><div class="row-actions"><button type="button" class="secondary-button" data-site-cron-toggle="${escapeHtml(job.id)}">${job.enabled ? 'Disable' : 'Enable'}</button><button type="button" class="secondary-button" data-site-cron-delete="${escapeHtml(job.id)}">Delete</button></div></div>`).join('')
      : emptyInline('No scheduled tasks for this site.');
    return `
      <section class="panel">
        <div class="panel-heading"><div><h2>Scheduled tasks</h2><p>Cron jobs scoped to this site.</p></div>
          <div class="row-actions"><button type="button" class="secondary-button" data-open-modal="cron-modal">New task</button></div>
        </div>
        <div class="data-list">${rows}</div>
      </section>`;
  };

  const siteTabLogs = (site, files = []) => `
    <section class="panel">
      <div class="panel-heading"><div><h2>Logs</h2><p>Live and snapshot views of this site's logs.</p></div>
        <div class="row-actions">
          <button type="button" class="secondary-button" data-site-logs-refresh>Refresh</button>
          <label class="logs-stream-toggle"><input type="checkbox" id="site-logs-stream" /> Live</label>
        </div>
      </div>
      <div class="toolbar"><label class="logs-site-label">Log file<select id="site-logs-file">${(files || []).map((item) => `<option value="${escapeHtml(typeof item === 'string' ? item : item.name)}">${escapeHtml(typeof item === 'string' ? item : item.name)}</option>`).join('')}</select></label></div>
      <pre class="logs-output" id="site-logs-output"></pre>
    </section>`;

  const siteTabBackups = (site, items = []) => {
    const rows = (items || []).length
      ? items.map((item) => `<div class="data-row"><span><strong>${escapeHtml(item.path || item.id)}</strong><small>${escapeHtml(item.site_id || '')}</small></span><span>${escapeHtml(item.size || '')}</span><time>${escapeHtml(item.created_at || '')}</time></div>`).join('')
      : emptyInline('No backups for this site yet.');
    return `
      <section class="panel">
        <div class="panel-heading"><div><h2>Backups</h2><p>Backups recorded for this site.</p></div>
          <div class="row-actions"><button type="button" class="secondary-button" data-site-action="backup" data-slug="${escapeHtml(site.slug)}">Backup now</button></div>
        </div>
        <div class="data-list">${rows}</div>
      </section>`;
  };

  const siteDetail = (site, { tab = 'overview', dbs = [] } = {}) => `
    ${siteDetailHeader(site)}
    ${siteTabs(tab)}
    <div id="site-tab-content">${siteTabOverview(site)}</div>`;

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
    siteDetail,
    siteDetailHeader,
    siteTabs,
    siteTabOverview,
    siteTabDatabases,
    siteTabFiles,
    siteTabPhp,
    siteTabSsl,
    siteTabCron,
    siteTabLogs,
    siteTabBackups,
    pathRow,
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
