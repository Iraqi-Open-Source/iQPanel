const { execFileSync } = require('node:child_process');
const paths = require('./paths');
const runtimePaths = require('./runtime-paths');

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function detectNodeMajor() {
  try {
    const version = execFileSync('node', ['-v'], { encoding: 'utf8' }).trim().replace(/^v/, '');
    return [version.split('.')[0]];
  } catch {
    return ['20'];
  }
}

function detectPythonMajor() {
  try {
    const version = execFileSync('python3', ['-V'], { encoding: 'utf8' }).trim().replace(/^Python\s+/, '');
    const parts = version.split('.');
    return parts.length >= 2 ? [`${parts[0]}.${parts[1]}`] : ['3'];
  } catch {
    return ['3'];
  }
}

function phpMajors() {
  const configured = splitList(process.env.PANEL_PHP_VERSIONS);
  return configured.length ? configured : [paths.phpVersion];
}

function nodeMajors() {
  const discovered = runtimePaths.listNvmVersions().map((version) => version.split('.')[0]);
  const configured = splitList(process.env.PANEL_NODE_VERSIONS);
  const merged = unique([...configured, ...discovered, ...detectNodeMajor()]);
  return merged.length ? merged : ['20'];
}

function pythonMajors() {
  const discovered = runtimePaths.listPyenvVersions().map((version) => {
    const parts = version.split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version;
  });
  const configured = splitList(process.env.PANEL_PYTHON_VERSIONS);
  const merged = unique([...configured, ...discovered, ...detectPythonMajor()]);
  return merged.length ? merged : ['3'];
}

function list() {
  return {
    php: phpMajors(),
    node: nodeMajors(),
    python: pythonMajors(),
    paths: {
      nvm_home: runtimePaths.nvmHome(),
      pyenv_root: runtimePaths.pyenvRoot(),
      node_versions: runtimePaths.listNvmVersions(),
      python_versions: runtimePaths.listPyenvVersions(),
    },
  };
}

module.exports = { list, phpMajors, nodeMajors, pythonMajors };
