const { send } = require('./http-shared');
const runtimes = require('./runtimes');

async function handleRuntimes(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/runtimes') {
    send(response, 200, runtimes.list());
    return true;
  }
  return false;
}

module.exports = { handleRuntimes };
