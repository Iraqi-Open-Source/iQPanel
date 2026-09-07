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

test('settings exposes the self-update control', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(html, /id="settings-update"/);
  assert.match(html, /id="settings-update-status"/);
  assert.match(app, /\/api\/system\/update/);
});
