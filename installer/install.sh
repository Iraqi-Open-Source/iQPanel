#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root or through sudo." >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]] || ! . /etc/os-release || [[ "${ID:-}" != "ubuntu" ]]; then
  echo "iQPanel supports Ubuntu only." >&2
  exit 1
fi

case "${VERSION_ID:-}" in
  20.04|22.04|24.04) ;;
  *) echo "Supported Ubuntu versions: 20.04, 22.04, and 24.04" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive

PANEL_REPO="${PANEL_REPO:-Iraqi-Open-Source/iQPanel}"
PANEL_REF="${PANEL_REF:-main}"
PANEL_TARBALL_URL="${PANEL_TARBALL_URL:-https://github.com/${PANEL_REPO}/archive/refs/heads/${PANEL_REF}.tar.gz}"
SOURCE_DIR=""
FETCH_DIR=""

is_iqpanel_tree() {
  [[ -f "${1:-}/app-http.js" && -f "${1:-}/installer/iqpanel.service" && -f "${1:-}/installer/iqpanel-agent.service" ]]
}

resolve_local_source() {
  local self="${BASH_SOURCE[0]:-}"
  local dir=""
  if [[ -n "$self" && "$self" != "bash" && "$self" != "-" && "$self" != /dev/fd/* && -f "$self" ]]; then
    dir="$(cd "$(dirname "$self")" && pwd)"
    if is_iqpanel_tree "$dir"; then
      SOURCE_DIR="$dir"
      return 0
    fi
    if is_iqpanel_tree "$(cd "$dir/.." && pwd)"; then
      SOURCE_DIR="$(cd "$dir/.." && pwd)"
      return 0
    fi
  fi
  if is_iqpanel_tree "$(pwd)"; then
    SOURCE_DIR="$(pwd)"
    return 0
  fi
  return 1
}

fetch_remote_source() {
  FETCH_DIR="$(mktemp -d /tmp/iqpanel-src.XXXXXX)"
  echo "No local source tree found. Downloading ${PANEL_TARBALL_URL}"
  curl -fsSL "${PANEL_TARBALL_URL}" | tar -xz -C "${FETCH_DIR}"
  SOURCE_DIR="$(find "${FETCH_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if ! is_iqpanel_tree "${SOURCE_DIR}"; then
    echo "Downloaded archive is missing iQPanel files." >&2
    exit 1
  fi
}

cleanup_fetch() {
  if [[ -n "${FETCH_DIR}" && -d "${FETCH_DIR}" ]]; then
    rm -rf "${FETCH_DIR}"
  fi
}

FULL=0
STACK="${PANEL_STACK:-}"
if [[ "${PANEL_FULL:-0}" == "1" ]]; then
  FULL=1
  STACK="${STACK:-all}"
fi
if [[ "${1:-}" == --stack=* ]]; then
  FULL=1
  STACK="${1#--stack=}"
elif [[ "${1:-}" == "--stack" ]]; then
  FULL=1
  STACK="${2:-all}"
fi
if [[ "${FULL}" == "1" && -z "${STACK}" ]]; then
  STACK=all
fi

WEB_PACKAGES=()
DB_PACKAGES=()
if [[ "${FULL}" == "1" ]]; then
  case "${STACK}" in
    all) WEB_PACKAGES=(nginx apache2); DB_PACKAGES=(mysql-server postgresql postgresql-contrib) ;;
    lnmp) WEB_PACKAGES=(nginx); DB_PACKAGES=(mysql-server) ;;
    lamp) WEB_PACKAGES=(apache2); DB_PACKAGES=(mysql-server) ;;
    llmp) WEB_PACKAGES=(nginx); DB_PACKAGES=(mariadb-server) ;;
    *) echo "Supported stacks: all, lnmp, lamp, llmp" >&2; exit 1 ;;
  esac
fi

apt-get update
apt-get install -y curl git unzip tar ca-certificates sqlite3 openssl openssh-client

if ! resolve_local_source; then
  fetch_remote_source
  trap cleanup_fetch EXIT
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

export PANEL_HOME=/var/lib/iqpanel
export PANEL_NVM_HOME="${PANEL_HOME}/.nvm"
export PANEL_PYENV_ROOT="${PANEL_HOME}/.pyenv"

if [[ "${FULL}" == "1" ]]; then
  COMPOSE_PACKAGE=(docker-compose-v2)
  if [[ "${VERSION_ID}" == "20.04" ]]; then
    COMPOSE_PACKAGE=(docker-compose)
  fi

  apt-get install -y software-properties-common certbot python3 python3-venv python3-pip ufw composer docker.io \
    "${COMPOSE_PACKAGE[@]}" "${WEB_PACKAGES[@]}" "${DB_PACKAGES[@]}"

  if [[ "${PANEL_INSTALL_OPTIONAL:-0}" == "1" ]]; then
    apt-get install -y fail2ban postfix dovecot-core phpmyadmin
  fi

  add-apt-repository -y ppa:ondrej/php
  apt-get update
  export PANEL_PHP_VERSIONS="${PANEL_PHP_VERSIONS:-7.4,8.2,8.3,8.4}"
  export PANEL_NODE_VERSIONS="${PANEL_NODE_VERSIONS:-18,20,22}"
  export PANEL_PYTHON_VERSIONS="${PANEL_PYTHON_VERSIONS:-3.10.14,3.11.9,3.12.4}"
  bash "${SOURCE_DIR}/installer/php-versions.sh"
  bash "${SOURCE_DIR}/installer/nvm.sh"
  bash "${SOURCE_DIR}/installer/pyenv.sh"

  DEFAULT_PHP="${PANEL_PHP_VERSION:-8.3}"
  systemctl disable --now apache2 || true
  systemctl enable --now nginx "php${DEFAULT_PHP}-fpm" mysql postgresql || true

  if command -v ufw >/dev/null 2>&1; then
    ufw --force default deny incoming
    ufw --force default allow outgoing
    ufw allow OpenSSH
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
  fi
else
  STACK=none
  DEFAULT_PHP="${PANEL_PHP_VERSION:-}"
fi

APP_ROOT=/opt/iqpanel
systemctl stop iqpanel.service iqpanel-agent.service 2>/dev/null || true
install -d -m 0750 /var/lib/iqpanel /var/www/sites /etc/panel-agent /var/log/panel /var/backups/panel
id panel >/dev/null 2>&1 || useradd --system --home /var/lib/iqpanel --shell /usr/sbin/nologin panel

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

if [[ -f /etc/nginx/nginx.conf ]] && ! grep -q 'sites-enabled' /etc/nginx/nginx.conf; then
  echo "Warning: /etc/nginx/nginx.conf does not include sites-enabled. Add: include /etc/nginx/sites-enabled/*;" >&2
fi

SECRET_KEY="$(openssl rand -hex 32)"
AGENT_TOKEN="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)"
ADMIN_HASH="$(node -e "const c=require('crypto'); process.stdout.write(c.scryptSync(process.argv[1],'iqpanel-admin',32).toString('hex'))" "${ADMIN_PASSWORD}")"

{
  cat <<EOF
PANEL_SECRET_KEY=${SECRET_KEY}
PANEL_AGENT_TOKEN=${AGENT_TOKEN}
PANEL_ADMIN_PASSWORD_HASH=${ADMIN_HASH}
PANEL_BIND=127.0.0.1
PANEL_AGENT_SOCKET=/run/iqpanel-agent.sock
PANEL_AGENT_LISTEN_PORT=4174
PANEL_AGENT_LISTEN_HOST=0.0.0.0
PANEL_DATA_ROOT=/var/lib/iqpanel
PANEL_SITES_ROOT=/var/www/sites
PANEL_APPLY_SYSTEM=1
PANEL_NVM_HOME=${PANEL_NVM_HOME}
PANEL_PYENV_ROOT=${PANEL_PYENV_ROOT}
PANEL_STACK=${STACK}
EOF
  if [[ -n "${DEFAULT_PHP}" ]]; then
    echo "PANEL_PHP_VERSION=${DEFAULT_PHP}"
  fi
  if [[ -n "${PANEL_PHP_VERSIONS:-}" ]]; then
    echo "PANEL_PHP_VERSIONS=${PANEL_PHP_VERSIONS}"
  fi
  if [[ -n "${PANEL_NODE_VERSIONS:-}" ]]; then
    echo "PANEL_NODE_VERSIONS=${PANEL_NODE_VERSIONS}"
  fi
  if [[ -n "${PANEL_PYTHON_VERSIONS:-}" ]]; then
    echo "PANEL_PYTHON_VERSIONS=${PANEL_PYTHON_VERSIONS}"
  fi
} > /etc/panel-agent/env
chmod 0640 /etc/panel-agent/env
chown root:panel /etc/panel-agent/env

install -m 0644 "${SOURCE_DIR}/installer/iqpanel.service" /etc/systemd/system/iqpanel.service
install -m 0644 "${SOURCE_DIR}/installer/iqpanel-agent.service" /etc/systemd/system/iqpanel-agent.service
systemctl daemon-reload
systemctl enable --now iqpanel-agent.service
chown -R panel:panel /var/lib/iqpanel /var/www/sites /var/log/panel /var/backups/panel
systemctl enable --now iqpanel.service

echo "iQPanel is running on http://127.0.0.1:4173 (localhost only)."
echo "Access from your machine with: ssh -L 4173:127.0.0.1:4173 user@this-server"
echo "One-time admin password: ${ADMIN_PASSWORD}"
echo "Store this password now. It is not written to disk in plaintext."
if [[ "${FULL}" != "1" ]]; then
  echo "Minimal install: only the panel and Agent are running."
  echo "Install PHP versions, web servers, databases, and other services from the Dashboard."
  echo "For a preinstalled stack: curl -fsSL https://raw.githubusercontent.com/${PANEL_REPO}/${PANEL_REF}/installer/install.sh | sudo bash -s -- --stack=lnmp"
fi
