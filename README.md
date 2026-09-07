# iQPanel

Open-source server control panel for Ubuntu. The unprivileged web API talks to a root Agent over a Unix socket.

Licensed under the [MIT License](LICENSE).

## Run locally

```bash
npm start
```

Open `http://localhost:4173`. Data lives under `data/`, generated configs under `data/generated/`, and deploy/backup/install jobs retry through the SQLite queue.

```bash
npm test
```

Dashboard UI uses layered design tokens (`public/tokens.css`), shared components (`public/components.js`), and a light/dark theme toggle in the top bar.

## Production install

The installer (`installer/install.sh`) targets Ubuntu 20.04, 22.04, and 24.04 (amd64 and arm64). By default it is **minimal**: Node.js 20, the panel API, and the root Agent. It does not preinstall Nginx, PHP, MySQL, Docker, or other stack packages.

After install, finish setup in the Dashboard:

- Services view lists every systemd unit (start / stop / restart / enable / disable)
- Install Nginx, Apache, MySQL, MariaDB, PostgreSQL, Redis, Docker, and other allowlisted packages
- Install a custom PHP version (7.4–8.4 via `ppa:ondrej/php`) with FPM plus cli, mysql, pgsql, mbstring, xml, curl, gd, zip, bcmath, and intl

```bash
sudo bash installer/install.sh
```

To restore the old full-stack bootstrap (web server, databases, PHP, nvm, pyenv, Docker, Certbot, UFW):

```bash
PANEL_FULL=1 sudo bash installer/install.sh
# or a stack preset:
sudo bash installer/install.sh --stack=lnmp
```

```text
/opt/iqpanel              application
/var/lib/iqpanel          panel SQLite and generated config
/var/www/sites/<slug>     site trees and deploy keys
/run/iqpanel-agent.sock   Agent socket (token-authenticated)
/etc/panel-agent/env      secret key, Agent token, admin password hash
```

`PANEL_APPLY_SYSTEM=1` is set by the installer so Dashboard-triggered `apt-get` and systemd actions run on the host. Local `npm start` keeps this off and writes files under `data/generated/`.

Access the dashboard with an SSH tunnel:

```bash
ssh -L 4173:127.0.0.1:4173 user@your-server
```

Then open `http://127.0.0.1:4173` and sign in with the one-time password printed by the installer. From there you can install PHP versions and services without using the VPS terminal.

## Features

- Sites CRUD with Nginx, Apache, or OpenLiteSpeed vhosts, per-site Unix users (`iqpanel-<slug>`), deploy keys, and Git clone/pull jobs
- PHP, Node, Python, static, and Docker Compose site types
- Selectable PHP/Node/Python runtime versions (`PANEL_PHP_VERSIONS`, `PANEL_NODE_VERSIONS`, `PANEL_PYTHON_VERSIONS`)
- MySQL, MariaDB, and PostgreSQL create/attach with honest provisioning status
- Local backups plus FTP and Telegram destinations (Telegram splits at 50MB)
- Certbot and UFW actions generated locally, applied on the server when `PANEL_APPLY_SYSTEM=1`
- Docker engine status, container actions, and compose up/down/build/pull
- Web terminal scoped to the site user by default (escalate for admin sessions)
- Cron jobs default to the site Unix user; systemd templates (Laravel queue/Horizon, FastAPI, Gunicorn, Celery, Python worker, Node, ASP.NET)
- Multi-server registry (local agent plus remote host/token records)
- Optional team login with owner/admin/operator/readonly roles, TOTP 2FA, re-auth for privileged actions, and an audit log (`PANEL_ADMIN_PASSWORD_HASH` migrates to the first owner)
- Secure per-site file manager API for listing, reading, writing, creating, renaming, and deleting files under the site app root
- WordPress install, staging, backup/restore, detection, and allowlisted WP-CLI operations when `wp` is installed
- Feature and host capability inventory at `/api/system/features` and `/api/system/capabilities`
- Configurable CPU, memory, and disk alert thresholds, with encrypted Discord webhook storage
- Browser file manager/editor/upload workflow and an allowlisted package installer with queued jobs
- Host systemd monitor (`/api/system/services`) with start/stop/restart/enable/disable from the Dashboard
- On-demand PHP version installs from the Dashboard (`/api/system/php/install`)
- Background CPU/memory/disk alert delivery to configured Discord and Telegram channels with cooldown deduplication

## Feature status

iQPanel is not a drop-in clone of WPanel. Privileged work remains behind the root Agent. Phase 3E host integrations and Phase 3F dashboard workflows are implemented with generated-only local mode, allowlists, and audit logging.

The runtime feature catalog at `/api/system/features` is authoritative for optional integrations and reports unavailable host tools without pretending they are installed.

Use `GET /api/system/features` to inspect feature availability at runtime. Planned OS integrations will be added only with explicit allowlists and installer verification; the panel will never expose arbitrary shell execution.
