// server/server.js
const WebSocket = require('ws');
const url = require('url');

const wss = new WebSocket.Server({ port: 8080 });

console.log("📡 WebSocket Relay Server running on port 8080");

wss.on('connection', function connection(ws, req) {
    const parsedUrl = url.parse(req.url, true);
    const roomId = parsedUrl.query.room || 'default-room';

    ws.roomId = roomId;
    console.log(`[連線] 新用戶加入了房間: ${roomId} (目前總連線數: ${wss.clients.size})`);

    ws.on('message', function incoming(message) {
        wss.clients.forEach(function each(client) {
            if (
                client !== ws && 
                client.readyState === WebSocket.OPEN && 
                client.roomId === ws.roomId // 🔒 關鍵隔離條件
            ) {
                // 確保以二進制格式轉發
                client.send(message, { binary: true }); 
            }
        });
    });

    ws.on('close', () => {
        console.log(`[離線] 一名用戶離開了房間: ${roomId}`);
    });
});