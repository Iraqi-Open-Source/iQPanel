const fs = require('node:fs');
const os = require('node:os');

let previousCpu = null;

function readProcStat() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    return line.trim().split(/\s+/).slice(1).map(Number);
  } catch {
    return null;
  }
}

function cpuPercent() {
  const current = readProcStat();
  if (!current) return null;
  if (!previousCpu) {
    previousCpu = { values: current, time: Date.now() };
    return 0;
  }
  const totalDelta = current.reduce((sum, value, index) => sum + value - previousCpu.values[index], 0);
  const idleDelta = current[3] - previousCpu.values[3];
  previousCpu = { values: current, time: Date.now() };
  if (totalDelta <= 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

function memoryPercent() {
  try {
    const values = {};
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
      const match = line.match(/^(\w+):\s+(\d+)/);
      if (match) values[match[1]] = Number(match[2]);
    }
    if (!values.MemTotal) return null;
    const available = values.MemAvailable || values.MemFree || 0;
    return Math.round(((values.MemTotal - available) / values.MemTotal) * 100);
  } catch {
    return null;
  }
}

function diskPercent(target = '/') {
  try {
    const stats = fs.statfsSync(target);
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    if (!total) return null;
    return Math.round(((total - free) / total) * 100);
  } catch {
    return null;
  }
}

function snapshot() {
  const cpu = cpuPercent();
  const memory = memoryPercent();
  const disk = diskPercent();
  return {
    cpu: cpu == null ? 0 : cpu,
    memory: memory == null ? 0 : memory,
    disk: disk == null ? 0 : disk,
    load: Number(os.loadavg()[0].toFixed(2)),
    uptime: Math.round(os.uptime()),
  };
}

function parseProcStat(content) {
  const line = content.split('\n')[0];
  return line.trim().split(/\s+/).slice(1).map(Number);
}

function parseMeminfo(content) {
  const values = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) values[match[1]] = Number(match[2]);
  }
  if (!values.MemTotal) return null;
  const available = values.MemAvailable || values.MemFree || 0;
  return Math.round(((values.MemTotal - available) / values.MemTotal) * 100);
}

module.exports = {
  snapshot,
  cpuPercent,
  memoryPercent,
  diskPercent,
  parseProcStat,
  parseMeminfo,
};
