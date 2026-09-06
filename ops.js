const fs = require('node:fs');
const path = require('node:path');
const base = require('./agent-ops');
const { createApacheHelpers } = require('./agent-apache');
const { provisionPostgres, dumpPostgres } = require('./agent-postgres');
const { createSystemdHelpers } = require('./agent-systemd');
const { createDockerHelpers } = require('./agent-docker');
const net = require('./agent-net');
const remote = require('./backup-remote');

const apache = createApacheHelpers(base.sitePath, base.command);
const systemd = createSystemdHelpers(base.sitePath, base.command);
const docker = createDockerHelpers(base.command, base.sitePath);

async function provisionDatabase(input) {
  const engine = String(input.engine || 'mysql').toLowerCase();
  if (engine === 'postgres' || engine === 'postgresql') return provisionPostgres(input, base.command);
  return base.provisionDatabase(input);
}

async function dumpDatabase(database, destinationDir, secret) {
  const engine = String(database.engine || 'mysql').toLowerCase();
  if (engine === 'postgres' || engine === 'postgresql') return dumpPostgres(database, destinationDir, base.command);
  return base.dumpDatabase(database, destinationDir, secret);
}

async function createBackup(site, databases = [], retention = {}, extras = {}) {
  const result = await base.createBackup(site, databases, retention);
  const destination = extras.destination || site.backup_destination || 'local';
  let remoteResult = { destination: 'local' };
  if (destination === 'ftp' || destination === 'telegram') {
    try {
      if (destination === 'ftp') remoteResult = await remote.uploadFtp(result.path, extras.credentials?.ftp || {}, base.command);
      else remoteResult = await remote.uploadTelegram(result.path, extras.credentials?.telegram || {});
    } catch (error) {
      remoteResult = { destination, error: error.message };
    }
  }
  return { ...result, destination, remote: remoteResult };
}

async function requestCertificate(site) {
  return net.requestCertificate(site, base.command);
}

async function openSitePort(port) {
  return net.openSitePort(port, base.command);
}

async function closeSitePort(port) {
  return net.closeSitePort(port, base.command);
}

module.exports = {
  ...base,
  ...apache,
  ...systemd,
  ...docker,
  provisionDatabase,
  dumpDatabase,
  createBackup,
  requestCertificate,
  openSitePort,
  closeSitePort,
};
