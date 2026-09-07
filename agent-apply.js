const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function symlinkFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) fs.unlinkSync(destination);
  fs.symlinkSync(source, destination);
}

async function applyNginxConfig(site, { writeNginxConfig, command }) {
  const generated = writeNginxConfig(site);
  if (!paths.applySystem) return { applied: false, path: generated };
  const available = paths.nginxAvailable(site.slug);
  const enabled = paths.nginxEnabled(site.slug);
  copyFile(generated, available);
  let enabledCreated = false;
  try {
    symlinkFile(available, enabled);
    enabledCreated = true;
    await command('nginx', ['-t']);
    await command('systemctl', ['reload', 'nginx']);
    return { applied: true, path: available, enabled };
  } catch (error) {
    if (enabledCreated && fs.existsSync(enabled)) fs.unlinkSync(enabled);
    if (fs.existsSync(available)) fs.unlinkSync(available);
    throw new Error(`Nginx apply failed: ${error.message}`);
  }
}

async function applyApacheConfig(site, { writeApacheConfig, command }) {
  const generated = writeApacheConfig(site);
  if (!paths.applySystem) return { applied: false, path: generated };
  const available = paths.apacheAvailable(site.slug);
  const enabled = paths.apacheEnabled(site.slug);
  copyFile(generated, available);
  let enabledCreated = false;
  try {
    symlinkFile(available, enabled);
    enabledCreated = true;
    await command('apache2ctl', ['configtest']);
    await command('systemctl', ['reload', 'apache2']);
    return { applied: true, path: available, enabled };
  } catch (error) {
    if (enabledCreated && fs.existsSync(enabled)) fs.unlinkSync(enabled);
    if (fs.existsSync(available)) fs.unlinkSync(available);
    throw new Error(`Apache apply failed: ${error.message}`);
  }
}

async function applyPhpPool(site, { writePhpPool, command }) {
  const { filePath, version } = writePhpPool(site);
  if (!paths.applySystem) return { applied: false, path: filePath, version };
  const systemPath = paths.phpPoolSystem(site.slug, version);
  copyFile(filePath, systemPath);
  try {
    await command('systemctl', ['reload', `php${version}-fpm`]);
    return { applied: true, path: systemPath, version };
  } catch (error) {
    if (fs.existsSync(systemPath)) fs.unlinkSync(systemPath);
    throw new Error(`PHP-FPM apply failed: ${error.message}`);
  }
}

async function applySystemdUnit(site, template, { writeSystemdTemplate, command }) {
  const rendered = writeSystemdTemplate(site, template);
  if (!paths.applySystem) return { applied: false, ...rendered };
  const unitPath = paths.systemdUnit(site.slug, template);
  copyFile(rendered.filePath, unitPath);
  try {
    await command('systemd-analyze', ['verify', unitPath]);
    await command('systemctl', ['daemon-reload']);
    await command('systemctl', ['enable', '--now', rendered.unitName]);
    return { applied: true, unitPath, unitName: rendered.unitName, template };
  } catch (error) {
    if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
    throw new Error(`Systemd apply failed: ${error.message}`);
  }
}

async function controlSystemdUnit(unitName, action, { command }) {
  if (!['start', 'stop', 'restart', 'enable', 'disable'].includes(action)) throw new Error('Unsupported systemd action');
  if (!paths.applySystem) return { applied: false, unitName, action };
  if (action === 'disable') await command('systemctl', ['disable', '--now', unitName]);
  else if (action === 'enable') await command('systemctl', ['enable', '--now', unitName]);
  else await command('systemctl', [action, unitName]);
  const status = await command('systemctl', ['is-active', unitName]).catch(() => ({ stdout: 'inactive' }));
  return { applied: true, unitName, action, status: (status.stdout || '').trim() || 'inactive' };
}

function removeNginxConfig(slug, assertSlug) {
  assertSlug(slug);
  for (const target of [paths.nginxGenerated(slug), paths.nginxAvailable(slug), paths.nginxEnabled(slug)]) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

function removeApacheConfig(slug, assertSlug) {
  assertSlug(slug);
  for (const target of [paths.apacheGenerated(slug), paths.apacheAvailable(slug), paths.apacheEnabled(slug)]) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

function removePhpPool(slug, version, assertSlug) {
  assertSlug(slug);
  for (const target of [paths.phpPoolGenerated(slug), paths.phpPoolSystem(slug, version)]) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

async function removeSystemdUnits(slug, assertSlug, command) {
  assertSlug(slug);
  const generatedDir = path.join(paths.generatedRoot(), 'systemd');
  const prefix = `panel-${slug}-`;
  if (fs.existsSync(generatedDir)) {
    for (const name of fs.readdirSync(generatedDir)) {
      if (name.startsWith(prefix)) fs.unlinkSync(path.join(generatedDir, name));
    }
  }
  if (paths.applySystem && fs.existsSync(paths.systemdRoot())) {
    for (const name of fs.readdirSync(paths.systemdRoot())) {
      if (!name.startsWith(prefix) || !name.endsWith('.service')) continue;
      const unitName = name.replace(/\.service$/, '');
      await command('systemctl', ['disable', '--now', unitName]).catch(() => {});
      fs.unlinkSync(path.join(paths.systemdRoot(), name));
    }
    await command('systemctl', ['daemon-reload']).catch(() => {});
  }
}

module.exports = {
  applyNginxConfig,
  applyApacheConfig,
  applyPhpPool,
  applySystemdUnit,
  controlSystemdUnit,
  removeNginxConfig,
  removeApacheConfig,
  removePhpPool,
  removeSystemdUnits,
};
