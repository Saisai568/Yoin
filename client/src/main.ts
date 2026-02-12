// client/src/main.ts
import { initYoin, YoinClient, initPanicHook } from './yoin'; // 記得引入 initPanicHookimport './style.css';
// 簡單的 Log 工具
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

// ==========================================
// 🎨 UI 渲染器：定義預設的游標外觀
// ==========================================
/**
 * 建立一個標準的滑鼠游標元素 (包含箭頭 SVG 與名字標籤)
 */
function createDefaultCursor(color: string, name: string): HTMLElement {
    const cursorContainer = document.createElement('div');
    // 這裡只負責內部的結構與樣式，外部的定位由訂閱迴圈處理
    cursorContainer.style.position = 'absolute'; 
    cursorContainer.style.left = '0';
    cursorContainer.style.top = '0';
    cursorContainer.style.pointerEvents = 'none'; // 確保不會擋住滑鼠點擊
    cursorContainer.style.zIndex = '9999'; // 確保游標永遠在最上層

    // 1. 🌟 完美復刻 Figma / Miro 的經典協作游標 SVG
    // 路徑解析：M(左上尖端) -> L(底部尖端) -> L(內側轉折) -> L(右側尖端) -> Z(閉合)
    const svgArrow = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" 
             style="filter: drop-shadow(1px 2px 3px rgba(0,0,0,0.3));">
            <path d="M3 3 L9 20 L12 12 L20 9 Z" 
                  fill="${color}" 
                  stroke="white" 
                  stroke-width="2" 
                  stroke-linejoin="round" />
        </svg>
    `;

    // 2. 名字標籤 (位置已配合新游標微調)
    const nameTag = `
        <div style="
            background-color: ${color}; 
            color: white; 
            padding: 4px 10px; 
            border-radius: 12px; 
            font-size: 12px; 
            font-weight: 600; 
            position: absolute; 
            left: 14px; 
            top: 20px; 
            white-space: nowrap;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            border: 1.5px solid white;">
            ${name}
        </div>
    `;

    cursorContainer.innerHTML = svgArrow + nameTag;
    return cursorContainer;
}

/**
 * (展示用) 另一種風格：Emoji 手指游標
 */
function createEmojiCursor(color: string, name: string): HTMLElement {
    const cursorContainer = document.createElement('div');
    cursorContainer.style.position = 'absolute';
    cursorContainer.style.top = '0'; cursorContainer.style.left = '0';
    cursorContainer.style.pointerEvents = 'none';

    cursorContainer.innerHTML = `
        <div style="font-size: 24px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2));">👆</div>
        <div style="background: white; color: ${color}; border: 2px solid ${color}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; position: absolute; left: 12px; top: 24px; white-space: nowrap;">
            ${name}
        </div>
    `;
    return cursorContainer;
}

async function bootstrap() {
    log("🚀 正在啟動 WASM...");
    await initYoin();
    log("✅ WASM 載入完成");
    initPanicHook(); // 🟢 啟動錯誤攔截器，以後 Rust 報錯就會顯示詳細原因！
    log("✅ WASM Panic Hook 已啟動");

    const urlParams = new URLSearchParams(window.location.search);
    const currentRoom = urlParams.get('room') || 'default-room'; // 找不到就預設為 default-room

    const client = new YoinClient({
        url: 'ws://localhost:8080',
        dbName: `YoinDemoDB-${currentRoom}`, // 讓本地的 IndexedDB 資料庫也跟著房間隔離！
        docId: currentRoom, // 這個 docId 會被 YoinClient 用來生成房間專屬的 WebSocket URL
        awarenessThrottleMs: 30 // 可選：設定 Awareness 更新的節流時間 (預設 30ms);
    });
    
    (window as any).client = client; 
    
    console.log("✅ Yoin Client 已掛載到 window.client");

    // 順便把網頁左上角顯示的 ID 改成動態的，才不會眼花
    const docIdEl = document.getElementById('doc-id');
    if (docIdEl) docIdEl.innerText = currentRoom;

    // 🟢 定義一個變數來存放「目前要用哪一個渲染器」
    let currentRenderer = createDefaultCursor;

    // 🟢 綁定切換按鈕
    const btnToggleCursor = document.getElementById('btn-toggle-cursor');
    if (btnToggleCursor) {
        btnToggleCursor.onclick = () => {
            // 在兩個渲染器之間切換
            if (currentRenderer === createDefaultCursor) {
                currentRenderer = createEmojiCursor;
                log("🔄 已切換為：Emoji 風格");
            } else {
                currentRenderer = createDefaultCursor;
                log("🔄 已切換為：標準風格");
            }
            // 強制觸發一次更新，讓畫面立刻改變
            client.notifyAwarenessListeners(); 
        };
    }

    // ==========================================
    //  實作感知系統 (Awareness)
    // ==========================================
    
    // 1. 生成一個隨機的身分 (名稱與顏色)
    const randomColors = ['#ff7675', '#74b9ff', '#55efc4', '#fdcb6e', '#a29bfe'];
    const myColor = randomColors[Math.floor(Math.random() * randomColors.length)];
    const myName = 'User_' + Math.floor(Math.random() * 100);

    // 2. 告訴框架：「這是我現在的狀態」
    client.setAwarenessState({
        name: myName,
        color: myColor
    });

    // 1. 告訴框架：「這是我現在的狀態」(初始化)
    client.setAwarenessState({ name: myName, color: myColor });

    // 捕捉滑鼠移動，並將座標 (cursorX, cursorY) 更新到 Awareness 裡面
    window.addEventListener('mousemove', (e) => {
        // YoinClient 內部的 throttle 會保護我們，放心呼叫
        client.setAwarenessState({
            name: myName,
            color: myColor,
            cursorX: e.clientX,
            cursorY: e.clientY
        });
    });
    // 當滑鼠離開網頁視窗時，把座標設為 null 隱藏游標！
    document.addEventListener('mouseleave', () => {
        client.setAwarenessState({
            name: myName, color: myColor,
            cursorX: null, cursorY: null // null 代表滑鼠不在畫面上
        });
    });
    
    // 3. 訂閱所有人(包含自己)的狀態，畫出圓形頭像 與 即時游標
    client.subscribeAwareness((states) => {
        // --- A. 更新右上角頭像 (你原本的邏輯) ---
        const container = document.getElementById('awareness-container');
        if (container) {
            container.innerHTML = '<span style="font-size: 0.9rem; color: #666; margin-right: 5px;">在線成員:</span>';
            states.forEach((state, clientId) => {
                const avatar = document.createElement('div');
                avatar.style.width = '28px'; avatar.style.height = '28px';
                avatar.style.borderRadius = '50%'; avatar.style.backgroundColor = state.color;
                avatar.style.display = 'flex'; avatar.style.alignItems = 'center';
                avatar.style.justifyContent = 'center'; avatar.style.color = 'white';
                avatar.style.fontWeight = 'bold'; avatar.style.fontSize = '12px';
                avatar.style.cursor = 'help'; avatar.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                avatar.innerText = state.name.substring(0, 1);
                avatar.title = `${state.name} (ID: ${clientId})`;
                if (state.name === myName) avatar.style.border = '2px solid #2c3e50';
                container.appendChild(avatar);
            });
        }

        // --- B. 🌟 繪製飛天游標 (Live Cursors) ---
        // 先建立一個游標專用的全螢幕圖層 (如果還沒建立的話)
        let cursorLayer = document.getElementById('cursor-layer');
        if (!cursorLayer) {
            cursorLayer = document.createElement('div');
            cursorLayer.id = 'cursor-layer';
            // 確保圖層蓋在最上面，且不會阻擋滑鼠點擊 (pointer-events: none)
            cursorLayer.style.position = 'fixed';
            cursorLayer.style.top = '0'; cursorLayer.style.left = '0';
            cursorLayer.style.width = '100vw'; cursorLayer.style.height = '100vh';
            cursorLayer.style.pointerEvents = 'none'; 
            cursorLayer.style.zIndex = '9999';
            document.body.appendChild(cursorLayer);
        }

        // 清空舊游標，準備重畫
        cursorLayer.innerHTML = '';

        // 畫出除了自己以外，所有帶有 x, y 座標的游標
        states.forEach((state, _clientId) => {
            // 如果是自己，或者對方還沒移動過滑鼠 (為 null)，就不畫
            if (state.name === myName || state.cursorX == null || state.cursorY == null) return;

            // 🟢 重構重點：呼叫外部函式來取得游標元素
            const cursorEl = currentRenderer(state.color, state.name);

            // 設定游標在畫面上的絕對位置
            // 注意：因為我們的 SVG 箭頭尖端在左上角 (0,0)，所以直接用 clientX/Y 即可
            // 加入平滑移動的 CSS transition
            cursorEl.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px)`;
            cursorEl.style.transition = 'transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1)';
            cursorLayer.appendChild(cursorEl);
        });
    });
    document.getElementById('connection-status')!.innerText = ' 連線中...';

    // ==========================================
    // 1. 畫面更新邏輯 (當收到任何更新時觸發)
    // ==========================================
    client.subscribe((text) => {
        // A. 更新文字
        const display = document.getElementById('display');
        if (display) display.innerText = text;

        // B.  更新 Map (設定檔)
        const mapData = client.getMap('app-settings');
        const mapDisplay = document.getElementById('map-display');
        if (mapDisplay) {
            // 1. 顯示 JSON 字串 (你剛剛看到的結果)
            mapDisplay.innerText = JSON.stringify(mapData, null, 2);
            
            // 2. 🌟 加上這段：讓資料真正驅動畫面！
            if (mapData.themeColor) {
                // 我們來改變整個 App 容器的頂部粗邊框顏色，效果最明顯
                const appContainer = document.getElementById('app-container');
                if (appContainer) {
                    appContainer.style.borderTop = `12px solid ${mapData.themeColor}`;
                    appContainer.style.transition = 'border-color 0.3s ease'; // 加一點平滑的漸變動畫
                }
                
                // 順便把顯示框的左邊也塗上顏色
                mapDisplay.style.borderLeft = `8px solid ${mapData.themeColor}`;
            }
        }

        // C.  更新 Array (歷史紀錄)
        const arrayData = client.getArray('action-logs');
        const arrayDisplay = document.getElementById('array-display');
        if (arrayDisplay) {
            arrayDisplay.innerHTML = ''; // 清空舊的
            if (arrayData.length === 0) {
                arrayDisplay.innerHTML = '<li>目前沒有日誌</li>';
            } else {
                arrayData.forEach(item => {
                    const li = document.createElement('li');
                    // 支援顯示字串或複雜的 Object
                    li.innerText = typeof item === 'object' ? JSON.stringify(item) : item;
                    arrayDisplay.appendChild(li);
                });
            }
        }
    });

    // ==========================================
    // 2. 按鈕綁定邏輯
    // ==========================================
    
    // 測試文字 (Text)
    const btnInsert = document.getElementById('btn-insert');
    if (btnInsert) {
        btnInsert.onclick = () => {
            const currentLen = client.getText().length; 
            client.insertText(currentLen, " Hello! ");
        };
    }

    //  綁定清空按鈕
    const btnClear = document.getElementById('btn-clear');
    if (btnClear) {
        btnClear.onclick = () => {
            // 呼叫我們剛剛寫的捷徑方法
            client.clearText();
            log(`🗑️ 已清空筆記內容`);
        };
    }

    //  測試 Map: 隨機改變顏色設定與更新時間
    const btnUpdateMap = document.getElementById('btn-update-map');
    if (btnUpdateMap) {
        btnUpdateMap.onclick = () => {
            const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            client.setMap('app-settings', 'themeColor', randomColor);
            client.setMap('app-settings', 'lastUpdatedBy', 'User_' + Math.floor(Math.random() * 100));
            log(`🎨 已更新主題顏色為 ${randomColor}`);
        };
    }

    //  測試 Array: 推入一筆新的時間紀錄
    const btnPushArray = document.getElementById('btn-push-array');
    if (btnPushArray) {
        btnPushArray.onclick = () => {
            const timeStr = new Date().toLocaleTimeString();
            const logEntry = { action: 'CLICK', time: timeStr };
            
            client.pushArray('action-logs', logEntry);
            log(`➕ 已新增日誌紀錄`);
        };
    }
    // 訂閱網路狀態並更新右上角 UI
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
    //  當網頁準備重新整理、關閉、或跳轉時觸發
    window.addEventListener('beforeunload', () => {
        client.leaveAwareness();
    });

    // 模擬白板上的兩個物件

    const shapes = ['Rect-A', 'Circle-B'];
    const board = document.getElementById('whiteboard-demo'); // 假設你有個 div

    // 監聽點擊，更新 Awareness 的 selection
    document.querySelectorAll('.shape').forEach(el => {
        el.addEventListener('click', (e) => {
            const shapeId = (e.target as HTMLElement).id;

            // 🟢 廣播：我選取了這個物件！
            client.setAwarenessState({
                name: myName,
                color: myColor,
                selection: shapeId
            });
        });
    });

    // 在 render awareness 的地方 (subscribeAwareness)
    // 加上：如果對方選取了某個物件，給那個物件加個邊框
    client.subscribeAwareness((states) => {
        // ... (游標邏輯不變) ...

        states.forEach(state => {
            if (state.selection) {
                const el = document.getElementById(state.selection);
                if (el) {
                    el.style.border = `2px solid ${state.color}`;
                    // 可以加個小標籤顯示 "User A is editing..."
                }
            }
        });
    });
}

bootstrap().catch(err => {
    console.error("啟動失敗:", err);
});