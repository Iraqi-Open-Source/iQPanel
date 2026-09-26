# iQPanel

A Laravel-first control panel for Ubuntu. One command installs it. From the browser you manage PHP, Nginx, databases, SSL, Docker, the firewall, cron, and logs.

No manual stack setup. Paste the command, run it as root, and the installer prints your dashboard URL and a one-time password.

![iQPanel dashboard](screenshot1.png)

## Install in one command

Ubuntu 22.04, 24.04, or 26.04 · amd64 or arm64 · requires root (`sudo`)

```bash
curl -fsSL https://raw.githubusercontent.com/Iraqi-Open-Source/iQPanel/main/installer/install.sh | sudo bash
```

That is the full install. The panel listens on `http://127.0.0.1:4173`. Sign in with `admin@localhost`. The password is printed once at the end of the install — save it.

Reach it from your laptop with:

```bash
ssh -L 4173:127.0.0.1:4173 user@your-server
```

### Open it on the network

**Public HTTP**

```bash
curl -fsSL https://raw.githubusercontent.com/Iraqi-Open-Source/iQPanel/main/installer/install.sh | sudo bash -s -- --expose-dashboard --dashboard-port=8080
```

**HTTPS** (recommended for a public panel)

```bash
curl -fsSL https://raw.githubusercontent.com/Iraqi-Open-Source/iQPanel/main/installer/install.sh | sudo bash -s -- \
  --dashboard-domain=panel.example.com \
  --email=you@example.com
```

### Flags

| Flag | Default | What it does |
|------|---------|--------------|
| `--dashboard-port=N` | `4173` | Panel port |
| `--expose-dashboard` | off | Listen on all interfaces |
| `--dashboard-domain=DOMAIN` | — | Let's Encrypt certificate and an Nginx proxy |
| `--email=EMAIL` | — | Certbot account email |
| `--stack=all\|lnmp\|llmp\|lamp` | none | Pre-install a web and database stack |

## What you get

- **Sites** — a 5-step wizard deploys Laravel, or any git app
- **PHP** — install 7.4–8.5, set the system default, edit per-site pools
- **Databases** — MySQL, MariaDB, PostgreSQL, Redis; credentials are written into `.env`
- **Docker** — containers, images, compose, logs
- **Server** — systemd, UFW, cron, packages, live logs
- **SSL** — issue and renew with Certbot
- **Updates** — Settings → Updates

## Deploy a Laravel app

1. **Sites → New Site** → type `Laravel`
2. Paste the git URL
3. Set a domain, or pick an auto port (8000–8999)
4. Add the deploy key to your repo → **Test connection**
5. Review the recipe → **Deploy Site**

The panel clones the repo, runs the recipe, writes Nginx and PHP-FPM, and reloads. Later deploys run `artisan down → git pull → recipe → artisan up`. Rollback is one click.

For auto-deploy on push, add a GitHub webhook from the site's **Webhook** tab.

## Develop

Local development needs Node 24. It runs the API and the UI only. System actions (packages, Nginx, SSL, databases) need the root installer above.

```bash
node server/main.js
cd web && npm install && npm run dev
```

Vite proxies API calls to `http://localhost:4173`.

## License

MIT
