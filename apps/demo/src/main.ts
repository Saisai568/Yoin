// client/src/main.ts
import {
  initYoin,
  YoinClient,
  createUndoPlugin,
  createDbPlugin,
  createLoggerPlugin,
  createMapProxy,
  createArrayProxy,
} from '@yoin/client';
import type { CursorRenderer, AwarenessState } from '@yoin/client';
import { createDefaultCursor, createEmojiCursor, createAvatar } from './renderers';
import { z } from 'zod';
import './style.css';

// ==========================================
// Tool function log: output to the page and console at the same time
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
    // 1. Init WASM + Client
    // ==========================================
    log("Starting WASM...");
    await initYoin();
    log("WASM loaded successfully");

    const urlParams = new URLSearchParams(window.location.search);
    const currentRoom = urlParams.get('room') || 'default-room';

    // ==========================================
    // Micro-kernel: 建立輕量核心
    // ==========================================
    const client = new YoinClient({
        url: 'wss://yoin-worker.saiguanen.workers.dev', // 請確認你的 Worker 網址
        docId: currentRoom,
        awarenessThrottleMs: 30,
        heartbeatIntervalMs: 5000,
        heartbeatTimeoutMs: 30000,
        
        // 資料驗證規則
        schemas: {
            'app-settings': z.object({
                themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "顏色必須是 Hex 格式 (例如 #ff0000)"),
                lastUpdatedBy: z.string().optional(),
                // 允許任意額外屬性以支援 Deep Proxy 測試 (如 ui.sidebar)
            }).passthrough(), 
            'action-logs': z.array(z.object({
                action: z.string(),
                time: z.string()
            }))
        }
    });

    // ==========================================
    // Micro-kernel: 掛載插件
    // ==========================================
    // 注意：undoPlugin 必須在 dbPlugin 之後掛載，或者根據依賴關係調整
    // 這裡我們示範標準順序：DB -> Undo -> Logger
    
    const dbPlugin = createDbPlugin({
        dbName: `YoinDemoDB-${currentRoom}`,
        debounceMs: 1000,
    });
    
    const undoPlugin = createUndoPlugin();

    client
        .use(dbPlugin.plugin)    // 1. IndexedDB 持久化
        .use(undoPlugin.plugin)  // 2. Undo/Redo 能力
        .use(createLoggerPlugin()); // 3. Logger 插件

    log('🔌 Plugins installed: yoin-db, yoin-undo, logger');

    // 方便除錯
    (window as any).client = client;
    console.log("✅ Yoin Client has been mounted to window.client for debugging");

    const docIdEl = document.getElementById('doc-id');
    if (docIdEl) docIdEl.innerText = currentRoom;

    // ==========================================
    // 2. Awareness: Identity Initialization
    // ==========================================
    const randomColors = ['#ff7675', '#74b9ff', '#55efc4', '#fdcb6e', '#a29bfe'];
    const myColor = randomColors[Math.floor(Math.random() * randomColors.length)];
    const myName = 'User_' + Math.floor(Math.random() * 100);
    const myClientId = client.getClientId();

    client.setAwareness({ name: myName, color: myColor });

    // ==========================================
    // 3. Mouse Input Throttled by rAF (Performance: Input)
    // ==========================================
    
    // [New] 判斷裝置類型
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    let pendingCursor: { x: number; y: number } | null = null;
    let rafScheduled = false;

    // 定義廣播位置的函式
    const updateCursor = (x: number, y: number) => {
        pendingCursor = { x, y };
        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
                if (pendingCursor) {
                    client.setAwareness({
                        cursorX: pendingCursor.x,
                        cursorY: pendingCursor.y,
                        device: isMobile ? 'mobile' : 'desktop',
                        lastActive: Date.now() // 用於判斷是否為「幽靈」
                    });
                    pendingCursor = null;
                }
                rafScheduled = false;
            });
        }
    };

    // 綁定 Desktop 事件 (滑鼠)
    window.addEventListener('mousemove', (e) => {
        if (!isMobile) {
            updateCursor(e.clientX, e.clientY);
        }
    });

    // 綁定 Mobile 事件 (觸控)
    window.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            const touch = e.touches[0];
            updateCursor(touch.clientX, touch.clientY);
        }
    }, { passive: true });

    // Mobile 點擊時也更新一下
    window.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            const touch = e.touches[0];
            updateCursor(touch.clientX, touch.clientY);
        }
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
        pendingCursor = null;
        // 離開視窗時，清除座標避免幽靈游標
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
    let cursorLayer = document.getElementById('cursor-layer');
    if (!cursorLayer) {
        cursorLayer = document.createElement('div');
        cursorLayer.id = 'cursor-layer';
        cursorLayer.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            pointer-events: none;
            z-index: 9999;
            overflow: hidden;
        `;
        document.body.appendChild(cursorLayer);
    }

    client.onAwarenessChange((states: Map<string, AwarenessState>) => {
        const now = Date.now();

        // --- A. 更新右上角頭像列表 ---
        const avatarContainer = document.getElementById('awareness-container');
        if (avatarContainer) {
            avatarContainer.innerHTML = '<span style="font-size: 0.9rem; color: #666; margin-right: 5px;">在線成員:</span>';
            states.forEach((state, clientId) => {
                const isSelf = clientId === myClientId;
                // 這裡假設 createAvatar 已經適配新的 state 結構
                const avatar = createAvatar(state.name || 'User', state.color || '#ccc', isSelf, clientId);
                avatarContainer.appendChild(avatar);
            });
        }

        // --- B. 🎯 DOM Diffing + CSS transform 游標渲染 ---
        // 收集本幀應該存在的遠端游標 ID
        const activeIds = new Set<string>();

        states.forEach((state, clientId) => {
            // 跳過自己
            if (clientId === myClientId) return;
            
            // [關鍵修復] 過濾幽靈：超過 5 秒沒更新的座標不顯示
            const lastSeen = state.lastActive ?? state.timestamp;
            if (lastSeen && (now - lastSeen > 5000)) {
                return;
            }

            // 跳過沒有座標的用戶
            if (state.cursorX == null || state.cursorY == null) return;
            
            activeIds.add(clientId);

            let el = cursorElements.get(clientId);

            if (!el) {
                // 🆕 新使用者 → 建立游標 DOM 並加入圖層
                // 如果是 Mobile，我們手動覆蓋 renderer 或者在 renderer 內部判斷
                // 這裡簡單示範：如果是 Mobile，使用圓點樣式
                if (state.device === 'mobile') {
                    el = document.createElement('div');
                    el.style.cssText = `
                        position: absolute; width: 12px; height: 12px; border-radius: 50%;
                        background-color: ${state.color}; border: 2px solid white;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        transition: transform 100ms linear;
                    `;
                    // 加上名稱標籤
                    const label = document.createElement('div');
                    label.innerText = state.name || 'User';
                    label.style.cssText = `
                        position: absolute; left: 16px; top: -4px;
                        background: ${state.color}; color: #fff;
                        padding: 2px 6px; border-radius: 4px; font-size: 10px; white-space: nowrap;
                    `;
                    el.appendChild(label);
                } else {
                    el = currentRenderer(state.color || '#000', state.name || 'User');
                    el.style.transition = 'transform 100ms linear';
                }
                
                el.id = `cursor-${clientId}`;
                cursorLayer!.appendChild(el);
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
                arrayDisplay.innerHTML = '<li>No logs available yet</li>';
            } else {
                arrayData.forEach(item => {
                    const li = document.createElement('li');
                    // 處理可能已經是物件的 item (如果我們在 client 做了 JSON.parse)
                    // 或者還是 JSON 字串的 item
                    let content = item;
                    if (typeof item === 'string') {
                         try { content = JSON.parse(item); } catch {}
                    }
                    
                    li.innerText = typeof content === 'object' ? 
                        `[${content.time}] ${content.action}` : String(content);
                        
                    arrayDisplay.appendChild(li);
                });
            }
        }

        // D. Config (Background Color)
        const configData = client.getMap('config');
        if (configData && configData.bg) {
            document.body.style.backgroundColor = configData.bg;
            document.body.style.transition = 'background-color 0.5s ease';
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
            log(`🗑️ Notes have been cleared`);
        };
    }

    // 隨機切換主題顏色 (寫入 'app-settings')
    const btnUpdateMap = document.getElementById('btn-update-map');
    if (btnUpdateMap) {
        btnUpdateMap.onclick = () => {
            const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#34495e', '#d35400'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            client.setMap('app-settings', 'themeColor', randomColor);
            client.setMap('app-settings', 'lastUpdatedBy', myName);
            log(`🎨 Theme color has been updated to ${randomColor}`);
        };
    }

    // Change Theme 按鈕：改變整個頁面的背景色
    const btnTheme = document.getElementById('btn-theme');
    if (btnTheme) {
        btnTheme.onclick = () => {
            const colors = ['#dfe6e9', '#ffeaa7', '#81ecec', '#fab1a0', '#74b9ff', '#a29bfe'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            log(`[UI] Setting theme color to: ${randomColor}`);
            // "config" 是 map 名稱, "bg" 是 key
            client.setMap('config', 'bg', randomColor);
        };
    }

    // 推入歷史紀錄
    const btnPushArray = document.getElementById('btn-push-array');
    if (btnPushArray) {
        btnPushArray.onclick = () => {
            const timeStr = new Date().toLocaleTimeString();
            client.pushArray('action-logs', { action: 'CLICK', time: timeStr });
            log(`➕ Log entry added`);
        };
    }

    // ==========================================
    // 8. 網路狀態 UI
    // ==========================================
    client.subscribeNetwork((status) => {
        const statusEl = document.getElementById('connection-status');
        if (!statusEl) return;

        if (status === 'online') {
            statusEl.innerText = '🟢 Connected';
            statusEl.className = 'status-indicator online';
        } else if (status === 'connecting') {
            statusEl.innerText = '🟡 Connecting...';
            statusEl.className = 'status-indicator';
            statusEl.style.color = '#f39c12';
        } else {
            statusEl.innerText = '🔴 Offline (Reconnecting...)';
            statusEl.className = 'status-indicator offline';
        }
    });

    // ==========================================
    // 9. 清理：離開時通知
    // ==========================================
    window.addEventListener('beforeunload', () => {
        client.destroy(); // 使用 destroy 來清理 heartbeat 和 awareness
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

    // ==========================================
    // Undo / Redo Buttons & Shortcuts
    // ==========================================
    const btnUndo = document.getElementById('btn-undo');
    if (btnUndo) {
        btnUndo.onclick = () => undoPlugin.undo(); // 使用插件的 undo()
    }

    const btnRedo = document.getElementById('btn-redo');
    if (btnRedo) {
        btnRedo.onclick = () => undoPlugin.redo(); // 使用插件的 redo()
    }
    
    // Keyboard shortcuts (Ctrl+Z / Ctrl+Y)
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undoPlugin.undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            undoPlugin.redo();
        }
    });

    // ==========================================
    // 🔮 Test Case 4: Proxy Transparency (Deep Proxy)
    // ==========================================
    
    // 定義 App 設定型別
    type AppSettings = {
        themeColor: string;
        lastUpdatedBy?: string;
        ui?: {
            sidebar?: {
                width: number;
                collapsed: boolean;
            }
        }
    };

    // 1. 建立 'app-settings' 的 Proxy
    const settingsStore = createMapProxy<AppSettings>(client, 'app-settings');

    // 2. 建立 'action-logs' 的 Array Proxy
    // 定義 Log Item 型別
    interface ActionLog {
        action: string;
        time: string;
    }
    const logsStore = createArrayProxy<ActionLog>(client, 'action-logs');

    // 3. 綁定測試按鈕
    const btnProxyTest = document.getElementById('btn-proxy-test');
    
    if (btnProxyTest) {
        btnProxyTest.onclick = () => {
            console.log("🔮 [Proxy Test] Executing transparent updates...");
            
            // --- Test A: Map Proxy ---
            try {
                // 自動轉為 client.setMap()
                settingsStore.themeColor = '#fd79a8'; 
                settingsStore.lastUpdatedBy = 'Proxy_User';

                // Deep Proxy: 自動轉為 client.setMapDeep()
                // 注意：必須在 schema 中允許額外屬性 (.passthrough())，否則會被 Zod 擋下
                if (!settingsStore.ui) {
                     // 這裡我們模擬建立結構，但在 Yoin Proxy 中，
                     // 我們可以直接對路徑賦值 (如果你的 Proxy 實作支援自動建立路徑)
                     // 為了安全起見，我們先用 setMap 建立第一層
                     // client.setMap('app-settings', 'ui', {}); 
                     // 或者直接用 Proxy 嘗試寫入 (視 createDeepProxy 實作而定)
                }
                
                // 假設 Proxy 支援深層寫入
                if (settingsStore.ui?.sidebar) {
                    settingsStore.ui.sidebar.width = Math.floor(Math.random() * 500);
                    settingsStore.ui.sidebar.collapsed = false;
                }
            } catch (e) {
                console.error("Proxy Map Error:", e);
            }

            // --- Test B: Array Proxy ---
            console.log("🔮 [Proxy Test] Testing Array Push...");
            try {
                // 自動轉為 client.pushArray()
                logsStore.push({
                    action: 'PROXY_PUSH',
                    time: new Date().toLocaleTimeString()
                });
            } catch (err) {
                console.error("Proxy Push Failed (Zod?):", err);
            }
        };
    }
}

bootstrap().catch(err => {
    console.error("Failed to start:", err);
});