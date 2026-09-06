# iQPanel Implementation Checklist

Status reflects the Phase 1 completion work against `opensource-server-panel-plan.md`.

## Phase 1: MVP (working)

### Platform architecture

- [x] Root Agent daemon with token-authenticated Unix socket
- [x] Web API as unprivileged `panel` user (`app-http.js`)
- [x] SQLite persistence and durable job queue with retries
- [x] Config templates under `templates/` rendered at runtime
- [x] `PANEL_APPLY_SYSTEM=1` installs Nginx/PHP-FPM/systemd units on Ubuntu
- [x] Apply rollback on validation failure (Nginx test, systemd verify)
- [x] Legacy `server.js` removed

### Sites and deployment

- [x] Sites CRUD with slug validation and max-based port allocation (`port` + `app_port`)
- [x] Per-site Ed25519 deploy keys and Git clone/pull jobs
- [x] Nginx vhosts from templates (PHP, proxy, static)
- [x] PHP-FPM pools from templates
- [x] Apache selection rejected at API boundary (Phase 2)
- [x] `config_status` tracked per site (`generated` vs `applied`)

### Databases and backups

- [x] MySQL grant SQL generation and honest `granted` flag
- [x] On-demand dumps fail visibly without a live MySQL socket
- [x] Local file backups with retention; DB dump errors recorded without aborting file archive

### Cron and services

- [x] Cron jobs persisted and written to system crontabs via managed `# BEGIN iqpanel` block
- [x] Cron PATCH/DELETE endpoints
- [x] Systemd service templates with create/start/stop/restart/delete API

### Dashboard

- [x] Frontend in `public/` with login gate when `PANEL_ADMIN_PASSWORD_HASH` is set
- [x] Live CPU/memory/disk metrics from `/proc` and `statfs`
- [x] Agent `ping` and `serviceStatus` on dashboard
- [x] Working views: overview, sites, deployments, databases, backups, services, logs, cron, settings
- [x] Terminal marked Phase 2

### Installer

- [x] Ubuntu 22.04/24.04 bootstrap with `PANEL_APPLY_SYSTEM` and `PANEL_PHP_VERSION`
- [x] Removed unused sudoers/helper (Agent runs as root)
- [x] `installer/verify.sh` smoke script
- [x] SSH tunnel instructions for localhost-bound panel

### Tests

- [x] 26 automated tests (`npm test`) covering API, agent, auth, queue, metrics, ports

## Phase 2 (not started)

- [ ] Apache support
- [ ] PostgreSQL support
- [ ] Multiple PHP/Node versions
- [ ] Docker management
- [ ] Remote backup destinations (FTP, Telegram)
- [ ] Web terminal
- [ ] Certbot / UFW per-site automation
- [ ] Multi-server agents

## Manual verification (Ubuntu VM)

1. Run `sudo bash installer/install.sh` on Ubuntu 22.04 or 24.04
2. Tunnel: `ssh -L 4173:127.0.0.1:4173 user@server`
3. Sign in with the one-time admin password
4. Create a PHP site, add deploy key to GitHub, clone, apply config
5. Confirm Nginx serves the site (`curl` the assigned port or domain)
6. Delete the site and confirm vhost/pool/unit/cron entries are removed
