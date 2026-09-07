#!/usr/bin/env bash
set -Eeuo pipefail

PANEL_HOME="${PANEL_HOME:-/var/lib/iqpanel}"
PYENV_ROOT="${PANEL_PYENV_ROOT:-${PANEL_HOME}/.pyenv}"
PYTHON_VERSIONS="${PANEL_PYTHON_VERSIONS:-3.10.14,3.11.9,3.12.4}"

apt-get install -y make build-essential libssl-dev zlib1g-dev \
  libbz2-dev libreadline-dev libsqlite3-dev curl llvm \
  libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev

if [[ ! -x "${PYENV_ROOT}/bin/pyenv" ]]; then
  curl -fsSL https://pyenv.run | PYENV_ROOT="${PYENV_ROOT}" bash
fi

export PYENV_ROOT
export PATH="${PYENV_ROOT}/bin:${PATH}"
eval "$(pyenv init -)"
for version in ${PYTHON_VERSIONS//,/ }; do
  pyenv install -s "${version}" || echo "Warning: could not install Python ${version}" >&2
done
pyenv global "${PYTHON_VERSIONS%%,*}" || true
chown -R panel:panel "${PYENV_ROOT}"
