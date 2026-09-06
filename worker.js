const path = require('node:path');
const db = require('./db');
const queue = require('./queue');
const agentClient = require('./agent-client');

const now = () => new Date().toISOString();

function log(action, target, details = '') {
  const crypto = require('node:crypto');
  db.run(`INSERT INTO activity_log (id, action, target, details, created_at) VALUES (${db.sql(crypto.randomUUID())}, ${db.sql(action)}, ${db.sql(target)}, ${db.sql(details)}, ${db.sql(now())})`);
}

function recordBackup(siteId, result) {
  const crypto = require('node:crypto');
  db.run(`INSERT INTO backups (id,site_id,destination,path,size,status,created_at) VALUES (${db.sql(crypto.randomUUID())},${db.sql(siteId)},'local',${db.sql(result.path)},${result.size || 0},'succeeded',${db.sql(now())})`);
}

const handlers = {
  async deploy(payload) {
    const result = await agentClient.invoke('cloneRepository', payload.slug, payload.repo_url);
    const output = `${result.stdout || ''}${result.stderr || ''}`.slice(-4000) || 'Repository cloned successfully';
    db.run(`UPDATE deployments SET status='succeeded', log=${db.sql(output)} WHERE id=${db.sql(payload.deployment_id)}`);
    log('Deployment succeeded', payload.slug, 'Git SSH deploy');
    return result;
  },
  async backup(payload) {
    const result = await agentClient.invoke('createBackup', payload.site, payload.databases || [], payload.retention || {});
    recordBackup(payload.site.id, result);
    log('Backup completed', payload.site.name || payload.site.slug, result.path);
    return result;
  },
  async dump(payload) {
    const secrets = require('./secrets');
    const database = { ...payload.database };
    if (payload.password_ciphertext) database.password = secrets.decrypt(payload.password_ciphertext);
    const result = await agentClient.invoke('dumpDatabase', database, payload.destination, database.password || null);
    recordBackup(payload.site_id, result);
    log('Database dump completed', payload.database.db_name, result.path);
    return result;
  },
  async install(payload) {
    const output = await agentClient.invoke('installSite', payload.site);
    log('Install commands completed', payload.site.name || payload.site.slug);
    return { output };
  },
};

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const job = queue.claim();
    if (!job) return;
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`Unknown job type ${job.type}`);
      const result = await handler(JSON.parse(job.payload || '{}'));
      queue.complete(job.id, result);
    } catch (error) {
      if (job.type === 'deploy') {
        try {
          const payload = JSON.parse(job.payload || '{}');
          db.run(`UPDATE deployments SET status='failed', log=${db.sql(error.message)} WHERE id=${db.sql(payload.deployment_id)}`);
        } catch {}
      }
      queue.fail(job.id, error.message);
    }
  } finally {
    busy = false;
  }
}

function start(intervalMs = 250) {
  return setInterval(() => { tick().catch(() => {}); }, intervalMs);
}

module.exports = { tick, start, handlers };
