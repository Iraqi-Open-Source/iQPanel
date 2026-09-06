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

echo "Smoke checks passed."
