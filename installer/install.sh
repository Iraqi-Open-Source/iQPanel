#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root or through sudo." >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]] || ! . /etc/os-release || [[ "${ID:-}" != "ubuntu" ]]; then
  echo "iQPanel Phase 1 supports Ubuntu only." >&2
  exit 1
fi

case "${VERSION_ID:-}" in
  22.04|24.04) ;;
  *) echo "Supported Ubuntu versions: 22.04 and 24.04" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl git unzip tar ca-certificates sqlite3 openssh-client software-properties-common \
  nginx apache2 certbot python3 python3-venv python3-pip ufw composer mysql-server

add-apt-repository -y ppa:ondrej/php
apt-get update
apt-get install -y php8.3-cli php8.3-fpm php8.3-mysql php8.3-mbstring php8.3-xml php8.3-curl

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

systemctl disable --now apache2 || true
systemctl enable --now nginx php8.3-fpm mysql

if command -v ufw >/dev/null 2>&1; then
  ufw --force default deny incoming
  ufw --force default allow outgoing
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

install -d -m 0755 /opt/iqpanel
install -d -m 0750 /var/lib/iqpanel /var/www/sites /etc/panel-agent /var/log/panel /var/backups/panel
id panel >/dev/null 2>&1 || useradd --system --home /var/lib/iqpanel --shell /usr/sbin/nologin panel
cp -R . /opt/iqpanel
chown -R root:root /opt/iqpanel
chmod -R go-w /opt/iqpanel
chown -R panel:panel /var/lib/iqpanel /var/www/sites /var/log/panel /var/backups/panel

if ! grep -q 'sites-enabled' /etc/nginx/nginx.conf; then
  echo "Warning: /etc/nginx/nginx.conf does not include sites-enabled. Add: include /etc/nginx/sites-enabled/*;" >&2
fi

SECRET_KEY="$(openssl rand -hex 32)"
AGENT_TOKEN="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)"
ADMIN_HASH="$(node -e "const c=require('crypto'); process.stdout.write(c.scryptSync(process.argv[1],'iqpanel-admin',32).toString('hex'))" "${ADMIN_PASSWORD}")"

cat > /etc/panel-agent/env <<EOF
PANEL_SECRET_KEY=${SECRET_KEY}
PANEL_AGENT_TOKEN=${AGENT_TOKEN}
PANEL_ADMIN_PASSWORD_HASH=${ADMIN_HASH}
PANEL_BIND=127.0.0.1
PANEL_AGENT_SOCKET=/run/iqpanel-agent.sock
PANEL_DATA_ROOT=/var/lib/iqpanel
PANEL_SITES_ROOT=/var/www/sites
PANEL_APPLY_SYSTEM=1
PANEL_PHP_VERSION=8.3
EOF
chmod 0640 /etc/panel-agent/env
chown root:panel /etc/panel-agent/env

install -m 0644 installer/iqpanel.service /etc/systemd/system/iqpanel.service
install -m 0644 installer/iqpanel-agent.service /etc/systemd/system/iqpanel-agent.service
systemctl daemon-reload
systemctl enable --now iqpanel-agent.service iqpanel.service

echo "iQPanel is running on http://127.0.0.1:4173 (localhost only)."
echo "Access from your machine with: ssh -L 4173:127.0.0.1:4173 user@this-server"
echo "One-time admin password: ${ADMIN_PASSWORD}"
echo "Store this password now. It is not written to disk in plaintext."
