const fs = require('node:fs');
const path = require('node:path');
const { renderTemplate } = require('./template');
const paths = require('./paths');
const apply = require('./agent-apply');

function writeApacheConfig(site, sitePath) {
  fs.mkdirSync(path.join(paths.generatedRoot(), 'apache'), { recursive: true });
  const listenPort = site.domain ? 80 : Number(site.port);
  const vars = {
    slug: site.slug,
    listen_port: listenPort,
    server_name: site.domain || '_',
    site_root: path.join(sitePath(site.slug), 'app'),
    site_path: sitePath(site.slug),
    upstream_port: Number(site.app_port || site.port || listenPort),
    run_as_user: site.run_as_user || require('./site-user').siteUserName(site.slug),
  };
  let template = 'apache/proxy.conf.hbs';
  if (site.type === 'php') template = 'apache/php.conf.hbs';
  else if (site.type === 'static') template = 'apache/static.conf.hbs';
  const filePath = paths.apacheGenerated(site.slug);
  fs.writeFileSync(filePath, renderTemplate(template, vars), { mode: 0o640 });
  return filePath;
}

function createApacheHelpers(sitePath, command) {
  return {
    writeApacheConfig: (site) => writeApacheConfig(site, sitePath),
    applyApacheConfig: (site) => apply.applyApacheConfig(site, { writeApacheConfig: (item) => writeApacheConfig(item, sitePath), command }),
    removeApacheConfig: (slug) => apply.removeApacheConfig(slug, (value) => {
      if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(value)) throw new Error('Invalid site slug');
    }),
  };
}

module.exports = { writeApacheConfig, createApacheHelpers };
