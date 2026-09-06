const http = require('node:http');
const worker = require('./worker');
const { handleRequest } = require('./http-routes');

const port = Number(process.env.PORT || 4173);
const bind = process.env.PANEL_BIND || '127.0.0.1';

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((caught) => {
    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: caught.message }));
  });
});

if (require.main === module) {
  worker.start();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use on ${bind}.`);
      console.error(`Stop the other process (lsof -nP -iTCP:${port} -sTCP:LISTEN) or run with PORT=${port + 1} npm start`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, bind, () => console.log(`iQPanel listening on http://${bind}:${port}`));
}

module.exports = { server };
