#!/usr/bin/env node
/**
 * iQPanel HTTP API server.
 * Runs as unprivileged user `panel`.
 * Loads env from /etc/panel-agent/env if present.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env file
const ENV_FILE = process.env.PANEL_ENV_FILE ?? '/etc/panel-agent/env';
try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {}

import { Router } from './http/router.js';
import { authMiddleware } from './http/middleware.js';
import { purgeExpiredSessions } from './http/session.js';

// Routes
import { registerAuth }       from './http/routes/auth.js';
import { registerSites }      from './http/routes/sites.js';
import { registerDeploy }     from './http/routes/deploy.js';
import { registerDatabases }  from './http/routes/databases.js';
import { registerServices }   from './http/routes/services.js';
import { registerPHP }        from './http/routes/php.js';
import { registerDocker }     from './http/routes/docker.js';
import { registerFirewall }   from './http/routes/firewall.js';
import { registerLogs }       from './http/routes/logs.js';
import { registerCron }       from './http/routes/cron.js';
import { registerFiles }      from './http/routes/files.js';
import { registerExec }       from './http/routes/exec.js';
import { registerMetrics }    from './http/routes/metrics.js';
import { registerSettings }   from './http/routes/settings.js';
import { registerUsers }      from './http/routes/users.js';
import { registerWebhooks }   from './http/routes/webhooks.js';
import { registerTerminal, attachTerminalWS } from './http/routes/terminal.js';
import { registerPackages }   from './http/routes/packages.js';
import { registerBackups }    from './http/routes/backups.js';
import { registerSSL }        from './http/routes/ssl.js';
import { registerQueuesScheduler } from './http/routes/queues-scheduler.js';
import { registerUpdate }         from './http/routes/update.js';

const app = new Router();

const PUBLIC_DIR = join(__dirname, '..', 'public');
app.static(PUBLIC_DIR);

app.use(authMiddleware);

// Public routes
registerAuth(app);
registerWebhooks(app);

// Protected routes
registerSites(app);
registerDeploy(app);
registerDatabases(app);
registerServices(app);
registerPHP(app);
registerDocker(app);
registerFirewall(app);
registerLogs(app);
registerCron(app);
registerFiles(app);
registerExec(app);
registerMetrics(app);
registerSettings(app);
registerUsers(app);
registerTerminal(app);
registerPackages(app);
registerBackups(app);
registerSSL(app);
registerQueuesScheduler(app);
registerUpdate(app);

const PORT = Number(process.env.PANEL_PORT ?? 4173);
const HOST = process.env.PANEL_BIND ?? '127.0.0.1';

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
});
attachTerminalWS(httpServer);

// Purge expired sessions every hour
setInterval(purgeExpiredSessions, 60 * 60 * 1000);

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
