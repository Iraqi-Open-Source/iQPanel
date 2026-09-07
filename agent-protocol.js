const crypto = require('node:crypto');

function attachAgentProtocol(connection, actions, expectedToken) {
  let input = '';
  const reply = (payload) => {
    connection.end(JSON.stringify(payload));
  };
  connection.on('data', async (chunk) => {
    input += chunk;
    if (!input.includes('\n') && input.length < 1e6) return;
    const raw = input.trim();
    input = '';
    try {
      const request = JSON.parse(raw);
      const provided = Buffer.from(String(request.token || ''));
      const expected = Buffer.from(expectedToken);
      if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) throw new Error('Unauthorized Agent client');
      if (typeof actions[request.action] !== 'function') throw new Error('Unsupported Agent action');
      const result = await actions[request.action](...(request.args || []));
      reply({ ok: true, result });
    } catch (error) {
      reply({ ok: false, error: error.message });
    }
  });
}

module.exports = { attachAgentProtocol };
