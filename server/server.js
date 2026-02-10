// server/server.js
const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 8080 });

console.log("📡 WebSocket Relay Server running on port 8080");

wss.on('connection', function connection(ws) {
  console.log('➕ New client connected');

  ws.on('message', function message(data, isBinary) {
    // 收到訊息後，廣播給「除了自己以外」的所有人
    wss.clients.forEach(function each(client) {
      if (client !== ws && client.readyState === 1) { // 1 = OPEN
        client.send(data, { binary: isBinary });
      }
    });
  });

  ws.on('close', () => console.log('➖ Client disconnected'));
});