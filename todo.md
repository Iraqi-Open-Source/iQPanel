# iQPanel Implementation Checklist

Status reflects Phase 1 and Phase 2 work against `opensource-server-panel-plan.md`.

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
- [x] Apache vhosts from templates (PHP, proxy, static)
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

- [x] Automated tests (`npm test`) covering API, agent, auth, queue, metrics, ports

## Phase 2 (working)

- [x] Apache support (vhost templates, apply/rollback, site create)
- [x] PostgreSQL support (grants SQL, dump, API engine)
- [x] Multiple PHP/Node versions (`/api/runtimes`, site `runtime_version`)
- [x] Extra systemd templates: FastAPI, Node, ASP.NET
- [x] Docker management (`/api/docker`, compose, honest unavailable status)
- [x] Remote backup destinations (FTP via curl, Telegram chunked uploads)
- [x] Web terminal (`/api/terminal`, audited start/end)
- [x] Certbot / UFW per-site automation (generated locally; applied when `PANEL_APPLY_SYSTEM=1`)
- [x] Multi-server registry (`/api/servers` local + remote records)

## Phase 3 (later)

- [ ] Remote agent TCP invoke routing per registered server
- [ ] Per-site isolated system users
- [ ] GitHub webhooks for auto-deploy and rollback
- [ ] Role-based access control, TOTP 2FA, full audit log UI
- [ ] OpenLiteSpeed support and LNMP/LAMP/LLMP stack presets
- [ ] Cloudflare DNS, mail server, phpMyAdmin, Fail2Ban, swap, disk extension, and SSH key management
- [ ] Service installer UI with package allowlists and idempotent install jobs
- [ ] Browser file-manager UI and upload/download support on top of the secure file API
- [ ] WordPress one-click install, staging/clone, backup/restore, config editor, and plugin/theme management
- [ ] Alert delivery worker for Telegram and Discord threshold notifications

## Feature foundations shipped

- [x] Path-constrained per-site file API (`/api/sites/:slug/files`)
- [x] Allowlisted WordPress WP-CLI API (`/api/sites/:slug/wordpress`)
- [x] Runtime feature catalog and host capability inventory
- [x] Alert threshold configuration with encrypted Discord webhook storage

These foundations deliberately return `planned` for integrations that still need installer, agent, and UI work. Do not mark a feature complete until it has an API, safe privileged implementation, frontend workflow, installer coverage, and tests.

## Manual verification (Ubuntu VM)

1. Run `sudo bash installer/install.sh` on Ubuntu 22.04 or 24.04
2. Tunnel: `ssh -L 4173:127.0.0.1:4173 user@server`
3. Sign in with the one-time admin password
4. Create a PHP or Apache site, add deploy key to GitHub, clone, apply config
5. Confirm Nginx or Apache serves the site (`curl` the assigned port or domain)
6. Create a PostgreSQL database and a Telegram/FTP backup destination in Settings
7. Open the web terminal, run a harmless command, then close the session
8. Delete the site and confirm vhost/pool/unit/cron entries are removed
