const crypto = require('node:crypto');
const db = require('./db');
const queue = require('./queue');
const secrets = require('./secrets');

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function getSiteById(siteId) {
  return db.rows(`SELECT * FROM sites WHERE id=${db.sql(siteId)}`)[0];
}

function webhookSecret(site) {
  if (!site?.webhook_secret_ciphertext) return null;
  return secrets.decrypt(site.webhook_secret_ciphertext);
}

function ensureWebhookSecret(siteId) {
  const site = getSiteById(siteId);
  if (!site) throw new Error('Site not found');
  const existing = webhookSecret(site);
  if (existing) return existing;
  const secret = crypto.randomBytes(32).toString('hex');
  db.run(`UPDATE sites SET webhook_secret_ciphertext=${db.sql(secrets.encrypt(secret))}, updated_at=${db.sql(now())} WHERE id=${db.sql(siteId)}`);
  return secret;
}

function rotateWebhookSecret(siteId) {
  const site = getSiteById(siteId);
  if (!site) throw new Error('Site not found');
  const secret = crypto.randomBytes(32).toString('hex');
  db.run(`UPDATE sites SET webhook_secret_ciphertext=${db.sql(secrets.encrypt(secret))}, updated_at=${db.sql(now())} WHERE id=${db.sql(siteId)}`);
  return secret;
}

function deployConfig(site, requestHost = 'localhost') {
  const host = requestHost || 'localhost';
  return {
    deploy_branch: site.deploy_branch || 'main',
    webhook_url: `http://${host}/api/webhooks/github/${site.id}`,
    webhook_configured: Boolean(site.webhook_secret_ciphertext),
  };
}

function activeDeployJob(siteId) {
  const jobs = db.rows(`SELECT * FROM jobs WHERE type IN ('deploy','rollback') AND status IN ('queued','running') ORDER BY created_at ASC`);
  return jobs.find((job) => {
    try {
      const payload = JSON.parse(job.payload || '{}');
      return payload.site_id === siteId;
    } catch {
      return false;
    }
  }) || null;
}

function queueDeploy(site, { triggered_by = 'admin', commit_sha = null, log = null } = {}) {
  const existing = activeDeployJob(site.id);
  if (existing) {
    let deploymentId = null;
    try { deploymentId = JSON.parse(existing.payload || '{}').deployment_id || null; } catch {}
    return { deduplicated: true, job: existing, deployment_id: deploymentId };
  }
  const deploymentId = id();
  const message = log || `Deploy queued by ${triggered_by}`;
  db.run(`INSERT INTO deployments (id,site_id,commit_sha,status,log,triggered_by,created_at) VALUES (${db.sql(deploymentId)},${db.sql(site.id)},${db.sql(commit_sha)},'queued',${db.sql(message)},${db.sql(triggered_by)},${db.sql(now())})`);
  const job = queue.enqueue('deploy', {
    site_id: site.id,
    slug: site.slug,
    repo_url: site.repo_url,
    deployment_id: deploymentId,
    server_id: site.server_id || 'local',
    triggered_by,
  });
  return { deduplicated: false, job, deployment_id: deploymentId };
}

function queueRollback(site, deployment) {
  if (activeDeployJob(site.id)) throw new Error('A deploy job is already in progress for this site');
  if (!deployment.commit_sha) throw new Error('Deployment has no recorded commit SHA');
  const deploymentId = id();
  db.run(`INSERT INTO deployments (id,site_id,commit_sha,status,log,triggered_by,created_at) VALUES (${db.sql(deploymentId)},${db.sql(site.id)},${db.sql(deployment.commit_sha)},'queued',${db.sql(`Rollback to ${deployment.commit_sha}`)},'rollback',${db.sql(now())})`);
  const job = queue.enqueue('rollback', {
    site_id: site.id,
    site,
    slug: site.slug,
    commit_sha: deployment.commit_sha,
    deployment_id: deploymentId,
    server_id: site.server_id || 'local',
    source_deployment_id: deployment.id,
  });
  return { job, deployment_id: deploymentId };
}

function verifyGithubSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expected = `sha256=${digest}`;
  const provided = Buffer.from(signatureHeader);
  const target = Buffer.from(expected);
  if (provided.length !== target.length) return false;
  return crypto.timingSafeEqual(provided, target);
}

function deliverySeen(deliveryId) {
  return db.rows(`SELECT id FROM webhook_deliveries WHERE delivery_id=${db.sql(deliveryId)} LIMIT 1`)[0];
}

function recordDelivery(siteId, deliveryId) {
  db.run(`INSERT INTO webhook_deliveries (id,site_id,delivery_id,created_at) VALUES (${db.sql(id())},${db.sql(siteId)},${db.sql(deliveryId)},${db.sql(now())})`);
}

function parseGithubPush(payload, site) {
  const branch = site.deploy_branch || 'main';
  if (payload.ref && payload.ref !== `refs/heads/${branch}`) {
    return { accepted: false, reason: 'branch_mismatch', branch };
  }
  const commitSha = String(payload.after || payload.head_commit?.id || '').trim();
  if (!commitSha || /^0+$/.test(commitSha)) {
    return { accepted: false, reason: 'missing_commit' };
  }
  return { accepted: true, commit_sha: commitSha, branch };
}

module.exports = {
  getSiteById,
  webhookSecret,
  ensureWebhookSecret,
  rotateWebhookSecret,
  deployConfig,
  activeDeployJob,
  queueDeploy,
  queueRollback,
  verifyGithubSignature,
  deliverySeen,
  recordDelivery,
  parseGithubPush,
};
