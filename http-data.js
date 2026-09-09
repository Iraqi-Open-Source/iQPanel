const { send, body, getSite, log, slugify, now, id, db, secrets, queue, agentClient, siteAgent, publicDatabase, httpError } = require('./http-shared');
const metrics = require('./metrics');
const { syncCrontab } = require('./http-cron');
const { resolveRunAsUser } = require('./site-user');
const { listServers } = require('./servers');
const { probeServer } = require('./server-probe');
const { publicSettings } = require('./http-settings');

const ENGINE_LABELS = { mysql: 'MySQL', mariadb: 'MariaDB', postgres: 'PostgreSQL' };
const DB_ENGINE_CHOICES = ['mysql', 'mariadb', 'postgres'];

async function hostEngines(agent) {
  try {
    return await agent.invoke('engineStatus');
  } catch {
    return {};
  }
}

function serverHost(serverId) {
  if (!serverId || serverId === 'local') return 'localhost';
  return listServers().find((server) => server.id === serverId)?.host || serverId;
}

async function agentHealth() {
  try {
    await agentClient.forServer(publicSettings().active_server_id || 'local').invoke('ping');
    return 'online';
  } catch {
    return 'offline';
  }
}

async function handleData(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/dashboard') {
    const sites = db.rows('SELECT * FROM sites ORDER BY created_at DESC');
    const activity = db.rows('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 8');
    const deployments = db.rows('SELECT * FROM deployments ORDER BY created_at DESC LIMIT 8');
    const backups = db.rows('SELECT * FROM backups ORDER BY created_at DESC LIMIT 8');
    const fs = require('node:fs');
    const agentMode = process.env.PANEL_AGENT_SOCKET && fs.existsSync(process.env.PANEL_AGENT_SOCKET) ? 'socket' : 'local';
    const snapshot = metrics.snapshot();
    const activeServerId = publicSettings().active_server_id || 'local';
    let services = {};
    try {
      services = await agentClient.forServer(activeServerId).invoke('serviceStatus');
    } catch {
      services = {};
    }
    const engines = await hostEngines(agentClient.forServer(activeServerId));
    send(response, 200, {
      sites,
      activity,
      deployments,
      backups,
      servers: listServers(),
      active_server_id: activeServerId,
      server: {
        status: 'healthy',
        cpu: snapshot.cpu,
        memory: snapshot.memory,
        disk: snapshot.disk,
        load: snapshot.load,
        uptime: snapshot.uptime,
        agent: await agentHealth(),
        agent_mode: agentMode,
        data_root: db.root,
        services,
        engines,
        active_server_id: activeServerId,
      },
    });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/deployments') {
    send(response, 200, db.rows('SELECT deployments.*, sites.name AS site_name, sites.slug AS site_slug FROM deployments LEFT JOIN sites ON sites.id = deployments.site_id ORDER BY deployments.created_at DESC LIMIT 100'));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/databases') {
    send(response, 200, db.rows('SELECT * FROM databases ORDER BY created_at DESC').map(publicDatabase));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/cron') {
    send(response, 200, db.rows('SELECT * FROM cron_jobs ORDER BY created_at DESC'));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/logs') {
    send(response, 200, db.rows('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100'));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/backups') {
    send(response, 200, db.rows('SELECT * FROM backups ORDER BY created_at DESC'));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/jobs') {
    send(response, 200, db.rows('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50'));
    return true;
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && request.method === 'GET') {
    const job = queue.get(jobMatch[1]);
    if (!job) send(response, 404, { error: 'Job not found' });
    else send(response, 200, job);
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/databases') {
    const input = await body(request);
    const site = getSite(input.site_slug);
    if (!site) throw new Error('Site not found');
    const databaseName = slugify(input.db_name).replaceAll('-', '_');
    const databaseUser = slugify(input.db_user || `${site.slug}_user`).replaceAll('-', '_');
    const secret = input.password || secrets.password();
    const mode = input.mode === 'attach' ? 'attach' : 'create';
    const agent = siteAgent(site);
    const engines = await hostEngines(agent);
    let engine = ['mariadb', 'postgres', 'postgresql'].includes(input.engine) ? (input.engine === 'postgresql' ? 'postgres' : input.engine) : null;
    if (!engine) engine = DB_ENGINE_CHOICES.find((candidate) => engines[candidate]?.active) || 'mysql';
    const engineInfo = engines[engine];
    if (engineInfo && engineInfo.installed === false) {
      httpError(400, `${ENGINE_LABELS[engine]} is not installed on this server. Install it from Services → Packages, then try again.`, { engine, engines });
    }
    if (engineInfo && engineInfo.installed && engineInfo.active === false) {
      httpError(400, `${ENGINE_LABELS[engine]} is installed but not running. Start ${engineInfo.unit || 'its service'} from Services → System services.`, { engine, engines });
    }
    const provisioned = await agent.invoke('provisionDatabase', { db_name: databaseName, db_user: databaseUser, password: secret, mode, engine });
    if (provisioned.granted === false) {
      httpError(400, provisioned.reason || `${ENGINE_LABELS[engine]} provisioning did not run on this server.`, { engine, engines, granted: false, executed: Boolean(provisioned.executed) });
    }
    const host = serverHost(site.server_id);
    const database = { id: id(), site_id: site.id, engine, db_name: databaseName, db_user: databaseUser, host, granted: provisioned.granted ? 1 : 0, created_at: now() };
    db.run(`INSERT INTO databases (id,site_id,engine,db_name,db_user,host,password_ciphertext,granted,created_at) VALUES (${db.sql(database.id)},${db.sql(database.site_id)},${db.sql(database.engine)},${db.sql(database.db_name)},${db.sql(database.db_user)},${db.sql(database.host)},${db.sql(secrets.encrypt(secret))},${database.granted},${db.sql(database.created_at)})`);
    log('Database created', site.name, `${database.engine}: ${database.db_name}`);
    send(response, 201, { ...publicDatabase(database), password: secret, granted: Boolean(provisioned.granted), executed: provisioned.executed, reason: provisioned.reason || null });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/cron') {
    const input = await body(request);
    const site = input.site_slug ? getSite(input.site_slug) : null;
    if (input.site_slug && !site) throw new Error('Site not found');
    if (!/^(\S+\s+){4}\S+$/.test(String(input.schedule || ''))) throw new Error('Cron schedule must contain five fields');
    const job = { id: id(), site_id: site?.id || null, run_as_user: resolveRunAsUser({ site, requested: input.run_as_user, escalate: Boolean(input.escalate) }), schedule: input.schedule, command: input.command, enabled: input.enabled === false ? 0 : 1, created_at: now() };
    db.run(`INSERT INTO cron_jobs (id,site_id,run_as_user,schedule,command,enabled,created_at) VALUES (${db.sql(job.id)},${db.sql(job.site_id)},${db.sql(job.run_as_user)},${db.sql(job.schedule)},${db.sql(job.command)},${job.enabled},${db.sql(job.created_at)})`);
    await syncCrontab(job.run_as_user);
    log('Cron job created', site?.name || 'server', job.command);
    send(response, 201, job);
    return true;
  }
  const dumpMatch = pathname.match(/^\/api\/databases\/([^/]+)\/dump$/);
  if (dumpMatch && request.method === 'POST') {
    const database = db.rows(`SELECT * FROM databases WHERE id=${db.sql(dumpMatch[1])}`)[0];
    if (!database) { send(response, 404, { error: 'Database not found' }); return true; }
    const site = db.rows(`SELECT * FROM sites WHERE id=${db.sql(database.site_id)}`)[0];
    const destination = require('node:path').join(db.root, 'backups', site.slug, `dump-${Date.now()}`);
    const job = queue.enqueue('dump', { database: publicDatabase(database), password_ciphertext: database.password_ciphertext, destination, site_id: site.id, server_id: site.server_id || 'local' });
    log('Database dump queued', database.db_name, job.id);
    send(response, 202, { status: 'queued', job_id: job.id });
    return true;
  }
  const databaseMatch = pathname.match(/^\/api\/databases\/([^/]+)$/);
  if (databaseMatch && request.method === 'DELETE') {
    const database = db.rows(`SELECT * FROM databases WHERE id=${db.sql(databaseMatch[1])}`)[0];
    if (!database) { send(response, 404, { error: 'Database not found' }); return true; }
    const force = new URL(request.url, 'http://localhost').searchParams.get('force') === '1';
    const site = db.rows(`SELECT * FROM sites WHERE id=${db.sql(database.site_id)}`)[0];
    if (!force) {
      let result;
      try {
        result = await siteAgent(site).invoke('destroyDatabase', { engine: database.engine, db_name: database.db_name, db_user: database.db_user });
      } catch (error) {
        send(response, 400, { error: `Could not drop ${database.db_name}: ${error.message}`, hint: 'Install or start the provider, or retry with ?force=1 to remove only the panel entry.' });
        return true;
      }
      if (result && result.dropped === false) {
        send(response, 400, { error: result.reason || 'The database provider is unavailable on this server', hint: `The panel entry for ${database.db_name} was kept. Install or start the provider, or retry with ?force=1 to remove only the panel entry.` });
        return true;
      }
      log('Database dropped', database.db_name, database.engine);
    }
    db.run(`DELETE FROM databases WHERE id=${db.sql(database.id)}`);
    log('Database deleted', database.db_name);
    send(response, 204, {});
    return true;
  }
  return false;
}

module.exports = { handleData };
