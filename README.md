# iQPanel

Open-source server control panel for Ubuntu. The unprivileged web API talks to a root Agent over a Unix socket.

## Run locally

```bash
npm start
```

Open `http://localhost:4173`. Data lives under `data/`, generated configs under `data/generated/`, and deploy/backup/install jobs retry through the SQLite queue.

```bash
npm test
```

## Production layout

The installer (`installer/install.sh`) targets Ubuntu 22.04/24.04. It installs Nginx, Apache (disabled until a site selects it), PHP 8.2/8.3-FPM, MySQL, PostgreSQL, Docker, Certbot, the root Agent, and the panel API bound to localhost.

```text
/opt/iqpanel              application
/var/lib/iqpanel          panel SQLite and generated config
/var/www/sites/<slug>     site trees and deploy keys
/run/iqpanel-agent.sock   Agent socket (token-authenticated)
/etc/panel-agent/env      secret key, Agent token, admin password hash
```

Set `PANEL_APPLY_SYSTEM=1` on the server so generated web/PHP-FPM/systemd/UFW/Certbot configs are installed under `/etc` and reloaded. Locally this stays off and files remain under `data/generated/`.

Access the dashboard with an SSH tunnel:

```bash
ssh -L 4173:127.0.0.1:4173 user@your-server
```

Then open `http://127.0.0.1:4173` and sign in with the one-time password printed by the installer.

## Features

- Sites CRUD with Nginx or Apache vhosts, per-site deploy keys, and Git clone/pull jobs
- PHP, Node, Python, static, and Docker Compose site types
- Selectable PHP/Node runtime versions (`PANEL_PHP_VERSIONS`, `PANEL_NODE_VERSIONS`)
- MySQL, MariaDB, and PostgreSQL create/attach with honest provisioning status
- Local backups plus FTP and Telegram destinations (Telegram splits at 50MB)
- Certbot and UFW actions generated locally, applied on the server when `PANEL_APPLY_SYSTEM=1`
- Docker engine status, container actions, and compose up/down/build/pull
- Web terminal with audited session start/end
- Cron jobs, systemd templates (Laravel queue, FastAPI, Node, ASP.NET)
- Multi-server registry (local agent plus remote host/token records)
- Optional admin login with rate limiting (`PANEL_ADMIN_PASSWORD_HASH`)
- Secure per-site file manager API for listing, reading, writing, creating, renaming, and deleting files under the site app root
- WordPress detection and allowlisted WP-CLI operations when `wp` is installed
- Feature and host capability inventory at `/api/system/features` and `/api/system/capabilities`
- Configurable CPU, memory, and disk alert thresholds, with encrypted Discord webhook storage

## Feature status

iQPanel is not a drop-in clone of WPanel. The current release ships the secure foundations above and keeps privileged work behind the root Agent. The following advertised WPanel features are planned and are intentionally not advertised as working yet:

- OpenLiteSpeed and LNMP/LAMP/LLMP stack presets
- Cloudflare DNS, mail server, phpMyAdmin, Fail2Ban, swap, disk extension, and SSH key management
- WordPress one-click install, staging, backup/restore, and plugin/theme administration UI
- Browser UI for the file manager, alert delivery, and complete service installer
- TOTP 2FA, team roles, and full audit-log UI

Use `GET /api/system/features` to inspect feature availability at runtime. Planned OS integrations will be added only with explicit allowlists and installer verification; the panel will never expose arbitrary shell execution.
