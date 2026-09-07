const db = require('./db');
const queue = require('./queue');
const agentClient = require('./agent-client');
const { applySiteConfig } = require('./http-site-create');
const { needsUserMigration } = require('./site-user');

const now = () => new Date().toISOString();

function log(action, target, details = '') {
  const crypto = require('node:crypto');
    db.run(`INSERT INTO activity_log (id, action, target, details, user_id, created_at) VALUES (${db.sql(crypto.randomUUID())}, ${db.sql(action)}, ${db.sql(target)}, ${db.sql(details)}, NULL, ${db.sql(now())})`);
}

function recordBackup(siteId, result) {
  const crypto = require('node:crypto');
  db.run(`INSERT INTO backups (id,site_id,destination,path,size,status,created_at) VALUES (${db.sql(crypto.randomUUID())},${db.sql(siteId)},${db.sql(result.destination || 'local')},${db.sql(result.path)},${result.size || 0},'succeeded',${db.sql(now())})`);
}

function agentForPayload(payload) {
  return agentClient.forServer(payload.server_id || payload.site?.server_id || 'local');
}

const handlers = {
  async deploy(payload) {
    const result = await agentForPayload(payload).invoke('cloneRepository', payload.slug, payload.repo_url);
    const head = await agentForPayload(payload).invoke('repositoryHead', payload.slug);
    const output = `${result.stdout || ''}${result.stderr || ''}`.slice(-4000) || 'Repository cloned successfully';
    db.run(`UPDATE deployments SET status='succeeded', commit_sha=${db.sql(head.sha)}, log=${db.sql(output)} WHERE id=${db.sql(payload.deployment_id)}`);
    log('Deployment succeeded', payload.slug, head.sha || 'Git SSH deploy');
    return { ...result, commit_sha: head.sha };
  },
  async rollback(payload) {
    const site = payload.site || db.rows(`SELECT * FROM sites WHERE id=${db.sql(payload.site_id)}`)[0];
    if (!site) throw new Error('Site not found for rollback');
    const checkout = await agentForPayload(payload).invoke('checkoutRepository', payload.slug, payload.commit_sha);
    const applied = await applySiteConfig(site);
    const message = `Rolled back to ${checkout.sha}; config ${applied.status}`;
    db.run(`UPDATE deployments SET status='succeeded', commit_sha=${db.sql(checkout.sha)}, log=${db.sql(message)} WHERE id=${db.sql(payload.deployment_id)}`);
    log('Rollback succeeded', payload.slug, checkout.sha);
    return { checkout, applied };
  },
  async backup(payload) {
    const result = await agentForPayload(payload).invoke('createBackup', payload.site, payload.databases || [], payload.retention || {}, { destination: payload.destination || 'local', credentials: payload.credentials || {} });
    recordBackup(payload.site.id, result);
    log('Backup completed', payload.site.name || payload.site.slug, result.path);
    return result;
  },
  async dump(payload) {
    const secrets = require('./secrets');
    const database = { ...payload.database };
    if (payload.password_ciphertext) database.password = secrets.decrypt(payload.password_ciphertext);
    const result = await agentForPayload(payload).invoke('dumpDatabase', database, payload.destination, database.password || null);
    recordBackup(payload.site_id, result);
    log('Database dump completed', payload.database.db_name, result.path);
    return result;
  },
  async install(payload) {
    const output = await agentForPayload(payload).invoke('installSite', payload.site);
    log('Install commands completed', payload.site.name || payload.site.slug);
    return { output };
  },
  async migrateSiteUsers(payload) {
    const sites = payload.site_ids?.length
      ? payload.site_ids.map((id) => db.rows(`SELECT * FROM sites WHERE id=${db.sql(id)}`)[0]).filter(Boolean)
      : db.rows('SELECT * FROM sites ORDER BY created_at ASC').filter(needsUserMigration);
    const migrated = [];
    for (const site of sites) {
      const result = await agentForPayload({ ...payload, site }).invoke('migrateSiteUser', site.slug);
      db.run(`UPDATE sites SET run_as_user=${db.sql(result.run_as_user)}, updated_at=${db.sql(now())} WHERE id=${db.sql(site.id)}`);
      const updated = { ...site, run_as_user: result.run_as_user };
      await applySiteConfig(updated);
      migrated.push({ slug: site.slug, run_as_user: result.run_as_user, applied: result.applied });
    }
    log('Site user migration completed', 'panel', `${migrated.length} sites`);
    return { migrated };
  },
  async installPackage(payload) {
    const result = await agentForPayload(payload).invoke('installPackage', payload.package);
    log('Package installation completed', payload.package);
    return result;
  },
  async installPhp(payload) {
    const result = await agentForPayload(payload).invoke('installPhpVersion', payload.version, payload.extensions);
    log('PHP installation completed', payload.version);
    return result;
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
      if (job.type === 'deploy' || job.type === 'rollback') {
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

function enqueuePendingUserMigration() {
  const pending = db.rows('SELECT * FROM sites').filter(needsUserMigration);
  if (!pending.length) return null;
  const existing = db.rows(`SELECT id FROM jobs WHERE type='migrateSiteUsers' AND status IN ('queued','running') LIMIT 1`)[0];
  if (existing) return existing;
  return queue.enqueue('migrateSiteUsers', { site_ids: pending.map((site) => site.id), server_id: 'local' });
}

function start(intervalMs = 250) {
  enqueuePendingUserMigration();
  return setInterval(() => { tick().catch(() => {}); }, intervalMs);
}

module.exports = { tick, start, handlers, enqueuePendingUserMigration };
