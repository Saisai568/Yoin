const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

// ==========================================
// 1. Protocol Constants
// ==========================================
// 必須與前端 YoinClient.ts 保持一致
const MSG_SYNC_STEP_1 = 0;
const MSG_SYNC_STEP_2 = 1;
const MSG_SYNC_STEP_1_REPLY = 2;
const MSG_AWARENESS = 3;
const MSG_JOIN_ROOM = 4; // [New]

// ==========================================
// 2. Room State Management
// ==========================================
// Map<RoomID, Set<WebSocket>>
const rooms = new Map();

// Map<WebSocket, RoomID> (Reverse lookup for quick disconnect handling)
const clientRooms = new Map();

console.log('🚀 Yoin Room-Aware Server running on ws://localhost:8080');

wss.on('connection', (ws) => {
    console.log('[Server] New connection established');

    ws.on('message', (message) => {
        // Convert to Uint8Array for consistent handling
        const data = new Uint8Array(message);
        const type = data[0];
        const payload = data.slice(1);

        // ------------------------------------------------
        // Case A: Handshake - Join Room
        // ------------------------------------------------
        if (type === MSG_JOIN_ROOM) {
            const roomId = new TextDecoder().decode(payload);
            
            // 1. If client was already in a room, leave it first
            const oldRoom = clientRooms.get(ws);
            if (oldRoom) {
                leaveRoom(ws, oldRoom);
            }

            // 2. Join the new room
            joinRoom(ws, roomId);
            return;
        }

        // ------------------------------------------------
        // Case B: Broadcast (Sync/Awareness)
        // ------------------------------------------------
        const currentRoom = clientRooms.get(ws);
        if (currentRoom) {
            broadcastToRoom(ws, currentRoom, data);
        } else {
            // Client hasn't joined a room yet, ignore message or log warning
            // console.warn('[Server] Client sent message before joining a room');
        }
    });

    ws.on('close', () => {
        const currentRoom = clientRooms.get(ws);
        if (currentRoom) {
            leaveRoom(ws, currentRoom);
        }
        console.log('[Server] Connection closed');
    });

    ws.on('error', (err) => {
        console.error('[Server] Connection error:', err);
    });
});

// ==========================================
// 3. Helper Functions
// ==========================================

function joinRoom(ws, roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
        console.log(`[Room] Created new room: "${roomId}"`);
    }
    
    const room = rooms.get(roomId);
    room.add(ws);
    clientRooms.set(ws, roomId);
    
    console.log(`[Room] Client joined "${roomId}" (Total: ${room.size})`);
}

function leaveRoom(ws, roomId) {
    const room = rooms.get(roomId);
    if (room) {
        room.delete(ws);
        clientRooms.delete(ws);
        
        console.log(`[Room] Client left "${roomId}" (Total: ${room.size})`);

        // Auto-cleanup empty rooms to save memory
        if (room.size === 0) {
            rooms.delete(roomId);
            console.log(`[Room] Destroyed empty room: "${roomId}"`);
        }
    }
}

function broadcastToRoom(sender, roomId, data) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.forEach((client) => {
        // Don't send back to sender, and ensure client is open
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}