function dockerSocketPath() {
  const fs = require('node:fs');
  if (process.env.PANEL_DOCKER_SOCKET) return fs.existsSync(process.env.PANEL_DOCKER_SOCKET) ? process.env.PANEL_DOCKER_SOCKET : null;
  return ['/var/run/docker.sock', '/run/docker.sock'].find((candidate) => fs.existsSync(candidate)) || null;
}

function createDockerHelpers(command, sitePath) {
  async function dockerStatus() {
    const socket = dockerSocketPath();
    if (!socket) return { available: false, reason: 'Docker socket unavailable', containers: [] };
    try {
      const result = await command('docker', ['ps', '-a', '--format', '{{json .}}']);
      const containers = String(result.stdout || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      return { available: true, socket, containers };
    } catch (error) {
      return { available: false, reason: error.message || 'Docker unavailable', containers: [] };
    }
  }

  async function dockerAction(containerId, action) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(containerId || ''))) throw new Error('Invalid container id');
    const allowed = { start: ['start'], stop: ['stop'], restart: ['restart'], remove: ['rm', '-f'] };
    const args = allowed[action];
    if (!args) throw new Error('Unsupported docker action');
    if (!dockerSocketPath()) throw new Error('Docker socket unavailable');
    await command('docker', [...args, containerId]);
    return { containerId, action };
  }

  async function dockerLogs(containerId, lines = 200) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(containerId || ''))) throw new Error('Invalid container id');
    if (!dockerSocketPath()) throw new Error('Docker socket unavailable');
    const result = await command('docker', ['logs', '--tail', String(lines), containerId]);
    return { text: `${result.stdout || ''}${result.stderr || ''}` };
  }

  async function dockerCompose(site, action = 'up') {
    const path = require('node:path');
    const app = path.join(sitePath(site.slug), 'app');
    const allowed = {
      up: ['compose', 'up', '-d'],
      down: ['compose', 'down'],
      build: ['compose', 'build'],
      pull: ['compose', 'pull'],
    };
    const args = allowed[action];
    if (!args) throw new Error('Unsupported compose action');
    if (!dockerSocketPath()) throw new Error('Docker socket unavailable');
    const result = await command('docker', args, { cwd: app });
    return { action, output: `${result.stdout || ''}${result.stderr || ''}` };
  }

  async function dockerPrune() {
    if (!dockerSocketPath()) throw new Error('Docker socket unavailable');
    const result = await command('docker', ['system', 'prune', '-f']);
    return { output: result.stdout || '' };
  }

  return { dockerStatus, dockerAction, dockerLogs, dockerCompose, dockerPrune };
}

module.exports = { dockerSocketPath, createDockerHelpers };
