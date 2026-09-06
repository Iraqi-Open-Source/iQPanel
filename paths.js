const path = require('node:path');
const { root } = require('./db');

const applySystem = process.env.PANEL_APPLY_SYSTEM === '1';
const phpVersion = process.env.PANEL_PHP_VERSION || '8.3';

function nginxRoot() {
  return process.env.PANEL_NGINX_ROOT || '/etc/nginx';
}

function phpFpmRoot() {
  return process.env.PANEL_PHP_FPM_ROOT || '/etc/php';
}

function systemdRoot() {
  return process.env.PANEL_SYSTEMD_ROOT || '/etc/systemd/system';
}

function generatedRoot() {
  return path.join(root, 'generated');
}

function nginxGenerated(slug) {
  return path.join(generatedRoot(), 'nginx', `${slug}.conf`);
}

function nginxAvailable(slug) {
  return path.join(nginxRoot(), 'sites-available', `${slug}.conf`);
}

function nginxEnabled(slug) {
  return path.join(nginxRoot(), 'sites-enabled', `${slug}.conf`);
}

function phpPoolGenerated(slug) {
  return path.join(generatedRoot(), 'php-fpm', `${slug}.conf`);
}

function phpPoolSystem(slug, version = phpVersion) {
  return path.join(phpFpmRoot(), version, 'fpm', 'pool.d', `${slug}.conf`);
}

function systemdGenerated(slug, template) {
  return path.join(generatedRoot(), 'systemd', `panel-${slug}-${template}.service`);
}

function systemdUnit(slug, template) {
  return path.join(systemdRoot(), `panel-${slug}-${template}.service`);
}

module.exports = {
  applySystem,
  phpVersion,
  nginxRoot,
  phpFpmRoot,
  systemdRoot,
  generatedRoot,
  nginxGenerated,
  nginxAvailable,
  nginxEnabled,
  phpPoolGenerated,
  phpPoolSystem,
  systemdGenerated,
  systemdUnit,
};
