import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BEGIN = '# BEGIN iqpanel';
const END   = '# END iqpanel';

function getCurrentCrontab(user = 'root') {
  const r = spawnSync('crontab', ['-l', '-u', user], { encoding: 'utf8' });
  if (r.status !== 0 && r.stderr.includes('no crontab')) return '';
  return r.stdout ?? '';
}

function setCrontab(content, user = 'root') {
  const tmp = join(tmpdir(), `iqpanel-cron-${Date.now()}.txt`);
  writeFileSync(tmp, content);
  execFileSync('crontab', ['-u', user, tmp], { encoding: 'utf8' });
}

function extractBlock(full) {
  const start = full.indexOf(BEGIN);
  const end   = full.indexOf(END);
  if (start === -1 || end === -1) return [];
  const block = full.slice(start + BEGIN.length, end).trim();
  return block ? block.split('\n').filter(Boolean) : [];
}

function replaceBlock(full, lines) {
  const start = full.indexOf(BEGIN);
  const end   = full.indexOf(END);
  const block = lines.length ? `${BEGIN}\n${lines.join('\n')}\n${END}\n` : '';
  if (start === -1) return full + '\n' + block;
  return full.slice(0, start) + block + full.slice(end + END.length);
}

export const list = {
  async run({ user = 'root' }) {
    const full = getCurrentCrontab(user);
    return extractBlock(full);
  },
};

export const write = {
  validate({ lines }) {
    if (!Array.isArray(lines)) throw new Error('lines must be an array');
    for (const l of lines) {
      if (typeof l !== 'string' || l.length > 1024) throw new Error('Invalid cron line');
    }
  },
  async run({ lines, user = 'root' }) {
    const full = getCurrentCrontab(user);
    setCrontab(replaceBlock(full, lines), user);
    return { written: lines.length };
  },
};
