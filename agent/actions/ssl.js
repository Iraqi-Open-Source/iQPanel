import { execFileSync, spawn } from 'node:child_process';

function validateDomain(domain) {
  if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}$/.test(domain)) throw new Error('Invalid domain');
}

function validateEmail(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
}

function certbotRun(args, emit) {
  return new Promise((resolve, reject) => {
    const proc = spawn('certbot', args);
    proc.stdout.on('data', (d) => emit?.('stdout', d.toString()));
    proc.stderr.on('data', (d) => emit?.('stderr', d.toString()));
    proc.on('close', (code) => {
      emit?.('exit', null, { code });
      if (code === 0) resolve({ code });
      else reject(new Error(`certbot exited ${code}`));
    });
  });
}

export const issue = {
  timeout: 120_000,
  validate({ domain, email }) {
    validateDomain(domain);
    validateEmail(email);
  },
  async run({ domain, email, webroot, nginx = true }, emit) {
    const args = ['--non-interactive', '--agree-tos', '-m', email, '-d', domain];
    if (nginx && !webroot) args.push('--nginx');
    else if (webroot) args.push('--webroot', '-w', webroot);
    await certbotRun(['certonly', ...args], emit);
    return { domain, issued: true };
  },
};

export const renew = {
  timeout: 180_000,
  async run({ domain, force = false }, emit) {
    const args = ['renew', '--non-interactive'];
    if (domain) { validateDomain(domain); args.push('--cert-name', domain); }
    if (force) args.push('--force-renewal');
    await certbotRun(args, emit);
    return { renewed: domain ?? 'all' };
  },
};

export const revoke = {
  timeout: 60_000,
  validate({ domain }) { validateDomain(domain); },
  async run({ domain }, emit) {
    await certbotRun(['revoke', '--non-interactive', '--cert-name', domain, '--delete-after-revoke'], emit);
    return { revoked: domain };
  },
};

export const list = {
  async run() {
    try {
      const out = execFileSync('certbot', ['certificates', '--non-interactive'], { encoding: 'utf8' });
      return { output: out };
    } catch { return { output: '' }; }
  },
};
