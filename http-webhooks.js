const { send, rawBody, log } = require('./http-shared');
const db = require('./db');
const {
  getSiteById,
  webhookSecret,
  verifyGithubSignature,
  deliverySeen,
  recordDelivery,
  parseGithubPush,
  queueDeploy,
} = require('./deployments');

async function handleWebhooks(request, response, pathname) {
  const match = pathname.match(/^\/api\/webhooks\/github\/([^/]+)$/);
  if (!match || request.method !== 'POST') return false;

  const site = getSiteById(match[1]);
  if (!site) {
    send(response, 404, { error: 'Site not found' });
    return true;
  }

  const secret = webhookSecret(site);
  if (!secret) {
    send(response, 400, { error: 'Webhook secret is not configured for this site' });
    return true;
  }

  const raw = await rawBody(request);
  const signature = request.headers['x-hub-signature-256'];
  if (!verifyGithubSignature(raw, signature, secret)) {
    send(response, 401, { error: 'Invalid webhook signature' });
    return true;
  }

  const deliveryId = String(request.headers['x-github-delivery'] || '').trim();
  if (!deliveryId) {
    send(response, 400, { error: 'Missing GitHub delivery id' });
    return true;
  }
  if (deliverySeen(deliveryId)) {
    send(response, 200, { ok: true, deduplicated: true });
    return true;
  }

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    send(response, 400, { error: 'Invalid JSON payload' });
    return true;
  }

  if (payload.zen) {
    recordDelivery(site.id, deliveryId);
    send(response, 200, { ok: true, ping: true });
    return true;
  }

  if (payload.deleted) {
    recordDelivery(site.id, deliveryId);
    send(response, 200, { ok: true, ignored: true, reason: 'repository_deleted' });
    return true;
  }

  const event = String(request.headers['x-github-event'] || '').trim();
  if (event !== 'push') {
    recordDelivery(site.id, deliveryId);
    send(response, 200, { ok: true, ignored: true, reason: 'unsupported_event' });
    return true;
  }

  const parsed = parseGithubPush(payload, site);
  if (!parsed.accepted) {
    recordDelivery(site.id, deliveryId);
    send(response, 200, { ok: true, ignored: true, reason: parsed.reason, branch: parsed.branch || null });
    return true;
  }

  const queued = queueDeploy(site, {
    triggered_by: 'webhook',
    commit_sha: parsed.commit_sha,
    log: `Webhook deploy for ${parsed.commit_sha.slice(0, 7)}`,
  });
  recordDelivery(site.id, deliveryId);
  log('Webhook deploy queued', site.name, parsed.commit_sha);
  send(response, queued.deduplicated ? 200 : 202, {
    ok: true,
    deduplicated: queued.deduplicated,
    job_id: queued.job?.id || null,
    deployment_id: queued.deployment_id,
  });
  return true;
}

module.exports = { handleWebhooks };
