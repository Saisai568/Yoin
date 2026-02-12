// server/server.js
const WebSocket = require('ws');
const url = require('url');
const { YoinDoc } = require('../core/pkg-node'); 

const wss = new WebSocket.Server({ port: 8080 });

// ==========================================
// 🧠 伺服器端的「大腦」：房間管理器
// ==========================================
// 結構: { [roomId]: { doc: YoinDoc, updateCount: number, clients: Set<WebSocket> } }
const rooms = new Map();

// 設定壓縮閾值：每累積 50 個小更新，就執行一次壓縮
const COMPACTION_THRESHOLD = 50;

console.log("🚀 Yoin Smart Server (with Snapshot & Compaction) 啟動於 8080");

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        console.log(`[Server] 初始化新房間: ${roomId}`);
        rooms.set(roomId, {
            doc: new YoinDoc(), // Rust WASM 物件
            updateCount: 0,
            clients: new Set()
        });
        // TODO: 如果有做資料庫，這裡應該要 loadFromDB(roomId) 並 doc.apply_update(data)
    }
    return rooms.get(roomId);
}

wss.on('connection', function connection(ws, req) {
    const parsedUrl = url.parse(req.url, true);
    const roomId = parsedUrl.query.room || 'default';
    
    // 1. 加入房間
    const room = getRoom(roomId);
    room.clients.add(ws);
    ws.roomId = roomId;

    console.log(`[連線] 用戶進入 ${roomId} (在線: ${room.clients.size})`);

    // ==========================================
    // 🔄 協議處理 (Binary Protocol)
    // ==========================================
    ws.on('message', function incoming(message) {
        // 確保訊息是 Uint8Array
        const data = new Uint8Array(message);
        const type = data[0];
        const payload = data.slice(1);

        // 定義協議常數 (需與前端一致)
        const MSG_SYNC_STEP_1 = 0;       // Client -> Server: 這是我的 SV，請給我 Diff
        const MSG_SYNC_STEP_2 = 1;       // Client -> Server: 這是我的更新 (Update)
        const MSG_SYNC_STEP_1_REPLY = 2; // (通常 Server 用不到這個，因為 Server 是權威)
        const MSG_AWARENESS = 3;

        if (type === MSG_SYNC_STEP_1) {
            // 【場景 A：新用戶連線，請求同步】
            console.log(`[Sync] 用戶請求同步 ${roomId}`);
            
            // 🟢 Smart Server: 計算「客戶端缺少的 Diff」
            // 這裡不再需要廣播給別人，而是直接回傳給這個新用戶
            const missingUpdate = room.doc.get_missing_updates(payload);
            
            // 回傳 MSG_SYNC_STEP_2 (Update) 給該用戶
            const response = new Uint8Array(missingUpdate.length + 1);
            response[0] = MSG_SYNC_STEP_2;
            response.set(missingUpdate, 1);
            ws.send(response);

        } else if (type === MSG_SYNC_STEP_2) {
            // 【場景 B：用戶發送更新】
            
            // 1. 🟢 寫入伺服器記憶體 (保持伺服器數據最新)
            try {
                room.doc.apply_update(payload);
                room.updateCount++;
            } catch (e) {
                console.error("Rust Apply Error:", e);
                return; // 壞掉的更新不廣播
            }

            // 2. 廣播給房間內「其他人」
            room.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(data);
                }
            });

            // 3. 🟢 觸發快照壓縮 (Compaction)
            if (room.updateCount >= COMPACTION_THRESHOLD) {
                performCompaction(roomId, room);
            }

        } else if (type === MSG_AWARENESS) {
            // 感知訊息不進資料庫，直接轉發
            room.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(data);
                }
            });
        }
    });

    ws.on('close', () => {
        const room = rooms.get(ws.roomId);
        if (room) {
            room.clients.delete(ws);
            if (room.clients.size === 0) {
                // 可選擇：沒人時是否要釋放記憶體？
                // rooms.delete(ws.roomId); 
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
    
    // 1. 從 Rust 取得極小的 Snapshot (已合併歷史)
    const snapshot = room.doc.snapshot();
    
    // 2. (模擬) 寫入硬碟/資料庫
    // fs.writeFileSync(`./db/${roomId}.yoin`, snapshot);
    console.log(`[Compaction] 房間 ${roomId} 執行壓縮。大小: ${snapshot.length} bytes`);

    // 3. 重置計數器
    room.updateCount = 0;
    
    console.timeEnd(`Compaction-${roomId}`);
}