const PUBLIC_PORT_START = 8010;
const PUBLIC_PORT_END = 8999;
const APP_PORT_START = 9100;
const APP_PORT_END = 9999;

function nextAvailable(used, start, end) {
  for (let port = start; port <= end; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new Error('No available ports in configured range');
}

function allocatePorts(existingSites = []) {
  const usedPublic = new Set(existingSites.map((site) => Number(site.port)).filter(Boolean));
  const usedApp = new Set(existingSites.map((site) => Number(site.app_port)).filter(Boolean));
  return {
    port: nextAvailable(usedPublic, PUBLIC_PORT_START, PUBLIC_PORT_END),
    app_port: nextAvailable(usedApp, APP_PORT_START, APP_PORT_END),
  };
}

function nginxListenPort(site) {
  return site.domain ? 80 : Number(site.port);
}

function upstreamPort(site) {
  if (site.type === 'php' || site.type === 'static') return null;
  return Number(site.app_port || site.port);
}

module.exports = {
  PUBLIC_PORT_START,
  PUBLIC_PORT_END,
  APP_PORT_START,
  APP_PORT_END,
  allocatePorts,
  nginxListenPort,
  upstreamPort,
};
