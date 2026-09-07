const { send, getSite, log, body, now, db } = require('./http-shared');
const { queueRollback, deployConfig, rotateWebhookSecret, ensureWebhookSecret } = require('./deployments');

async function handleDeployments(request, response, pathname, requestHost) {
  const rollbackMatch = pathname.match(/^\/api\/sites\/([^/]+)\/deployments\/([^/]+)\/rollback$/);
  if (rollbackMatch && request.method === 'POST') {
    const site = getSite(rollbackMatch[1]);
    if (!site) {
      send(response, 404, { error: 'Site not found' });
      return true;
    }
    const deployment = db.rows(`SELECT * FROM deployments WHERE id=${db.sql(rollbackMatch[2])} AND site_id=${db.sql(site.id)}`)[0];
    if (!deployment) {
      send(response, 404, { error: 'Deployment not found' });
      return true;
    }
    if (deployment.status !== 'succeeded' || !deployment.commit_sha) {
      throw new Error('Only successful deployments with a recorded commit can be rolled back');
    }
    const queued = queueRollback(site, deployment);
    log('Rollback queued', site.name, deployment.commit_sha);
    send(response, 202, { status: 'queued', job_id: queued.job.id, deployment_id: queued.deployment_id });
    return true;
  }

  const webhookMatch = pathname.match(/^\/api\/sites\/([^/]+)\/webhook(?:\/(rotate))?$/);
  if (webhookMatch) {
    const site = getSite(webhookMatch[1]);
    if (!site) {
      send(response, 404, { error: 'Site not found' });
      return true;
    }
    if (request.method === 'GET') {
      send(response, 200, deployConfig(site, requestHost));
      return true;
    }
    if (request.method === 'POST' && webhookMatch[2] === 'rotate') {
      rotateWebhookSecret(site.id);
      log('Webhook secret rotated', site.name);
      send(response, 200, deployConfig(getSite(site.slug), requestHost));
      return true;
    }
  }

  const deploySettingsMatch = pathname.match(/^\/api\/sites\/([^/]+)\/deploy$/);
  if (deploySettingsMatch && request.method === 'PATCH') {
    const site = getSite(deploySettingsMatch[1]);
    if (!site) {
      send(response, 404, { error: 'Site not found' });
      return true;
    }
    const input = await body(request);
    const branch = input.deploy_branch === undefined ? site.deploy_branch : String(input.deploy_branch || 'main').trim();
    if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch)) throw new Error('Invalid deploy branch');
    db.run(`UPDATE sites SET deploy_branch=${db.sql(branch)}, updated_at=${db.sql(now())} WHERE id=${db.sql(site.id)}`);
    ensureWebhookSecret(site.id);
    const updated = getSite(site.slug);
    log('Deploy settings updated', site.name, branch);
    send(response, 200, { ...updated, ...deployConfig(updated, requestHost) });
    return true;
  }

  return false;
}

module.exports = { handleDeployments };
