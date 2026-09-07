# iQPanel Implementation Checklist

Status reflects Phase 1 and Phase 2 work against `opensource-server-panel-plan.md`. Phase 3 is broken into six slices (3A–3F) with explicit dependencies.

## Phase 1: MVP (shipped)

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

## Phase 2 (shipped)

- [x] Apache support (vhost templates, apply/rollback, site create)
- [x] PostgreSQL support (grants SQL, dump, API engine)
- [x] Multiple PHP/Node versions (`/api/runtimes`, site `runtime_version`)
- [x] Extra systemd templates: FastAPI, Node, ASP.NET
- [x] Docker management (`/api/docker`, compose, honest unavailable status)
- [x] Remote backup destinations (FTP via curl, Telegram chunked uploads)
- [x] Web terminal (`/api/terminal`, audited start/end)
- [x] Certbot / UFW per-site automation (generated locally; applied when `PANEL_APPLY_SYSTEM=1`)
- [x] Multi-server registry (`/api/servers` local + remote records)

## Phase 3A — Remote Agent routing

Depends on: Phase 2 multi-server registry (shipped).

- [x] Agent TCP listener (token-authenticated) on managed hosts
- [x] `agent-client.invoke` routes by `server_id` (local Unix socket vs remote TCP)
- [x] Background health probe updates `servers.status`
- [x] `sites.server_id` column; site jobs target the bound server
- [x] Dashboard server picker and connectivity indicator
- [x] Tests: remote routing, invalid token, offline host, local fallback

## Phase 3B — Deploy webhooks and rollback

Depends on: 3A (for remote-server deploys).

- [x] `POST /api/webhooks/github/:siteId` with HMAC verification
- [x] Record `commit_sha` and full log on clone/pull completion
- [x] `POST /api/sites/:slug/deployments/:id/rollback`
- [x] Optional deploy branch/tag filter per site
- [x] Dashboard deploy history with rollback action
- [x] Tests: webhook signatures, rollback to missing SHA, concurrent deploy dedup

## Phase 3C — Per-site OS users

Can run in parallel with 3A/3B.

- [x] Agent provisions `iqpanel-<slug>` user on site create
- [x] Nginx/Apache, PHP-FPM, and systemd units use site user
- [x] Cron and terminal scoped to site user by default
- [x] Site delete removes Unix user when unshared
- [x] Migration job for existing `www-data`-owned sites
- [x] Tests: cross-site filesystem isolation

## Phase 3D — Team auth, 2FA, and audit UI

Can run in parallel with 3A–3C. Required before public exposure.

- [x] `users` table with `owner` / `admin` / `operator` / `readonly` roles
- [x] TOTP 2FA enrollment, backup codes, verify-on-login
- [x] Re-auth before terminal, site delete, and root-capable actions
- [x] `GET /api/audit` with pagination and filters
- [x] Dashboard audit log view and team member settings
- [x] Migrate single admin password to first `owner` on upgrade
- [x] Tests: role enforcement, 2FA lockout, audit coverage

## Phase 3E — Host integrations (Agent + installer)

Independent slices; each needs Agent action, installer hook, `verify.sh` check, and `FEATURE_CATALOG` update.

- [ ] OpenLiteSpeed vhost templates and per-site webserver option
- [ ] LNMP / LAMP / LLMP stack presets (`installer --stack`)
- [ ] Fail2Ban jail templates and status API
- [ ] Swap enable/disable with size limits
- [ ] Disk extension (allowlisted LVM/partition grow, dry-run first)
- [ ] SSH `authorized_keys` management (admin keys)
- [ ] Mail server (Postfix + Dovecot minimal, optional)
- [ ] phpMyAdmin vhost install
- [ ] Cloudflare DNS A/AAAA/CNAME upsert via API token

## Phase 3F — Dashboard parity UI and alert delivery

Depends on: 3B (deploy UI), 3C (ownership-aware file ops), 3D (auth for sensitive UI), 3E (settings for integrations).

- [ ] File manager UI (list, edit, upload, download, rename, delete)
- [ ] WordPress one-click install, staging clone, backup/restore UI
- [ ] WordPress plugin/theme list and activate/deactivate UI
- [ ] Service installer UI with package allowlists and job progress
- [ ] Alert delivery worker (metric poll → `alert_events` → Telegram/Discord)
- [ ] Alert deduplication cooldown per channel
- [ ] Tests: upload traversal, WP install rollback, alert dedup

## Feature foundations shipped (API only — complete in 3F)

- [x] Path-constrained per-site file API (`/api/sites/:slug/files`)
- [x] Allowlisted WordPress WP-CLI API (`/api/sites/:slug/wordpress`)
- [x] Runtime feature catalog and host capability inventory
- [x] Alert threshold configuration with encrypted Discord webhook storage

Do not mark a Phase 3 slice complete until it has API, safe privileged implementation, frontend workflow (when applicable), installer coverage (when applicable), and tests.

## Manual verification (Ubuntu VM)

1. Run `sudo bash installer/install.sh` on Ubuntu 22.04 or 24.04
2. Tunnel: `ssh -L 4173:127.0.0.1:4173 user@server`
3. Sign in with the one-time admin password
4. Create a PHP or Apache site, add deploy key to GitHub, clone, apply config
5. Confirm Nginx or Apache serves the site (`curl` the assigned port or domain)
6. Create a PostgreSQL database and a Telegram/FTP backup destination in Settings
7. Open the web terminal, run a harmless command, then close the session
8. Delete the site and confirm vhost/pool/unit/cron entries are removed
