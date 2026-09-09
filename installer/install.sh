#!/usr/bin/env bash
# iQPanel installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Iraqi-Open-Source/iQPanel/new/installer/install.sh | sudo bash
#   curl -fsSL ...install.sh | sudo bash -s -- --expose-dashboard --dashboard-port=8080
#   curl -fsSL ...install.sh | sudo bash -s -- --dashboard-domain=panel.example.com --email=me@example.com
set -Eeuo pipefail

# ──────────────────────────────────────────────────
# Guards
# ──────────────────────────────────────────────────

[[ "$(id -u)" -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }

[[ -f /etc/os-release ]] && . /etc/os-release || { echo "Cannot read /etc/os-release." >&2; exit 1; }
[[ "${ID:-}" == "ubuntu" ]] || { echo "iQPanel supports Ubuntu only." >&2; exit 1; }
case "${VERSION_ID:-}" in
  22.04|24.04|26.04) ;;
  *) echo "Supported Ubuntu versions: 22.04, 24.04, 26.04" >&2; exit 1 ;;
esac

# ──────────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────────

PANEL_REPO="${PANEL_REPO:-Iraqi-Open-Source/iQPanel}"
PANEL_REF="${PANEL_REF:-new}"
PANEL_CHANNEL="${PANEL_CHANNEL:-stable}"

EXPOSE_DASHBOARD=0
DASHBOARD_BIND="127.0.0.1"
DASHBOARD_PORT="4173"
DASHBOARD_DOMAIN=""
ADMIN_EMAIL=""
FULL_STACK=0
STACK=""

# ──────────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────────

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --expose-dashboard)          EXPOSE_DASHBOARD=1; DASHBOARD_BIND="0.0.0.0"; shift ;;
    --dashboard-port=*)          DASHBOARD_PORT="${1#--dashboard-port=}"; shift ;;
    --dashboard-port)            DASHBOARD_PORT="${2:-4173}"; shift 2 ;;
    --dashboard-domain=*)        DASHBOARD_DOMAIN="${1#--dashboard-domain=}"; EXPOSE_DASHBOARD=1; shift ;;
    --dashboard-domain)          DASHBOARD_DOMAIN="${2:-}"; EXPOSE_DASHBOARD=1; shift 2 ;;
    --email=*)                   ADMIN_EMAIL="${1#--email=}"; shift ;;
    --email)                     ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --stack=*)                   FULL_STACK=1; STACK="${1#--stack=}"; shift ;;
    --stack)                     FULL_STACK=1; STACK="${2:-all}"; shift 2 ;;
    --channel=*)                 PANEL_CHANNEL="${1#--channel=}"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ "${DASHBOARD_PORT}" =~ ^[0-9]+$ ]] && (( DASHBOARD_PORT >= 1 && DASHBOARD_PORT <= 65535 )) \
  || { echo "Invalid dashboard port." >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive

# ──────────────────────────────────────────────────
# Source resolution
# ──────────────────────────────────────────────────

SOURCE_DIR=""
FETCH_DIR=""

is_iqpanel_tree() { [[ -f "${1:-}/server/main.js" && -f "${1:-}/agent/main.js" && -f "${1:-}/installer/install.sh" ]]; }

resolve_local_source() {
  local self="${BASH_SOURCE[0]:-}"
  local dir=""
  if [[ -n "$self" && -f "$self" ]]; then
    dir="$(cd "$(dirname "$self")" && pwd)"
    if is_iqpanel_tree "$dir"; then SOURCE_DIR="$dir"; return 0; fi
    if is_iqpanel_tree "$(cd "$dir/.." && pwd)"; then SOURCE_DIR="$(cd "$dir/.." && pwd)"; return 0; fi
  fi
  if is_iqpanel_tree "$(pwd)"; then SOURCE_DIR="$(pwd)"; return 0; fi
  return 1
}

fetch_remote_source() {
  FETCH_DIR="$(mktemp -d /tmp/iqpanel-src.XXXXXX)"
  local tarball_url="https://github.com/${PANEL_REPO}/archive/refs/heads/${PANEL_REF}.tar.gz"
  echo "Downloading source from ${tarball_url} ..."
  curl -fsSL "${tarball_url}" | tar -xz -C "${FETCH_DIR}"
  SOURCE_DIR="$(find "${FETCH_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  is_iqpanel_tree "${SOURCE_DIR}" || { echo "Downloaded archive is missing required files." >&2; exit 1; }
}

cleanup_fetch() { [[ -n "${FETCH_DIR}" && -d "${FETCH_DIR}" ]] && rm -rf "${FETCH_DIR}"; }

# ──────────────────────────────────────────────────
# Dependencies
# ──────────────────────────────────────────────────

echo "==> Updating apt and installing prerequisites..."
apt-get update -qq
apt-get install -y -q curl git unzip tar ca-certificates sqlite3 openssl openssh-client

# Node.js 24 LTS
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 24 ]]; then
  echo "==> Installing Node.js 24 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# ──────────────────────────────────────────────────
# Optional full-stack packages
# ──────────────────────────────────────────────────

if [[ "${FULL_STACK}" == "1" ]]; then
  WEB_PKGS=(); DB_PKGS=()
  case "${STACK:-all}" in
    all)  WEB_PKGS=(nginx); DB_PKGS=(mysql-server postgresql postgresql-contrib) ;;
    lnmp) WEB_PKGS=(nginx); DB_PKGS=(mysql-server) ;;
    lamp) WEB_PKGS=(apache2); DB_PKGS=(mysql-server) ;;
    llmp) WEB_PKGS=(nginx); DB_PKGS=(mariadb-server) ;;
    *) echo "Unknown stack: ${STACK}" >&2; exit 1 ;;
  esac

  COMPOSE_PKG="docker-compose-v2"
  [[ "${VERSION_ID}" == "22.04" ]] && COMPOSE_PKG="docker-compose"

  echo "==> Installing full stack: ${WEB_PKGS[*]:-} ${DB_PKGS[*]:-} docker..."
  apt-get install -y software-properties-common certbot python3-certbot-nginx ufw \
    composer docker.io "${COMPOSE_PKG}" "${WEB_PKGS[@]}" "${DB_PKGS[@]}"

  add-apt-repository -y ppa:ondrej/php
  apt-get update -qq

  PHP_VERSIONS="${PANEL_PHP_VERSIONS:-8.2,8.3,8.4}"
  DEFAULT_PHP="${PANEL_PHP_VERSION:-8.3}"
  for ver in ${PHP_VERSIONS//,/ }; do
    echo "==> Installing PHP ${ver}..."
    apt-get install -y "php${ver}" "php${ver}-fpm" "php${ver}-cli" "php${ver}-mysql" \
      "php${ver}-pgsql" "php${ver}-mbstring" "php${ver}-xml" "php${ver}-curl" \
      "php${ver}-gd" "php${ver}-zip" "php${ver}-bcmath" "php${ver}-intl" \
      "php${ver}-readline" "php${ver}-tokenizer" || true
  done

  echo "==> Configuring firewall..."
  ufw --force default deny incoming
  ufw --force default allow outgoing
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  [[ "${EXPOSE_DASHBOARD}" == "1" && -z "${DASHBOARD_DOMAIN}" ]] && ufw allow "${DASHBOARD_PORT}/tcp"
  ufw --force enable
fi

# ──────────────────────────────────────────────────
# Resolve source
# ──────────────────────────────────────────────────

if ! resolve_local_source; then
  if [[ "${PANEL_SKIP_REMOTE:-}" == "1" ]]; then
    echo "PANEL_SKIP_REMOTE=1 but no local source tree was found." >&2
    exit 1
  fi
  fetch_remote_source
  trap cleanup_fetch EXIT
fi

echo "==> Source directory: ${SOURCE_DIR}"

# ──────────────────────────────────────────────────
# Panel user and directories
# ──────────────────────────────────────────────────

APP_ROOT=/opt/iqpanel

systemctl stop iqpanel.service iqpanel-agent.service iqpanel-worker.service 2>/dev/null || true

id panel >/dev/null 2>&1 || useradd --system --home /var/lib/iqpanel --shell /usr/sbin/nologin panel
install -d -m 0750 /var/lib/iqpanel /var/www/sites /etc/panel-agent /var/log/panel /var/backups/panel /var/lib/iqpanel/deploy-logs

SOURCE_REAL="$(readlink -f "${SOURCE_DIR}")"
APP_REAL="$(readlink -f "${APP_ROOT}" 2>/dev/null || true)"
if [[ "${SOURCE_REAL}" != "${APP_REAL}" ]]; then
  rm -rf "${APP_ROOT}"
  install -d -m 0755 "${APP_ROOT}"
  cp -a "${SOURCE_DIR}/." "${APP_ROOT}/"
fi
chown -R root:root "${APP_ROOT}"
chmod -R go-w "${APP_ROOT}"
chown -R panel:panel /var/lib/iqpanel /var/www/sites /var/log/panel /var/backups/panel

[[ -f "${APP_ROOT}/server/data/schema.sql" && -f "${APP_ROOT}/server/data/db.js" ]] \
  || { echo "Install tree is missing server/data (schema.sql / db.js)." >&2; exit 1; }

# ──────────────────────────────────────────────────
# Dashboard SPA
# ──────────────────────────────────────────────────

echo "==> Building dashboard..."
(
  cd "${APP_ROOT}/web"
  npm install --no-audit --no-fund
  npm run build
)
[[ -f "${APP_ROOT}/public/index.html" ]] || { echo "Dashboard build did not produce public/index.html." >&2; exit 1; }
rm -rf "${APP_ROOT}/web/node_modules"
chmod -R go-w "${APP_ROOT}/public"

# ──────────────────────────────────────────────────
# Secrets
# ──────────────────────────────────────────────────

SECRET_KEY="$(openssl rand -hex 32)"
AGENT_TOKEN="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)"
ADMIN_HASH="$(/usr/bin/node -e "
const c = require('node:crypto');
const salt = c.randomBytes(16).toString('hex');
const hash = c.scryptSync(process.argv[1], salt, 32).toString('hex');
process.stdout.write(hash + ':' + salt);
" "${ADMIN_PASSWORD}")"

{
  cat <<EOF
PANEL_SECRET_KEY=${SECRET_KEY}
PANEL_AGENT_TOKEN=${AGENT_TOKEN}
PANEL_ADMIN_PASSWORD_HASH=${ADMIN_HASH%%:*}
PANEL_ADMIN_PASSWORD_SALT=${ADMIN_HASH##*:}
PANEL_BIND=${DASHBOARD_BIND}
PANEL_PORT=${DASHBOARD_PORT}
PANEL_AGENT_SOCKET=/run/iqpanel-agent.sock
PANEL_DATA_ROOT=/var/lib/iqpanel
PANEL_SITES_ROOT=/var/www/sites
PANEL_LOG_DIR=/var/log/panel
PANEL_APPLY_SYSTEM=1
PANEL_REPO=${PANEL_REPO}
PANEL_REF=${PANEL_REF}
PANEL_STACK=${STACK:-none}
EOF
} > /etc/panel-agent/env
chmod 0640 /etc/panel-agent/env
chown root:panel /etc/panel-agent/env

# ──────────────────────────────────────────────────
# Bootstrap admin user into SQLite
# ──────────────────────────────────────────────────

PANEL_DATA_ROOT=/var/lib/iqpanel PANEL_SECRET_KEY="${SECRET_KEY}" \
  /usr/bin/node "${APP_ROOT}/installer/setup-admin.js" "${ADMIN_HASH%%:*}" "${ADMIN_HASH##*:}"

# ──────────────────────────────────────────────────
# Systemd services
# ──────────────────────────────────────────────────

install -m 0644 "${SOURCE_DIR}/installer/systemd/iqpanel.service"        /etc/systemd/system/iqpanel.service
install -m 0644 "${SOURCE_DIR}/installer/systemd/iqpanel-agent.service"   /etc/systemd/system/iqpanel-agent.service
install -m 0644 "${SOURCE_DIR}/installer/systemd/iqpanel-worker.service"  /etc/systemd/system/iqpanel-worker.service
systemctl daemon-reload
systemctl enable --now iqpanel-agent.service
chown -R panel:panel /var/lib/iqpanel /var/www/sites /var/log/panel /var/backups/panel
systemctl enable --now iqpanel-worker.service
systemctl enable --now iqpanel.service

# ──────────────────────────────────────────────────
# Optional: Nginx HTTPS proxy for dashboard domain
# ──────────────────────────────────────────────────

if [[ -n "${DASHBOARD_DOMAIN}" ]]; then
  command -v nginx    >/dev/null 2>&1 || apt-get install -y nginx
  command -v certbot  >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
  EMAIL_ARG=""
  [[ -n "${ADMIN_EMAIL}" ]] && EMAIL_ARG="--email ${ADMIN_EMAIL}" || EMAIL_ARG="--register-unsafely-without-email"

  cat > "/etc/nginx/sites-available/iqpanel-dashboard.conf" <<NGINXEOF
server {
    listen 80;
    server_name ${DASHBOARD_DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:${DASHBOARD_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}
NGINXEOF
  ln -sf "/etc/nginx/sites-available/iqpanel-dashboard.conf" "/etc/nginx/sites-enabled/iqpanel-dashboard.conf"
  nginx -t && systemctl reload nginx || true
  certbot --nginx -d "${DASHBOARD_DOMAIN}" --non-interactive --agree-tos ${EMAIL_ARG} || \
    echo "Warning: Certbot failed. Dashboard is accessible via HTTP on port ${DASHBOARD_PORT}."
fi

# ──────────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════"
echo "  iQPanel installed successfully"
echo "══════════════════════════════════════════════════"
if [[ -n "${DASHBOARD_DOMAIN}" ]]; then
  echo "  Dashboard : https://${DASHBOARD_DOMAIN}"
elif [[ "${EXPOSE_DASHBOARD}" == "1" ]]; then
  echo "  Dashboard : http://$(curl -fsSL ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):${DASHBOARD_PORT}"
  echo "  (HTTP only. Use --dashboard-domain for HTTPS.)"
else
  echo "  Dashboard : http://127.0.0.1:${DASHBOARD_PORT}  (localhost only)"
  echo "  Access via: ssh -L ${DASHBOARD_PORT}:127.0.0.1:${DASHBOARD_PORT} user@this-server"
fi
echo "  Port      : ${DASHBOARD_PORT}"
echo "  Password  : ${ADMIN_PASSWORD}"
echo ""
echo "  Store the password now — it will not be displayed again."
echo "══════════════════════════════════════════════════"
