const { execFileSync } = require('node:child_process');
const paths = require('./paths');

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function detectNodeMajor() {
  try {
    const version = execFileSync('node', ['-v'], { encoding: 'utf8' }).trim().replace(/^v/, '');
    return [version.split('.')[0]];
  } catch {
    return ['20'];
  }
}

function list() {
  const php = splitList(process.env.PANEL_PHP_VERSIONS);
  const node = splitList(process.env.PANEL_NODE_VERSIONS);
  const python = splitList(process.env.PANEL_PYTHON_VERSIONS);
  return {
    php: php.length ? php : [paths.phpVersion],
    node: node.length ? node : detectNodeMajor(),
    python: python.length ? python : ['3'],
  };
}

module.exports = { list };
