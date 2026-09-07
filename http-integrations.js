const { send, body, db, secrets, log, agentClient } = require('./http-shared');

function setting(key) {
  return db.rows(`SELECT value FROM settings WHERE key=${db.sql(key)}`)[0]?.value || '';
}

function writeSetting(key, value) {
  db.run(`INSERT INTO settings(key,value) VALUES (${db.sql(key)},${db.sql(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
}

function assertDnsInput(input) {
  const type = String(input.type || '').toUpperCase();
  if (!['A', 'AAAA', 'CNAME'].includes(type)) throw new Error('DNS type must be A, AAAA, or CNAME');
  const name = String(input.name || '').trim().toLowerCase();
  if (!/^(?:[a-z0-9*](?:[a-z0-9*.-]*[a-z0-9*])?)$/.test(name) || name.length > 253) throw new Error('Invalid DNS name');
  const content = String(input.content || '').trim();
  if (!content || content.length > 253 || /[\r\n]/.test(content)) throw new Error('Invalid DNS content');
  return { type, name, content, ttl: Math.max(60, Math.min(86400, Number(input.ttl) || 1)), proxied: Boolean(input.proxied) };
}

async function cloudflare(request, response) {
  const input = await body(request);
  if (request.method === 'PUT') {
    if (!input.token || String(input.token).length < 20) throw new Error('A valid Cloudflare API token is required');
    writeSetting('cloudflare_api_token', secrets.encrypt(String(input.token)));
    log('Cloudflare token updated', 'panel');
    send(response, 200, { configured: true });
    return true;
  }
  const cipher = setting('cloudflare_api_token');
  if (!cipher) throw new Error('Cloudflare API token is not configured');
  const zone = String(input.zone_id || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(zone)) throw new Error('Invalid Cloudflare zone ID');
  const token = secrets.decrypt(cipher);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const recordId = input.record_id ? String(input.record_id).replace(/[^a-zA-Z0-9-]/g, '') : '';
  const action = input.action === 'delete' ? 'delete' : 'upsert';
  if (action === 'delete' && !recordId) throw new Error('record_id is required to delete a DNS record');
  const record = action === 'delete' ? null : assertDnsInput(input);
  const endpoint = `https://api.cloudflare.com/client/v4/zones/${zone}/dns_records${recordId ? `/${recordId}` : ''}`;
  const result = await fetch(endpoint, {
    method: action === 'delete' ? 'DELETE' : 'POST',
    headers,
    body: action === 'delete' ? undefined : JSON.stringify(record),
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok || payload.success === false) throw new Error(payload.errors?.[0]?.message || `Cloudflare returned ${result.status}`);
  log(`Cloudflare DNS ${action}`, record?.name || recordId, record?.type || 'record');
  send(response, 200, { success: true, result: payload.result || null });
  return true;
}

async function handleIntegrations(request, response, pathname) {
  if (pathname === '/api/system/cloudflare') {
    if (request.method === 'GET') { send(response, 200, { configured: Boolean(setting('cloudflare_api_token')) }); return true; }
    if (request.method === 'PUT' || request.method === 'POST') return cloudflare(request, response);
  }
  if (pathname === '/api/system/cloudflare/dns' && request.method === 'POST') return cloudflare(request, response);
  if (pathname === '/api/system/fail2ban') {
    if (request.method === 'GET') { send(response, 200, await agentClient.invoke('fail2banStatus')); return true; }
    const input = await body(request);
    const result = input.action === 'configure'
      ? await agentClient.invoke('configureFail2Ban')
      : await agentClient.invoke('fail2banAction', input.action, input.jail, input.ip);
    log('Fail2Ban updated', input.jail || 'panel', input.action || 'configure');
    send(response, 200, result);
    return true;
  }
  if (pathname === '/api/system/swap' && request.method === 'POST') {
    const input = await body(request);
    const result = await agentClient.invoke('swap', input.action, input.size_mb);
    log('Swap updated', 'system', input.action);
    send(response, 200, result);
    return true;
  }
  if (pathname === '/api/system/disk/extend' && request.method === 'POST') {
    const input = await body(request);
    const result = await agentClient.invoke('extendDisk', input.device, input.mode, input.confirm === true);
    log('Disk extension requested', input.device, result.dry_run ? 'dry-run' : 'applied');
    send(response, 200, result);
    return true;
  }
  if (pathname === '/api/system/ssh-keys') {
    if (request.method === 'GET') { send(response, 200, await agentClient.invoke('listAuthorizedKeys')); return true; }
    const input = await body(request);
    const result = await agentClient.invoke('manageAuthorizedKey', input.action, input.key);
    log('SSH authorized key updated', 'root', input.action);
    send(response, 200, result);
    return true;
  }
  if (pathname === '/api/system/mail') {
    if (request.method === 'GET') { send(response, 200, await agentClient.invoke('mailStatus')); return true; }
    const input = await body(request);
    const result = await agentClient.invoke('configureMail', input.domain);
    log('Mail server configured', input.domain);
    send(response, 200, result);
    return true;
  }
  if (pathname === '/api/system/phpmyadmin' && request.method === 'POST') {
    const input = await body(request);
    const result = await agentClient.invoke('installPhpMyAdmin', input.domain);
    log('phpMyAdmin installation requested', input.domain || 'localhost');
    send(response, 200, result);
    return true;
  }
  if (pathname === '/api/system/openlitespeed' && request.method === 'GET') {
    send(response, 200, await agentClient.invoke('systemCapabilities'));
    return true;
  }
  if (pathname === '/api/system/openlitespeed' && request.method === 'POST') {
    const input = await body(request);
    const result = await agentClient.invoke('controlOpenLiteSpeed', input.action);
    log('OpenLiteSpeed service updated', 'lsws', input.action);
    send(response, 200, result);
    return true;
  }
  return false;
}

module.exports = { handleIntegrations };
