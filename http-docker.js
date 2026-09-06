const { send, body, getSite, log, agentClient } = require('./http-shared');

async function handleDocker(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/docker') {
    send(response, 200, await agentClient.invoke('dockerStatus'));
    return true;
  }
  const actionMatch = pathname.match(/^\/api\/docker\/containers\/([^/]+)\/(start|stop|restart|remove)$/);
  if (actionMatch && request.method === 'POST') {
    const result = await agentClient.invoke('dockerAction', actionMatch[1], actionMatch[2]);
    log('Docker action', actionMatch[1], actionMatch[2]);
    send(response, 200, result);
    return true;
  }
  const logsMatch = pathname.match(/^\/api\/docker\/containers\/([^/]+)\/logs$/);
  if (logsMatch && request.method === 'GET') {
    send(response, 200, await agentClient.invoke('dockerLogs', logsMatch[1]));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/docker/compose') {
    const input = await body(request);
    const site = getSite(input.site_slug);
    if (!site) throw new Error('Site not found');
    const result = await agentClient.invoke('dockerCompose', site, input.action || 'up');
    log('Docker compose', site.name, input.action || 'up');
    send(response, 200, result);
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/docker/prune') {
    const result = await agentClient.invoke('dockerPrune');
    log('Docker prune', 'engine');
    send(response, 200, result);
    return true;
  }
  return false;
}

module.exports = { handleDocker };
