const { send, getSite, log, now, id, db, siteAgent, body } = require('./http-shared');

async function handleServices(request, response, pathname) {
  const match = pathname.match(/^\/api\/sites\/([^/]+)\/services(?:\/([^/]+)(?:\/(start|stop|restart))?)?$/);
  if (!match) return false;
  const site = getSite(match[1]);
  if (!site) {
    send(response, 404, { error: 'Site not found' });
    return true;
  }
  if (request.method === 'GET' && !match[2]) {
    send(response, 200, db.rows(`SELECT * FROM systemd_services WHERE site_id=${db.sql(site.id)} ORDER BY created_at DESC`));
    return true;
  }
  if (request.method === 'POST' && !match[2]) {
    const input = await body(request);
    const template = input.template || 'laravel-queue';
    const applied = await siteAgent(site).invoke('applySystemdUnit', site, template);
    const row = {
      id: id(),
      site_id: site.id,
      template,
      unit_name: applied.unitName,
      status: applied.applied ? 'running' : 'generated',
      created_at: now(),
    };
    db.run(`INSERT INTO systemd_services (id,site_id,template,unit_name,status,created_at) VALUES (${db.sql(row.id)},${db.sql(row.site_id)},${db.sql(row.template)},${db.sql(row.unit_name)},${db.sql(row.status)},${db.sql(row.created_at)})`);
    log('Service created', site.name, row.unit_name);
    send(response, 201, row);
    return true;
  }
  if (match[2] && match[3] && request.method === 'POST') {
    const service = db.rows(`SELECT * FROM systemd_services WHERE id=${db.sql(match[2])} AND site_id=${db.sql(site.id)}`)[0];
    if (!service) {
      send(response, 404, { error: 'Service not found' });
      return true;
    }
    const result = await siteAgent(site).invoke('controlSystemdUnit', service.unit_name, match[3]);
    const status = result.status || match[3];
    db.run(`UPDATE systemd_services SET status=${db.sql(status)} WHERE id=${db.sql(service.id)}`);
    send(response, 200, { ...service, status, result });
    return true;
  }
  if (match[2] && request.method === 'DELETE') {
    const service = db.rows(`SELECT * FROM systemd_services WHERE id=${db.sql(match[2])} AND site_id=${db.sql(site.id)}`)[0];
    if (!service) {
      send(response, 404, { error: 'Service not found' });
      return true;
    }
    await siteAgent(site).invoke('controlSystemdUnit', service.unit_name, 'disable');
    db.run(`DELETE FROM systemd_services WHERE id=${db.sql(service.id)}`);
    log('Service deleted', site.name, service.unit_name);
    send(response, 204, {});
    return true;
  }
  return false;
}

module.exports = { handleServices };
