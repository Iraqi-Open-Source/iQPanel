#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${IQ_PANEL_URL:-http://127.0.0.1:4173}"
PASS="${IQ_PANEL_PASSWORD:-}"

echo "Checking iQPanel at ${BASE_URL}"

curl -fsS "${BASE_URL}/api/session" >/dev/null || { echo "Session endpoint unreachable"; exit 1; }

if [[ -n "${PASS}" ]]; then
  curl -fsS -c /tmp/iqpanel-verify.cookie -H 'content-type: application/json' \
    -d "{\"password\":\"${PASS}\"}" "${BASE_URL}/api/login" >/dev/null || { echo "Login failed"; exit 1; }
  CURL=(curl -fsS -b /tmp/iqpanel-verify.cookie)
else
  CURL=(curl -fsS)
fi

"${CURL[@]}" "${BASE_URL}/api/dashboard" | grep -q '"sites"' || { echo "Dashboard missing sites"; exit 1; }
"${CURL[@]}" "${BASE_URL}/api/runtimes" | grep -q '"php"' || { echo "Runtimes endpoint failed"; exit 1; }
"${CURL[@]}" "${BASE_URL}/api/docker" | grep -q '"available"' || { echo "Docker endpoint failed"; exit 1; }
"${CURL[@]}" "${BASE_URL}/api/servers" | grep -q 'local' || { echo "Servers endpoint failed"; exit 1; }
FEATURES="$(${CURL[@]} "${BASE_URL}/api/system/features")"
for feature in file_manager wordpress alerts two_factor os_users openlitespeed cloudflare mail_server fail2ban swap_and_disk ssh_keys stack_presets phpmyadmin disk_extension service_installer host_services php_installer; do
  printf '%s' "${FEATURES}" | grep -q "\"${feature}\"" || { echo "Feature catalog missing ${feature}"; exit 1; }
done
"${CURL[@]}" "${BASE_URL}/api/system/capabilities" | grep -q 'available' || { echo "Capability inventory failed"; exit 1; }
"${CURL[@]}" "${BASE_URL}/api/alerts" | grep -q '"thresholds"' || { echo "Alert settings endpoint failed"; exit 1; }
"${CURL[@]}" "${BASE_URL}/api/system/packages" | grep -q '"packages"' || { echo "Package allowlist endpoint failed"; exit 1; }
"${CURL[@]}" "${BASE_URL}/api/system/services" | grep -q '"services"' || { echo "Host services endpoint failed"; exit 1; }
"${CURL[@]}" "${BASE_URL}/api/system/php" | grep -q '"versions"' || { echo "PHP inventory endpoint failed"; exit 1; }

if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files iqpanel-agent.service >/dev/null 2>&1; then
    systemctl is-enabled iqpanel-agent.service >/dev/null 2>&1 || { echo "Agent service is not enabled"; exit 1; }
    systemctl is-enabled iqpanel.service >/dev/null 2>&1 || { echo "Panel service is not enabled"; exit 1; }
  fi
fi

echo "Smoke checks passed."
