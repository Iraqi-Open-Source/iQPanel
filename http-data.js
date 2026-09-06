const { send, body, getSite, log, slugify, publicDatabase, now, id, db, secrets, queue, agentClient } = require('./http-shared');
const metrics = require('./metrics');
const { syncCrontab } = require('./http-cron');

async function agentHealth() {
  try {
    await agentClient.invoke('ping');
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
    let services = {};
    try {
      services = await agentClient.invoke('serviceStatus');
    } catch {
      services = {};
    }
    send(response, 200, {
      sites,
      activity,
      deployments,
      backups,
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
    const engine = ['mariadb', 'postgres', 'postgresql'].includes(input.engine) ? (input.engine === 'postgresql' ? 'postgres' : input.engine) : 'mysql';
    const provisioned = await agentClient.invoke('provisionDatabase', { db_name: databaseName, db_user: databaseUser, password: secret, mode, engine });
    const database = { id: id(), site_id: site.id, engine, db_name: databaseName, db_user: databaseUser, host: 'localhost', granted: provisioned.granted ? 1 : 0, created_at: now() };
    db.run(`INSERT INTO databases (id,site_id,engine,db_name,db_user,host,password_ciphertext,granted,created_at) VALUES (${db.sql(database.id)},${db.sql(database.site_id)},${db.sql(database.engine)},${db.sql(database.db_name)},${db.sql(database.db_user)},'localhost',${db.sql(secrets.encrypt(secret))},${database.granted},${db.sql(database.created_at)})`);
    log('Database created', site.name, `${database.engine}: ${database.db_name}`);
    send(response, 201, { ...publicDatabase(database), password: secret, granted: Boolean(provisioned.granted), executed: provisioned.executed, reason: provisioned.reason || null });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/cron') {
    const input = await body(request);
    const site = input.site_slug ? getSite(input.site_slug) : null;
    if (input.site_slug && !site) throw new Error('Site not found');
    if (!/^(\S+\s+){4}\S+$/.test(String(input.schedule || ''))) throw new Error('Cron schedule must contain five fields');
    const job = { id: id(), site_id: site?.id || null, run_as_user: input.run_as_user || 'www-data', schedule: input.schedule, command: input.command, enabled: input.enabled === false ? 0 : 1, created_at: now() };
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
    const job = queue.enqueue('dump', { database: publicDatabase(database), password_ciphertext: database.password_ciphertext, destination, site_id: site.id });
    log('Database dump queued', database.db_name, job.id);
    send(response, 202, { status: 'queued', job_id: job.id });
    return true;
  }
  const databaseMatch = pathname.match(/^\/api\/databases\/([^/]+)$/);
  if (databaseMatch && request.method === 'DELETE') {
    const database = db.rows(`SELECT * FROM databases WHERE id=${db.sql(databaseMatch[1])}`)[0];
    if (!database) { send(response, 404, { error: 'Database not found' }); return true; }
    db.run(`DELETE FROM databases WHERE id=${db.sql(database.id)}`);
    log('Database deleted', database.db_name);
    send(response, 204, {});
    return true;
  }
  return false;
}

module.exports = { handleData };
