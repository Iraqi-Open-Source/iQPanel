const fs = require('node:fs');
const path = require('node:path');
const { renderTemplate } = require('./template');
const paths = require('./paths');
const apply = require('./agent-apply');

const systemdTemplates = {
  'laravel-queue': 'systemd/laravel-queue.service.hbs',
  fastapi: 'systemd/fastapi.service.hbs',
  node: 'systemd/node.service.hbs',
  aspnet: 'systemd/aspnet.service.hbs',
};

function writeSystemdTemplate(site, template, sitePath) {
  const relative = systemdTemplates[template || 'laravel-queue'];
  if (!relative) throw new Error(`Unknown systemd template ${template}`);
  fs.mkdirSync(path.join(paths.generatedRoot(), 'systemd'), { recursive: true });
  const filePath = paths.systemdGenerated(site.slug, template || 'laravel-queue');
  fs.writeFileSync(filePath, renderTemplate(relative, {
    slug: site.slug,
    php_version: site.runtime_version || paths.phpVersion,
    node_version: site.node_version || site.runtime_version || '20',
    port: String(site.app_port || site.port || 8000),
    run_as_user: site.run_as_user || require('./site-user').siteUserName(site.slug),
    site_path: sitePath(site.slug),
    entrypoint: site.entrypoint || 'dist/main.js',
  }), { mode: 0o640 });
  return { filePath, template: template || 'laravel-queue', unitName: `panel-${site.slug}-${template || 'laravel-queue'}` };
}

function createSystemdHelpers(sitePath, command) {
  const write = (site, template) => writeSystemdTemplate(site, template, sitePath);
  return {
    writeSystemdTemplate: write,
    applySystemdUnit: (site, template) => apply.applySystemdUnit(site, template || 'laravel-queue', { writeSystemdTemplate: write, command }),
  };
}

module.exports = { writeSystemdTemplate, createSystemdHelpers, systemdTemplates };
