const fs = require('node:fs');
const path = require('node:path');

function nvmHome() {
  return process.env.PANEL_NVM_HOME || '/var/lib/iqpanel/.nvm';
}

function pyenvRoot() {
  return process.env.PANEL_PYENV_ROOT || '/var/lib/iqpanel/.pyenv';
}

function listNvmVersions() {
  const root = path.join(nvmHome(), 'versions/node');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((entry) => entry.startsWith('v'))
    .map((entry) => entry.slice(1))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function listPyenvVersions() {
  const root = path.join(pyenvRoot(), 'versions');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((entry) => /^\d/.test(entry))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function resolveNodeVersion(requested) {
  const versions = listNvmVersions();
  const raw = String(requested || '20').replace(/^v/, '');
  if (versions.includes(raw)) return raw;
  const major = raw.split('.')[0];
  const majorMatch = versions.find((item) => item.split('.')[0] === major);
  if (majorMatch) return majorMatch;
  return raw.includes('.') ? raw : `${major}.0.0`;
}

function resolvePythonVersion(requested) {
  const versions = listPyenvVersions();
  const raw = String(requested || '3.12').replace(/^v/, '');
  if (versions.includes(raw)) return raw;
  const parts = raw.split('.');
  const prefix = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : raw;
  const prefixMatch = versions.find((item) => item === prefix || item.startsWith(`${prefix}.`));
  if (prefixMatch) return prefixMatch;
  return raw;
}

function nodeBinary(version) {
  const resolved = resolveNodeVersion(version);
  const candidate = path.join(nvmHome(), 'versions/node', `v${resolved}`, 'bin/node');
  return fs.existsSync(candidate) ? candidate : 'node';
}

function pythonBinary(version) {
  const resolved = resolvePythonVersion(version);
  const candidate = path.join(pyenvRoot(), 'versions', resolved, 'bin/python3');
  if (fs.existsSync(candidate)) return candidate;
  const fallback = path.join(pyenvRoot(), 'versions', resolved, 'bin/python');
  if (fs.existsSync(fallback)) return fallback;
  return 'python3';
}

module.exports = {
  nvmHome,
  pyenvRoot,
  listNvmVersions,
  listPyenvVersions,
  resolveNodeVersion,
  resolvePythonVersion,
  nodeBinary,
  pythonBinary,
};
