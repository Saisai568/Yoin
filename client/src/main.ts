// client/src/main.ts
// ============================================================
// Layer 4b: Control Loop — 連結 Logic Core ↔ DOM
// ============================================================
// 📌 責任：事件綁定、rAF 節流、DOM Diffing、渲染器切換
// 📌 不包含任何業務邏輯或 DOM 產生函式

import { initYoin, YoinClient, initPanicHook } from './yoin';
import { createDefaultCursor, createEmojiCursor, createAvatar } from './renderers';
import type { CursorRenderer, AwarenessState } from './yoin/types';
import './style.css';

// ==========================================
// 工具函式
// ==========================================
function log(msg: string) {
    const container = document.getElementById('log-container');
    if (container) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        container.prepend(entry);
    }
    console.log(msg);
}

async function bootstrap() {
    // ==========================================
    // 1. 初始化 WASM + Client
    // ==========================================
    log("🚀 正在啟動 WASM...");
    await initYoin();
    log("✅ WASM 載入完成");
    initPanicHook();
    log("✅ WASM Panic Hook 已啟動");

    const urlParams = new URLSearchParams(window.location.search);
    const currentRoom = urlParams.get('room') || 'default-room';

    const client = new YoinClient({
        url: 'ws://localhost:8080',
        dbName: `YoinDemoDB-${currentRoom}`,
        docId: currentRoom,
        awarenessThrottleMs: 30,
        heartbeatIntervalMs: 5000,
        heartbeatTimeoutMs: 30000,
    });

    (window as any).client = client;
    console.log("✅ Yoin Client 已掛載到 window.client");

    const docIdEl = document.getElementById('doc-id');
    if (docIdEl) docIdEl.innerText = currentRoom;

    // ==========================================
    // 2. Awareness：身分初始化
    // ==========================================
    const randomColors = ['#ff7675', '#74b9ff', '#55efc4', '#fdcb6e', '#a29bfe'];
    const myColor = randomColors[Math.floor(Math.random() * randomColors.length)];
    const myName = 'User_' + Math.floor(Math.random() * 100);
    const myClientId = client.getClientId();

    client.setAwareness({ name: myName, color: myColor });

    // ==========================================
    // 3. 🎯 rAF 節流的滑鼠輸入 (Performance: Input)
    // ==========================================
    let pendingCursor: { x: number; y: number } | null = null;
    let rafScheduled = false;

    window.addEventListener('mousemove', (e) => {
        pendingCursor = { x: e.clientX, y: e.clientY };
        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
                if (pendingCursor) {
                    client.setAwareness({
                        cursorX: pendingCursor.x,
                        cursorY: pendingCursor.y,
                    });
                    pendingCursor = null;
                }
                rafScheduled = false;
            });
        }
    });

    document.addEventListener('mouseleave', () => {
        pendingCursor = null;
        client.setAwareness({ cursorX: null, cursorY: null });
    });

    // ==========================================
    // 4. 渲染器切換
    // ==========================================
    let currentRenderer: CursorRenderer = createDefaultCursor;

    // 保存游標 DOM 元素的快取 (DOM Diffing 用)
    const cursorElements = new Map<string, HTMLElement>();

    const btnToggleCursor = document.getElementById('btn-toggle-cursor');
    if (btnToggleCursor) {
        btnToggleCursor.onclick = () => {
            if (currentRenderer === createDefaultCursor) {
                currentRenderer = createEmojiCursor;
                log("🔄 已切換為：Emoji 風格");
            } else {
                currentRenderer = createDefaultCursor;
                log("🔄 已切換為：標準風格");
            }
            // 清除所有游標快取，下一次 awareness 回呼時會用新渲染器重建
            cursorElements.forEach(el => el.remove());
            cursorElements.clear();
            client.notifyAwarenessListeners();
        };
    }

    // ==========================================
    // 5. 🌟 Awareness 渲染迴圈 (DOM Diffing)
    // ==========================================

    // 建立游標專用全螢幕圖層
    const cursorLayer = document.createElement('div');
    cursorLayer.id = 'cursor-layer';
    cursorLayer.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        pointer-events: none;
        z-index: 9999;
    `;
    document.body.appendChild(cursorLayer);

    client.onAwarenessChange((states: Map<string, AwarenessState>) => {
        // --- A. 更新右上角頭像列表 ---
        const avatarContainer = document.getElementById('awareness-container');
        if (avatarContainer) {
            avatarContainer.innerHTML = '<span style="font-size: 0.9rem; color: #666; margin-right: 5px;">在線成員:</span>';
            states.forEach((state, clientId) => {
                const isSelf = clientId === myClientId;
                const avatar = createAvatar(state.name, state.color, isSelf, clientId);
                avatarContainer.appendChild(avatar);
            });
        }

        // --- B. 🎯 DOM Diffing + CSS transform 游標渲染 ---
        // 收集本幀應該存在的遠端游標 ID
        const activeIds = new Set<string>();

        states.forEach((state, clientId) => {
            // 跳過自己 & 沒有座標的用戶
            if (clientId === myClientId || state.cursorX == null || state.cursorY == null) return;
            activeIds.add(clientId);

            let el = cursorElements.get(clientId);

            if (!el) {
                // 🆕 新使用者 → 建立游標 DOM 並加入圖層
                el = currentRenderer(state.color, state.name);
                el.id = `cursor-${clientId}`;
                // 🎯 CSS transition 實現硬體加速的平滑移動
                el.style.transition = 'transform 100ms linear';
                cursorLayer.appendChild(el);
                cursorElements.set(clientId, el);
            }

            // 🔄 更新位置 (Hardware Accelerated via CSS transform)
            el.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px)`;
        });

        // 🗑️ 移除已離線/無座標的舊游標
        for (const [clientId, el] of cursorElements.entries()) {
            if (!activeIds.has(clientId)) {
                el.remove();
                cursorElements.delete(clientId);
            }
        }

        // --- C. 白板物件選取邊框 (Selection Awareness) ---
        // 先清除所有選取邊框
        document.querySelectorAll('.shape').forEach(shape => {
            (shape as HTMLElement).style.border = '';
        });
        states.forEach((state) => {
            if (state.selection) {
                const el = document.getElementById(state.selection);
                if (el) {
                    el.style.border = `2px solid ${state.color}`;
                }
            }
        });
    });

    document.getElementById('connection-status')!.innerText = ' 連線中...';

    // ==========================================
    // 6. CRDT 資料訂閱 (Text / Map / Array)
    // ==========================================
    client.subscribe((text) => {
        // A. 文字
        const display = document.getElementById('display');
        if (display) display.innerText = text;

        // B. Map (設定檔)
        const mapData = client.getMap('app-settings');
        const mapDisplay = document.getElementById('map-display');
        if (mapDisplay) {
            mapDisplay.innerText = JSON.stringify(mapData, null, 2);
            if (mapData.themeColor) {
                const appContainer = document.getElementById('app-container');
                if (appContainer) {
                    appContainer.style.borderTop = `12px solid ${mapData.themeColor}`;
                    appContainer.style.transition = 'border-color 0.3s ease';
                }
                mapDisplay.style.borderLeft = `8px solid ${mapData.themeColor}`;
            }
        }

        // C. Array (歷史紀錄)
        const arrayData = client.getArray('action-logs');
        const arrayDisplay = document.getElementById('array-display');
        if (arrayDisplay) {
            arrayDisplay.innerHTML = '';
            if (arrayData.length === 0) {
                arrayDisplay.innerHTML = '<li>目前沒有日誌</li>';
            } else {
                arrayData.forEach(item => {
                    const li = document.createElement('li');
                    li.innerText = typeof item === 'object' ? JSON.stringify(item) : item;
                    arrayDisplay.appendChild(li);
                });
            }
        }
    });

    // ==========================================
    // 7. 按鈕綁定
    // ==========================================

    // 寫入測試文字
    const btnInsert = document.getElementById('btn-insert');
    if (btnInsert) {
        btnInsert.onclick = () => {
            const currentLen = client.getText().length;
            client.insertText(currentLen, " Hello! ");
        };
    }

    // 清空內容
    const btnClear = document.getElementById('btn-clear');
    if (btnClear) {
        btnClear.onclick = () => {
            client.clearText();
            log(`🗑️ 已清空筆記內容`);
        };
    }

    // 隨機切換主題顏色
    const btnUpdateMap = document.getElementById('btn-update-map');
    if (btnUpdateMap) {
        btnUpdateMap.onclick = () => {
            const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            client.setMap('app-settings', 'themeColor', randomColor);
            client.setMap('app-settings', 'lastUpdatedBy', myName);
            log(`🎨 已更新主題顏色為 ${randomColor}`);
        };
    }

    // 推入歷史紀錄
    const btnPushArray = document.getElementById('btn-push-array');
    if (btnPushArray) {
        btnPushArray.onclick = () => {
            const timeStr = new Date().toLocaleTimeString();
            client.pushArray('action-logs', { action: 'CLICK', time: timeStr });
            log(`➕ 已新增日誌紀錄`);
        };
    }

    // ==========================================
    // 8. 網路狀態 UI
    // ==========================================
    client.subscribeNetwork((status) => {
        const statusEl = document.getElementById('connection-status');
        if (!statusEl) return;

        if (status === 'online') {
            statusEl.innerText = '🟢 已連線';
            statusEl.className = 'status-indicator online';
        } else if (status === 'connecting') {
            statusEl.innerText = '🟡 連線中...';
            statusEl.className = 'status-indicator';
            statusEl.style.color = '#f39c12';
        } else {
            statusEl.innerText = '🔴 離線 (重連中...)';
            statusEl.className = 'status-indicator offline';
        }
    });

    // ==========================================
    // 9. 清理：離開時通知
    // ==========================================
    window.addEventListener('beforeunload', () => {
        client.leaveAwareness();
    });

    // ==========================================
    // 10. 白板物件選取 (Selection Awareness)
    // ==========================================
    document.querySelectorAll('.shape').forEach(el => {
        el.addEventListener('click', (e) => {
            const shapeId = (e.target as HTMLElement).id;
            client.setAwareness({ selection: shapeId });
        });
    });
}

bootstrap().catch(err => {
    console.error("啟動失敗:", err);
});