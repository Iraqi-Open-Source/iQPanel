import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { get, run } from '../../data/db.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

const DATA_ROOT = process.env.PANEL_DATA_ROOT ?? '/var/lib/iqpanel';

export function registerWebhooks(app) {
  // POST /api/webhooks/github/:siteId
  app.post('/api/webhooks/github/:siteId', async (req, res) => {
    const site = get('SELECT * FROM sites WHERE id = ?', [req.params.siteId]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    if (!site.webhook_secret) {
      return res.status(400).json({ error: 'Webhook not configured' });
    }

    const sig       = req.headers['x-hub-signature-256'] ?? '';
    const body      = req.rawBody ?? Buffer.alloc(0);
    const hmac      = createHmac('sha256', site.webhook_secret).update(body).digest('hex');
    const expected  = Buffer.from(`sha256=${hmac}`);
    const provided  = Buffer.from(String(sig));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Deduplication
    const deliveryId = req.headers['x-github-delivery'];
    if (deliveryId) {
      const seen = get('SELECT id FROM webhook_deliveries WHERE delivery_id = ?', [deliveryId]);
      if (seen) return res.status(200).json({ ok: true, deduplicated: true });
      run('INSERT INTO webhook_deliveries (id,site_id,delivery_id,created_at) VALUES (?,?,?,?)',
        [uuid(), site.id, deliveryId, nowIso()]);
    }

    const event = req.headers['x-github-event'];
    if (event !== 'push') return res.status(200).json({ ok: true, ignored: event });

    let payload = {};
    try { payload = typeof req.body === 'object' ? req.body : JSON.parse(req.rawBody ?? '{}'); } catch {}

    const branch = site.deploy_branch ?? 'main';
    if (payload.ref && payload.ref !== `refs/heads/${branch}`) {
      return res.status(200).json({ ok: true, ignored: 'branch_mismatch' });
    }

    const commitSha = String(payload.after ?? payload.head_commit?.id ?? '').trim();
    const deployId  = uuid();
    const logPath   = join(DATA_ROOT, 'deploy-logs', `${deployId}.log`);
    mkdirSync(join(DATA_ROOT, 'deploy-logs'), { recursive: true });

    run('INSERT INTO deployments (id,site_id,commit_sha,status,log_path,triggered_by,created_at) VALUES (?,?,?,?,?,?,?)',
      [deployId, site.id, commitSha || null, 'queued', logPath, 'webhook', nowIso()]);
    run('INSERT INTO jobs (id,type,payload,status,attempts,max_attempts,last_error,run_after,created_at,updated_at) VALUES (?,?,?,?,0,3,?,?,?,?)',
      [uuid(), 'deploy', JSON.stringify({ site_id: site.id, deployment_id: deployId }), 'queued', '', nowIso(), nowIso(), nowIso()]);

    res.json({ ok: true, deployment_id: deployId });
  });

  // POST /api/sites/:slug/webhook/secret  – rotate webhook secret
  app.post('/api/sites/:slug/webhook/secret', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const secret = randomBytes(32).toString('hex');
    run('UPDATE sites SET webhook_secret = ?, updated_at = ? WHERE id = ?', [secret, nowIso(), site.id]);
    res.json({ secret, webhook_url: webhookUrl(req, site.id) });
  });

  // GET /api/sites/:slug/webhook
  app.get('/api/sites/:slug/webhook', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({
      configured: Boolean(site.webhook_secret),
      webhook_url: webhookUrl(req, site.id),
      deploy_branch: site.deploy_branch,
    });
  });
}

function webhookUrl(req, siteId) {
  const host = req.headers.host ?? 'localhost';
  return `http://${host}/api/webhooks/github/${siteId}`;
}
