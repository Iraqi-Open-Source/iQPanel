import { readFileSync, statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function readProcStat() {
  const lines = readFileSync('/proc/stat', 'utf8').split('\n');
  const cpu = lines[0].split(/\s+/).slice(1).map(Number);
  return cpu;
}

function readMeminfo() {
  const text = readFileSync('/proc/meminfo', 'utf8');
  const get = (key) => {
    const m = text.match(new RegExp(`${key}:\\s+(\\d+)`));
    return m ? Number(m[1]) * 1024 : 0;
  };
  return {
    total:     get('MemTotal'),
    free:      get('MemFree'),
    available: get('MemAvailable'),
    cached:    get('Cached'),
    buffers:   get('Buffers'),
    swapTotal: get('SwapTotal'),
    swapFree:  get('SwapFree'),
  };
}

function readLoadavg() {
  const [l1, l5, l15] = readFileSync('/proc/loadavg', 'utf8').split(' ');
  return { l1: parseFloat(l1), l5: parseFloat(l5), l15: parseFloat(l15) };
}

export const snapshot = {
  async run() {
    const mem = readMeminfo();
    const load = readLoadavg();

    let cpuPercent = null;
    try {
      const before = readProcStat();
      await new Promise((r) => setTimeout(r, 200));
      const after = readProcStat();
      const idle = (i) => i[3] + i[4];
      const total = (i) => i.reduce((a, b) => a + b, 0);
      const deltaidle = idle(after) - idle(before);
      const deltatotal = total(after) - total(before);
      cpuPercent = deltatotal > 0 ? 100 * (1 - deltaidle / deltatotal) : 0;
    } catch {}

    let diskUsed = 0, diskTotal = 0;
    try {
      const fs = statfsSync('/');
      diskTotal = fs.blocks * fs.bsize;
      diskUsed  = (fs.blocks - fs.bavail) * fs.bsize;
    } catch {}

    return {
      cpu: cpuPercent !== null ? Math.round(cpuPercent * 10) / 10 : null,
      mem: {
        total:     mem.total,
        used:      mem.total - mem.available,
        available: mem.available,
        percent:   mem.total > 0 ? Math.round((mem.total - mem.available) / mem.total * 1000) / 10 : 0,
        swapTotal: mem.swapTotal,
        swapUsed:  mem.swapTotal - mem.swapFree,
      },
      disk: { total: diskTotal, used: diskUsed, percent: diskTotal > 0 ? Math.round(diskUsed / diskTotal * 1000) / 10 : 0 },
      load,
      ts: Date.now(),
    };
  },
};

export const disk = {
  async run() {
    try {
      const out = execFileSync('df', ['-h', '--output=source,size,used,avail,pcent,target'], { encoding: 'utf8' });
      return { output: out };
    } catch { return { output: '' }; }
  },
};

export const processes = {
  async run({ limit = 20 }) {
    try {
      const n = Math.min(Number(limit) || 20, 100);
      const out = execFileSync('ps', ['aux', '--sort=-%cpu'], { encoding: 'utf8' });
      const lines = out.split('\n').slice(0, n + 1);
      return { output: lines.join('\n') };
    } catch { return { output: '' }; }
  },
};
