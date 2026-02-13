// client/src/main.ts
import { initYoin, YoinClient, initPanicHook, createUndoPlugin, createDbPlugin } from './yoin';
import { createDefaultCursor, createEmojiCursor, createAvatar } from './renderers';
import type { CursorRenderer, AwarenessState } from './yoin/types';
import './style.css';
import { z } from 'zod';
import { createMapProxy, createArrayProxy } from './yoin/proxy';
import { createLoggerPlugin } from './yoin/logger';



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
    log("🚀 Starting WASM...");
    await initYoin();
    log("✅ WASM loaded successfully");
    initPanicHook();
    log("✅ WASM Panic Hook Activated");

    const urlParams = new URLSearchParams(window.location.search);
    const currentRoom = urlParams.get('room') || 'default-room';

    // ==========================================
    // Micro-kernel: 建立輕量核心
    // ==========================================
    const client = new YoinClient({
        url: 'ws://localhost:8080',
        dbName: `YoinDemoDB-${currentRoom}`,
        docId: currentRoom,
        awarenessThrottleMs: 30,
        heartbeatIntervalMs: 5000,
        heartbeatTimeoutMs: 30000,
        
        // 資料驗證規則
        schemas: {
            'app-settings': z.object({
                themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "顏色必須是 Hex 格式 (例如 #ff0000)"),
                lastUpdatedBy: z.string().optional()
            }),
            'action-logs': z.array(z.object({
                action: z.string(),
                time: z.string()
            }))
        }
    });

    // ==========================================
    // Micro-kernel: 掛載插件
    // ==========================================
    const { undo, redo, plugin: undoPlugin } = createUndoPlugin();
    const { plugin: dbPlugin } = createDbPlugin({
        dbName: `YoinDemoDB-${currentRoom}`,
        debounceMs: 1000,
    });

    client
        .use(dbPlugin)    // 1. IndexedDB 持久化 (先掛載，以便載入歷史資料)
        .use(undoPlugin)  // 2. Undo/Redo 能力
        .use(createLoggerPlugin()); // 3. Logger 插件

    log('🔌 Plugins installed: yoin-db, yoin-undo');

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
                arrayDisplay.innerHTML = '<li>No logs available yet</li>';
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
            log(`🗑️ Notes have been cleared`);
        };
    }

    // 隨機切換主題顏色
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
            statusEl.innerText = '🔴 Offline (Reconnecting)...)';
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

    // ... inside bootstrap() function ...

    // ==========================================
    // Undo / Redo Buttons
    // ==========================================
    const btnUndo = document.getElementById('btn-undo');
    if (btnUndo) {
        btnUndo.onclick = () => undo();  // 使用插件的 undo()
    }

    const btnRedo = document.getElementById('btn-redo');
    if (btnRedo) {
        btnRedo.onclick = () => redo();  // 使用插件的 redo()
    }
    
    // Keyboard shortcuts (Ctrl+Z / Ctrl+Y)
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            redo();
        }
    });
    
    // ==========================================
    // 🎨 Test Case 3: Map Undo/Redo (Theme Color)
    // ==========================================
    
    // 1. 綁定按鈕事件 (寫入 Map)
    const btnTheme = document.getElementById('btn-theme');
    if (btnTheme) {
        btnTheme.onclick = () => {
            const colors = ['#dfe6e9', '#ffeaa7', '#81ecec', '#fab1a0', '#74b9ff', '#a29bfe'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            console.log(`[UI] Setting theme color to: ${randomColor}`);
            // "config" 是 map 名稱, "bg" 是 key
            client.setMap('config', 'bg', randomColor);
        };
    }

    // 2. 修改 Subscribe 邏輯 (監聽 Map 變更並渲染)
    // 注意：原本的 subscribe 可能只單純更新文字，我們需要擴充它
    client.subscribe((text) => {
        // A. 更新文字框 (既有邏輯)
        const display = document.getElementById('display'); // 假設你有個顯示文字的地方
        if (display) (display as HTMLTextAreaElement).value = text;

        // B. 更新背景色 (Map 邏輯)
        const config = client.getMap('config');
        if (config.bg) {
            document.body.style.backgroundColor = config.bg;
            document.body.style.transition = 'background-color 0.3s ease';
        }
    });

    // ==========================================
    // 🔮 Test Case 4: Proxy Transparency
    // ==========================================
    
    // 定義我們預期的設定型別 (搭配 TypeScript 會有很好的自動補全)
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

    // 1. 建立 Proxy 實例
    // 這行程式碼建立了 'app-settings' Map 的代理物件
    const settingsStore = createMapProxy<AppSettings>(client, 'app-settings');
    // 2. 綁定一個新按鈕來測試 Proxy
    // 請在 HTML 加入 <button id="btn-proxy-test">🔮 Test Proxy</button>
    const btnProxyTest = document.getElementById('btn-proxy-test');
    
    if (btnProxyTest) {
        btnProxyTest.onclick = () => {
            console.log("🔮 [Proxy Test] Executing transparent updates...");
            
            // A. 測試根屬性寫入 (自動轉為 setMap)
            // 應該會觸發 Zod 驗證 (因為底層還是呼叫 setMap)
            settingsStore.themeColor = '#fd79a8'; 
            settingsStore.lastUpdatedBy = 'Proxy_User';

            // B. 測試深層巢狀寫入 (自動轉為 setMapDeep)
            // 注意：我們不需要先建立 ui 物件，直接寫入即可！
            // 這會轉為 map_set_deep('app-settings', ['ui', 'sidebar', 'width'], 350)
            if (settingsStore.ui && settingsStore.ui.sidebar) {
                settingsStore.ui.sidebar.width = Math.floor(Math.random() * 500);
                settingsStore.ui.sidebar.collapsed = false;
            }
            // 這裡為了方便 TS 檢查，實際上你可以直接寫:
            // (settingsStore as any).ui.sidebar.width = 350;
        };
    }

    // ==========================================
    // 🔮 Test Case 5: Array Proxy (push)
    // ==========================================
    
    // 1. 建立 'action-logs' 的 Array Proxy
    const logsStore = createArrayProxy<any>(client, 'action-logs');
    // 2. 綁定按鈕 (重複利用 Test Proxy 按鈕，或新增一個)
    // 為了方便，我們把測試邏輯加到剛剛的 'btn-proxy-test' 裡面
    if (btnProxyTest) {
        // 保存原本的 onclick
        const prevOnClick = btnProxyTest.onclick;
        
        btnProxyTest.onclick = (e) => {
            // 執行原本的 Map Proxy 測試
            if (typeof prevOnClick === 'function') prevOnClick.call(btnProxyTest, e);

            console.log("🔮 [Proxy Test] Testing Array Push...");
            
            // 測試 Array Push 語法糖
            // 這應該會自動觸發 client.pushArray('action-logs', {...})
            // 並且經過 Zod 驗證 (必須包含 action 和 time)
            try {
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