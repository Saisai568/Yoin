// server/server.js
// ============================================================
// Layer 2: Transport — Blind Relay + Smart Sync Server
// ============================================================
const WebSocket = require('ws');
const url = require('url');
const { YoinDoc } = require('../core/pkg-node'); 

const wss = new WebSocket.Server({ port: 8080 });

// ==========================================
// 通訊協議常數 (需與前端一致)
// ==========================================
const MSG_SYNC_STEP_1 = 0;       // Client → Server: State Vector 請求
const MSG_SYNC_STEP_2 = 1;       // Client ↔ Server: 實質更新 (Update / Diff)
const MSG_SYNC_STEP_1_REPLY = 2; // Server → Client: 雙向同步回應
const MSG_AWARENESS = 3;         // Awareness: Blind Relay (不解析、不儲存)

// ==========================================
// 🧠 房間管理器
// ==========================================
const rooms = new Map();
const COMPACTION_THRESHOLD = 50;

console.log("🚀 Yoin Smart Server (v2.0 with Blind Relay Awareness) 啟動於 8080");

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        console.log(`[Server] 初始化新房間: ${roomId}`);
        rooms.set(roomId, {
            doc: new YoinDoc(),
            updateCount: 0,
            clients: new Set()
        });
    }
    return rooms.get(roomId);
}

/**
 * 廣播工具：將原始訊息轉發給房間內除了發送者以外的所有人
 * 用於 Awareness Blind Relay 及 CRDT 更新轉發
 */
function broadcastToOthers(room, sender, data) {
    room.clients.forEach(client => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

wss.on('connection', function connection(ws, req) {
    const parsedUrl = url.parse(req.url, true);
    const roomId = parsedUrl.query.room || 'default';
    
    const room = getRoom(roomId);
    room.clients.add(ws);
    ws.roomId = roomId;

    console.log(`[連線] 用戶進入 ${roomId} (在線: ${room.clients.size})`);

    // ==========================================
    // 🔄 協議處理 (Binary Protocol)
    // ==========================================
    ws.on('message', function incoming(message) {
        const data = new Uint8Array(message);
        if (data.length === 0) return;

        const type = data[0];
        const payload = data.slice(1);

        switch (type) {
            case MSG_SYNC_STEP_1: {
                // 【新用戶連線：計算並回傳缺少的 Diff】
                console.log(`[Sync] 用戶請求同步 ${roomId}`);
                const missingUpdate = room.doc.get_missing_updates(payload);
                const response = new Uint8Array(missingUpdate.length + 1);
                response[0] = MSG_SYNC_STEP_2;
                response.set(missingUpdate, 1);
                ws.send(response);
                break;
            }

            case MSG_SYNC_STEP_2: {
                // 【CRDT 更新：寫入 + 廣播 + 壓縮】
                try {
                    room.doc.apply_update(payload);
                    room.updateCount++;
                } catch (e) {
                    console.error("Rust Apply Error:", e);
                    return;
                }
                broadcastToOthers(room, ws, data);

                if (room.updateCount >= COMPACTION_THRESHOLD) {
                    performCompaction(roomId, room);
                }
                break;
            }

            case MSG_AWARENESS: {
                // 【🎯 Blind Relay：不解析、不儲存、直接轉發】
                broadcastToOthers(room, ws, data);
                break;
            }

            default:
                console.warn(`[Server] 未知訊息類型: ${type}`);
        }
    });

    ws.on('close', () => {
        const room = rooms.get(ws.roomId);
        if (room) {
            room.clients.delete(ws);
            if (room.clients.size === 0) {
                console.log(`[Server] 房間 ${ws.roomId} 已空，快照暫存於記憶體`);
            }
        }
    });
});

// ==========================================
// 💾 壓縮邏輯
// ==========================================
function performCompaction(roomId, room) {
    console.time(`Compaction-${roomId}`);
    const snapshot = room.doc.snapshot();
    console.log(`[Compaction] 房間 ${roomId} 執行壓縮。大小: ${snapshot.length} bytes`);
    room.updateCount = 0;
    console.timeEnd(`Compaction-${roomId}`);
}