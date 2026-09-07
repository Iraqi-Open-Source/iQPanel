#!/usr/bin/env bash
set -Eeuo pipefail

PHP_VERSIONS="${PANEL_PHP_VERSIONS:-7.4,8.2,8.3,8.4}"
PHP_PACKAGES=()
for version in ${PHP_VERSIONS//,/ }; do
  PHP_PACKAGES+=(
    "php${version}-cli"
    "php${version}-fpm"
    "php${version}-mysql"
    "php${version}-pgsql"
    "php${version}-mbstring"
    "php${version}-xml"
    "php${version}-curl"
  )
done

if ((${#PHP_PACKAGES[@]} > 0)); then
  apt-get install -y "${PHP_PACKAGES[@]}" || {
    echo "Warning: some PHP packages were unavailable; installed versions may be a subset of ${PHP_VERSIONS}" >&2
    for version in ${PHP_VERSIONS//,/ }; do
      apt-get install -y \
        "php${version}-cli" "php${version}-fpm" "php${version}-mysql" "php${version}-pgsql" \
        "php${version}-mbstring" "php${version}-xml" "php${version}-curl" || true
    done
  }
fi

DEFAULT_PHP="${PANEL_PHP_VERSION:-8.3}"
if command -v "php${DEFAULT_PHP}-fpm" >/dev/null 2>&1; then
  systemctl enable --now "php${DEFAULT_PHP}-fpm" || true
fi
