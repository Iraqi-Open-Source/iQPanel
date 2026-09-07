#!/usr/bin/env bash
set -Eeuo pipefail

PANEL_HOME="${PANEL_HOME:-/var/lib/iqpanel}"
NVM_DIR="${PANEL_NVM_HOME:-${PANEL_HOME}/.nvm}"
NODE_VERSIONS="${PANEL_NODE_VERSIONS:-18,20,22}"

mkdir -p "${NVM_DIR}"
if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | NVM_DIR="${NVM_DIR}" PROFILE=/dev/null bash
fi

# shellcheck disable=SC1090
source "${NVM_DIR}/nvm.sh"
for version in ${NODE_VERSIONS//,/ }; do
  nvm install "${version}" || echo "Warning: could not install Node ${version}" >&2
done
nvm alias default "${NODE_VERSIONS%%,*}" || true
chown -R panel:panel "${NVM_DIR}"
