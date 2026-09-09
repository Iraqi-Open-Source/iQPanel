import { spawn } from 'node:child_process';

const ALLOWED = new Set([
  'nginx', 'apache2', 'certbot', 'python3-certbot-nginx',
  'mysql-server', 'mysql-client',
  'mariadb-server', 'mariadb-client',
  'postgresql', 'postgresql-contrib', 'postgresql-client',
  'redis-server', 'redis-tools',
  'docker.io', 'docker-compose', 'docker-compose-v2', 'docker-buildx',
  'composer', 'git', 'curl', 'wget', 'unzip', 'tar', 'zip',
  'ufw', 'fail2ban',
  'nodejs', 'npm',
  'python3', 'python3-pip', 'python3-venv',
  'sqlite3', 'openssh-client', 'openssl', 'ca-certificates',
  'software-properties-common', 'apt-transport-https', 'gnupg',
  'htop', 'iotop', 'ncdu', 'net-tools', 'dnsutils', 'iputils-ping',
  'acl', 'lsof',
]);

function assertAllowed(name) {
  if (!ALLOWED.has(name)) throw new Error(`Package not in allowlist: ${name}`);
}

function aptRun(args, emit, timeout = 300_000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
    const proc = spawn('apt-get', args, { env });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; emit?.('stdout', d.toString()); });
    proc.stderr.on('data', (d) => { out += d; emit?.('stderr', d.toString()); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('apt timed out')); }, timeout);
    proc.on('close', (code) => {
      clearTimeout(timer);
      emit?.('exit', null, { code });
      if (code === 0) resolve(out);
      else reject(new Error(`apt-get exited ${code}`));
    });
  });
}

export const install = {
  timeout: 600_000,
  validate(args) {
    if (!args.name) throw new Error('name required');
    assertAllowed(args.name);
  },
  async run({ name }, emit) {
    await aptRun(['-y', 'update'], emit);
    await aptRun(['-y', 'install', name], emit);
    return { installed: name };
  },
};

export const remove = {
  timeout: 120_000,
  validate(args) {
    if (!args.name) throw new Error('name required');
    assertAllowed(args.name);
  },
  async run({ name }, emit) {
    await aptRun(['-y', 'remove', '--purge', name], emit);
    return { removed: name };
  },
};

export const listInstalled = {
  async run() {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('dpkg-query', ['-W', '-f=${Package}=${Status}\n'], { encoding: 'utf8' });
    const result = {};
    for (const line of out.split('\n')) {
      const [pkg, status] = line.split('=');
      if (pkg && status?.includes('installed')) result[pkg] = true;
    }
    return result;
  },
};
