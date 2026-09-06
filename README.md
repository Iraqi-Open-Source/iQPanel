# iQPanel

Open-source server control panel for Ubuntu. Phase 1 ships an unprivileged web API plus a root Agent over a Unix socket.

## Run locally

```bash
npm start
```

Open `http://localhost:4173`. The API stores data under `data/`, renders configs under `data/generated/`, and queues deploy/backup/install jobs with retries.

```bash
npm test
```

## Production layout

The installer (`installer/install.sh`) targets Ubuntu 22.04/24.04. It installs Nginx, PHP 8.3-FPM, MySQL, the root Agent, and the panel API bound to localhost.

```text
/opt/iqpanel              application
/var/lib/iqpanel          panel SQLite and generated config
/var/www/sites/<slug>     site trees and deploy keys
/run/iqpanel-agent.sock   Agent socket (token-authenticated)
/etc/panel-agent/env      secret key, Agent token, admin password hash
```

Set `PANEL_APPLY_SYSTEM=1` on the server so generated Nginx/PHP-FPM/systemd configs are installed under `/etc` and reloaded. In local dev this stays off and configs remain under `data/generated/`.

Access the dashboard with an SSH tunnel:

```bash
ssh -L 4173:127.0.0.1:4173 user@your-server
```

Then open `http://127.0.0.1:4173` and sign in with the one-time password printed by the installer.

## Phase 1 features

- Sites CRUD, per-site deploy keys, Git clone/pull jobs
- Template-driven Nginx, PHP-FPM, and systemd units with apply + rollback
- MySQL create/attach with honest provisioning status
- Local backups with retention
- Log discovery, snapshots, and SSE tail streams
- Cron jobs synced to system crontabs
- Systemd service management from templates
- Optional admin login with rate limiting (`PANEL_ADMIN_PASSWORD_HASH`)
