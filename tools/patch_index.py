from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SNIP = Path(__file__).resolve().parent / "snippets"


def sn(name):
    return (SNIP / name).read_text()


LOGIN = sn("login.html")
VIEWS = sn("views.html")
MODALS = sn("modals.html")
html = (ROOT / "index.html").read_text()
html = html.replace('href="styles.css"', 'href="/styles.css"')
html = html.replace('<script src="app.js"></script>', '<script src="/app.js"></script>')
html = html.replace("<body>", "<body>\n" + LOGIN, 1)
html = html.replace('<div class="app-shell">', '<div class="app-shell" id="app-shell" hidden>', 1)
html = re.sub(
    r'<div><small>Connected server</small><strong>[^<]+</strong></div>\s*<button class="icon-button" aria-label="Switch server"[^>]*>[^<]*</button>',
    '<div><small>Connected server</small><strong id="server-label">Local agent</strong></div>',
    html,
)
html = html.replace('<span class="server-pulse"></span>', '<span class="server-pulse" id="server-pulse"></span>')
html = html.replace('Sites <b class="nav-count">4</b>', 'Sites <b class="nav-count" id="nav-sites-count"></b>')
html = html.replace('<button class="nav-item"', '<button class="nav-item" type="button"')
html = html.replace(
    '          <div class="nav-label">System</div>\n          <button class="nav-item" type="button" data-view="terminal"',
    sn("cron-nav.html") + '\n          <button class="nav-item" type="button" data-view="terminal"',
)
html = html.replace(
    '<div class="agent-status"><span class="status-dot"></span><div><strong>Agent online</strong><small>Last heartbeat 12s ago</small></div></div>',
    sn("agent-sidebar.html"),
)
html = html.replace(
    '<div class="user-row"><div class="avatar">WA</div><div><strong>waad admin</strong><small>Administrator</small></div><button class="icon-button" aria-label="Account menu">•••</button></div>',
    sn("user-row.html"),
)
html = html.replace(
    '<button class="avatar top-avatar" aria-label="Open profile">WA</button>',
    sn("logout-top.html"),
)
html = re.sub(
    r'<p class="eyebrow">SUNDAY.*?</p><h1>Good evening.*?</h1><p class="subheading">Your server is healthy.*?</p>',
    sn("overview-heading.html"),
    html,
    flags=re.S,
)
html = re.sub(
    r'<div class="metric-grid">.*?</div>\s*<div class="content-grid">',
    '<div class="metric-grid" id="metric-grid"></div>\n            <div class="content-grid">',
    html,
    flags=re.S,
)
html = re.sub(
    r'<div class="activity-list">.*?</div>\s*<button class="activity-footer"',
    '<div class="activity-list" id="activity-list"></div>\n                <button class="activity-footer" type="button"',
    html,
    flags=re.S,
)
html = re.sub(
    r'<span class="healthy-badge"><i></i> Healthy</span>',
    '<span class="healthy-badge" id="health-badge" hidden><i></i> Healthy</span>',
    html,
)
html = html.replace('<p>All core services are responding normally.</p>', '<p id="health-subtitle">Core services status.</p>')
html = html.replace('<div class="service-health">', '<div class="service-health" id="service-health">')
html = html.replace(
    '<button data-view-link="databases"><span>◉</span><b>New database</b>',
    '<button type="button" data-open-modal="database-modal"><span>◉</span><b>New database</b>',
)
html = html.replace(
    '<button data-view-link="backups"><span>↻</span><b>Run backup</b><small>All site files</small></button>',
    sn("quick-backup.html"),
)
html = html.replace(
    '<div class="filter-tabs"><button class="selected">All <b>4</b></button><button>Online <b>4</b></button><button>Needs attention <b>0</b></button></div>',
    sn("site-filters.html"),
)
match = re.search(
    r'<section class="view placeholder-view" id="deployments-view">.*?</section>\s*<section class="view placeholder-view" id="settings-view">.*?</section>',
    html,
    flags=re.S,
)
if match:
    html = html[: match.start()] + VIEWS + html[match.end() :]
html = html.replace('id="modal-title"', 'id="site-modal-title"')
html = html.replace('aria-labelledby="modal-title"', 'aria-labelledby="site-modal-title"')
html = html.replace('<div class="deploy-success" hidden>', '<div class="deploy-success" id="deploy-success" hidden>')
html = html.replace(
    '<button class="modal-close icon-button" data-close-modal',
    '<button class="modal-close icon-button" type="button" data-close-modal',
)
html = html.replace('<button id="copy-key">', '<button type="button" id="copy-key">')
html = html.replace('<button class="primary-button" id="finish-site">', '<button class="primary-button" type="button" id="finish-site">')
html = html.replace('<button class="primary-button" data-open-modal="site-modal">', '<button class="primary-button" type="button" data-open-modal="site-modal">')
html = html.replace('<button class="text-button" data-view-link="sites">', '<button class="text-button" type="button" data-view-link="sites">')
html = html.replace('<button data-open-modal="site-modal">', '<button type="button" data-open-modal="site-modal">')
html = html.replace('    <div class="toast" id="toast"', MODALS + '\n    <div class="toast" id="toast"')
(PUBLIC / "index.html").write_text(html)
print((PUBLIC / "index.html").stat().st_size)
