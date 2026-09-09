# iQPanel

A Laravel-first Ubuntu server control panel. One command to install. Full browser control over PHP, Nginx, MySQL/MariaDB/PostgreSQL/Redis, SSL, Docker, firewall, cron, and logs. A five-step wizard to deploy any Laravel application.

---

## Quickstart

```bash
# Install with default settings (localhost only, port 4173)
curl -fsSL https://raw.githubusercontent.com/Iraqi-Open-Source/iQPanel/new/installer/install.sh | sudo bash

# Expose on a public port
curl -fsSL .../install.sh | sudo bash -s -- --expose-dashboard --dashboard-port=8080

# Secure HTTPS via Let's Encrypt (recommended for production)
curl -fsSL .../install.sh | sudo bash -s -- \
  --dashboard-domain=panel.example.com \
  --email=you@example.com
```

The installer prints:
```
══════════════════════════════════════════════════
  iQPanel installed successfully
══════════════════════════════════════════════════
  Dashboard : http://YOUR_IP:8080
  Port      : 8080
  Password  : GeneratedOneTimePassword
══════════════════════════════════════════════════
```

Sign in with `admin@localhost` and the printed password.

### Installer flags

| Flag | Default | Description |
|------|---------|-------------|
| `--dashboard-port=N` | `4173` | Port the panel listens on |
| `--expose-dashboard` | off | Bind to `0.0.0.0` instead of `127.0.0.1` |
| `--dashboard-domain=DOMAIN` | — | Issue Let's Encrypt cert, proxy via Nginx |
| `--email=EMAIL` | — | Email for Certbot registration |
| `--stack=all\|lnmp\|llmp\|lamp` | none | Pre-install a LEMP/LAMP/LLMP stack |
| `--channel=stable\|dev` | `stable` | Release channel |

### Supported platforms
- Ubuntu 22.04 / 24.04 / 26.04
- amd64 and arm64

---

## Architecture

```
Browser ─── HTTPS ──► iqpanel.service  (panel user, port 4173)
                            │
                     iqpanel-worker.service (panel user, job queue)
                            │
                   Unix socket 0660 root:panel
                            │
                     iqpanel-agent.service  (root, NDJSON protocol)
                            │
                apt · systemd · nginx · php-fpm
                mysql · psql · redis · docker
                certbot · ufw · crontab · git
```

Three systemd units. The API and worker never execute privileged code directly; every host mutation is a **named, typed action** dispatched to the agent.

---

## Laravel Deploy Workflow

1. **Sites → New Site** — choose type `Laravel`
2. Enter repo URL (`https://` or `git@`) — project name is derived from the basename
3. Enter a domain or choose auto-port (8000–8999)
4. Copy the Ed25519 deploy key → add it to your repo → click **Test connection** to verify
5. Edit the deploy recipe (pre-populated with sensible Laravel defaults) → **Deploy Site**

The panel clones the repo, runs the recipe, writes an Nginx vhost rooted at `public/` with `try_files`, creates a dedicated PHP-FPM pool running as the site's own Unix user, and reloads Nginx with automatic `nginx -t` validation and rollback.

Subsequent deploys run `artisan down → git pull → recipe steps → artisan up`. Full log is persisted. Rollback to any previous commit with one click.

Add a GitHub webhook (`Settings → Webhooks`) pointing at `https://YOUR_PANEL/api/webhooks/github/SITE_ID` with the secret from the Webhook tab. Pushes to the deploy branch trigger automatic deploys with HMAC verification and delivery deduplication.

---

## Features

### Server services
- **PHP**: install/remove 7.4–8.5 via `ppa:ondrej/php`, set system default, per-site pool editing, `php.ini` editor
- **Nginx**: install, status, `nginx -t` validation with rollback, global config view
- **Databases**: MySQL, MariaDB, PostgreSQL, Redis — install, service control, create/drop databases and users. The create-database form only offers engines that are actually installed and running. Creating a database from the site page writes credentials directly to `.env`
- **Docker**: container list/start/stop/restart/remove, image list, `docker compose up/down/build/pull`, container logs
- **Services**: full systemd unit list with start/stop/restart/enable/disable and journald tail
- **Firewall**: UFW rule management and a live `ss -ltnp` listener table
- **Logs**: unified viewer (nginx, php-fpm, journald, panel) with live SSE tail, filter, download
- **Cron**: managed cron block in system crontab (`# BEGIN iqpanel … # END iqpanel`)
- **Metrics**: CPU/memory/disk/load from `/proc`, sparkline history in SQLite

### Site detail tabs
| Tab | Content |
|-----|---------|
| Overview | Status, commit, paths, quick shortcuts |
| Commands | Arbitrary shell scoped to site user (operator+, re-auth required) |
| Environment | `.env` editor with save-on-write |
| Deployments | History, status, one-click rollback |
| Databases | Per-site DB management, credential injection into `.env` |
| Files | Path-constrained file browser and editor |
| Queues | `queue:work` / Horizon systemd units — create/start/stop/restart |
| Scheduler | Laravel scheduler cron entry — enable with one click |
| Cron | Per-site cron entries |
| Logs | Site-specific access/error logs |
| SSL | Certbot issue/renew for the site's domain |
| Terminal | xterm.js WebSocket terminal running as the site user |

---

## Security model

### Authentication
- Passwords hashed with `scrypt` and a per-user random salt (16 bytes hex)
- TOTP (RFC 6238 / HMAC-SHA1) enforced at login if enabled
- Sessions stored in SQLite; sessions survive restarts but are wiped on explicit logout
- `SameSite=Strict` HttpOnly cookie + `X-CSRF-Token` double-submit for every mutating request
- Login rate limiting: 5 failures locks the account for 15 minutes

### Roles
| Role | Scope |
|------|-------|
| `owner` | Everything, including user management |
| `admin` | All server operations; cannot manage other owners |
| `operator` | Site deploys, command execution (with re-auth), database management |
| `readonly` | View dashboards and run allowlisted shortcuts |

Re-authentication window (10 min) is required for: exec.run, env write, delete operations, and rollback.

### Agent
- Runs as root; listens on `/run/iqpanel-agent.sock` (`0660 root:panel`)
- Every connection requires a 32-byte random token checked with `crypto.timingSafeEqual`
- All actions are in a named allowlist in `agent/registry.js` — unknown action names are rejected before any argument parsing
- Each action declares a timeout and output cap
- `files.*` actions enforce a path-constraint: no traversal outside `/var/www/sites/<slug>/app`
- `exec.run` runs under `runuser -u <site-user>` with a scrubbed environment

### Webhooks
- HMAC-SHA256 verified against the site's stored secret (constant-time comparison)
- Delivery deduplication via `X-GitHub-Delivery` header stored in `webhook_deliveries`

---

## Agent action reference

| Action | Description |
|--------|-------------|
| `pkg.install` / `pkg.remove` | Install/remove allowlisted apt packages |
| `svc.*` | systemctl list/start/stop/restart/enable/disable/status/journal |
| `nginx.test` / `nginx.reload` / `nginx.write_vhost` | Nginx management with rollback |
| `php.install` / `php.remove` / `php.write_pool` | PHP version and pool management |
| `db.engines` / `db.create` / `db.drop` / `db.dump` | Database CRUD |
| `redis.*` | Redis status, flush, info |
| `docker.*` | Container/image/compose management |
| `ssl.issue` / `ssl.renew` / `ssl.revoke` | Certbot integration |
| `fw.status` / `fw.allow` / `fw.deny` / `fw.listeners` | UFW and port listener |
| `files.*` | Path-constrained file CRUD |
| `git.keygen` / `git.clone` / `git.pull` / `git.reset` / `git.ls_remote` | Git operations |
| `exec.run` / `exec.env_read` / `exec.env_write` | Site-scoped command execution |
| `cron.list` / `cron.write` | Crontab management |
| `users.create_site_user` / `users.remove_site_user` | Per-site Unix user lifecycle |
| `metrics.snapshot` / `metrics.disk` / `metrics.processes` | System metrics |

---

## Self-update

In the panel: **Settings → Updates → Check for updates → Apply update**.

The update fetches the latest release tarball from GitHub, replaces `/opt/iqpanel/`, and restarts all three systemd units in sequence. The output is streamed to the browser via SSE.

---

## Development

```bash
# Backend (requires Node 24 + a running agent for full functionality)
node server/main.js

# Frontend dev server with proxy to backend
cd web && npm install && npm run dev
```

The `web/` directory uses Vite with a proxy to `http://localhost:4173` so API calls work during development without CORS issues.

---

## License

MIT
