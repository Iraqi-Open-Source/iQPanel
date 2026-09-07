const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-runtimes-'));
process.env.PANEL_DATA_ROOT = dataRoot;
process.env.PANEL_NVM_HOME = path.join(dataRoot, '.nvm', 'versions', 'node');
process.env.PANEL_PYENV_ROOT = path.join(dataRoot, '.pyenv');

// runtime-paths expects .../.nvm/versions/node and .../.pyenv/versions
const nvmNodeRoot = path.join(dataRoot, 'nvm', 'versions', 'node', 'v22.11.0', 'bin');
const pyenvRoot = path.join(dataRoot, 'pyenv');
fs.mkdirSync(nvmNodeRoot, { recursive: true });
fs.writeFileSync(path.join(nvmNodeRoot, 'node'), '#!/bin/sh\necho node\n');
fs.mkdirSync(path.join(pyenvRoot, 'versions', '3.12.4', 'bin'), { recursive: true });
fs.writeFileSync(path.join(pyenvRoot, 'versions', '3.12.4', 'bin', 'python3'), '#!/bin/sh\necho python\n');

process.env.PANEL_NVM_HOME = path.join(dataRoot, 'nvm');
process.env.PANEL_PYENV_ROOT = pyenvRoot;
process.env.PANEL_PHP_VERSIONS = '7.4,8.2,8.3,8.4';
process.env.PANEL_NODE_VERSIONS = '20,22';
process.env.PANEL_PYTHON_VERSIONS = '3.11,3.12';

const runtimePaths = require('../runtime-paths');
const runtimes = require('../runtimes');

test('resolves installed nvm and pyenv versions by major', () => {
  assert.equal(runtimePaths.resolveNodeVersion('22'), '22.11.0');
  assert.equal(runtimePaths.resolvePythonVersion('3.12'), '3.12.4');
  assert.match(runtimePaths.nodeBinary('22'), /v22\.11\.0\/bin\/node$/);
  assert.match(runtimePaths.pythonBinary('3.12'), /3\.12\.4\/bin\/python3$/);
});

test('runtime inventory merges configured and discovered versions', () => {
  const inventory = runtimes.list();
  assert.deepEqual(inventory.php, ['7.4', '8.2', '8.3', '8.4']);
  assert.ok(inventory.node.includes('22'));
  assert.ok(inventory.python.includes('3.12'));
  assert.ok(inventory.paths.node_versions.includes('22.11.0'));
  assert.ok(inventory.paths.python_versions.includes('3.12.4'));
});

test('systemd node template uses configurable nvm home', () => {
  const { writeSystemdTemplate } = require('../agent-systemd');
  const site = {
    slug: 'node-runtime',
    type: 'node',
    port: 8091,
    app_port: 9201,
    runtime_version: '22',
    run_as_user: 'iqpanel-node-runtime',
  };
  const rendered = writeSystemdTemplate(site, 'node', (slug) => path.join(dataRoot, 'sites', slug));
  const content = fs.readFileSync(rendered.filePath, 'utf8');
  assert.match(content, new RegExp(`${path.join(dataRoot, 'nvm')}/versions/node/v22\\.11\\.0/bin/node`));
});
