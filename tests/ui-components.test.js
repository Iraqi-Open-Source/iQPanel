const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');

test('design tokens define semantic and legacy variables', () => {
  const css = fs.readFileSync(path.join(publicDir, 'tokens.css'), 'utf8');
  assert.match(css, /--color-bg:/);
  assert.match(css, /--bg: var\(--color-bg\)/);
  assert.match(css, /\[data-theme='light'\]/);
  assert.match(css, /--button-primary-bg:/);
});

test('styles import the token layer', () => {
  const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  assert.match(css, /@import url\('\.\/tokens\.css'\)/);
});

test('components render accessible site markup', () => {
  const document = {
    documentElement: { dataset: {} },
    getElementById: () => null,
    addEventListener: () => {},
    readyState: 'complete',
  };
  const context = {
    window: { IQPanelUI: null, document },
    document,
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'components.js'), 'utf8'), context);
  const ui = context.window.IQPanelUI;
  assert.equal(ui.escapeHtml('<script>'), '&lt;script&gt;');
  const row = ui.siteRow({ slug: 'demo', name: 'Demo', type: 'php', repo: 'git@test:a/b.git' }, 0);
  assert.match(row, /data-site-slug="demo"/);
  assert.match(row, /site-logo/);
  const card = ui.siteCard({ slug: 'demo', name: 'Demo', type: 'node', repo: 'git@test:a/b.git', port: 8080 }, 1);
  assert.match(card, /data-site-action="deploy"/);
  assert.match(card, /8080/);
});

test('site hub shows environment tab for laravel sites and terminal for all', () => {
  const document = {
    documentElement: { dataset: {} },
    getElementById: () => null,
    addEventListener: () => {},
    readyState: 'complete',
  };
  const context = {
    window: { IQPanelUI: null, document },
    document,
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'components.js'), 'utf8'), context);
  const ui = context.window.IQPanelUI;
  const laravel = ui.siteDetail({ slug: 'demo', name: 'Demo', type: 'laravel', status: 'online' }, { tab: 'overview' });
  assert.match(laravel, /data-site-tab="env"/);
  assert.match(laravel, /data-site-tab="terminal"/);
  const node = ui.siteDetail({ slug: 'demo', name: 'Demo', type: 'node', status: 'online' }, { tab: 'overview' });
  assert.doesNotMatch(node, /data-site-tab="env"/);
  assert.match(node, /data-site-tab="terminal"/);
  assert.match(ui.siteTabEnv({ slug: 'demo' }, { content: 'APP_KEY=x', exists: true }), /APP_KEY=x/);
  assert.match(ui.siteTabEnv({ slug: 'demo' }, { exists: false }), /does not exist yet/);
  assert.match(ui.siteTabTerminal({ slug: 'demo', run_as_user: 'iqpanel-demo' }), /site-terminal-form/);
});

test('app wires the environment editor and site terminal', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const phase2 = fs.readFileSync(path.join(publicDir, 'phase2.js'), 'utf8');
  const phase3d = fs.readFileSync(path.join(publicDir, 'phase3d.js'), 'utf8');
  assert.match(app, /\/api\/terminal/);
  assert.match(app, /site-env-save/);
  assert.match(app, /path: "\.env"/);
  assert.match(app, /site-terminal-form/);
  assert.match(phase3d, /iqpanelEnsureReauth/);
  assert.match(app, /iqpanelEnsureReauth/);
  assert.match(app, /reauth_valid/);
  assert.match(phase2, /iqpanelEnsureReauth/);
  assert.match(phase2, /reauth_valid/);
});

test('settings exposes the self-update control', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(html, /id="settings-update"/);
  assert.match(html, /id="settings-update-status"/);
  assert.match(app, /\/api\/system\/update/);
});
