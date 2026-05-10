'use strict';

const { WebSocketServer } = require('ws');

async function startMockServer({ onMessage } = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => wss.on('listening', resolve));
  const port = wss.address().port;

  wss.on('connection', ws => {
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (onMessage) onMessage(msg, ws);
    });
  });

  return {
    port,
    wss,
    async stop() {
      await new Promise(resolve => wss.close(resolve));
    },
    broadcast(payload) {
      const data = JSON.stringify(payload);
      for (const ws of wss.clients) ws.send(data);
    }
  };
}

module.exports = { startMockServer };
