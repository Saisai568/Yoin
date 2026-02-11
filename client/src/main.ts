// client/src/main.ts
import './style.css'
import { YoinClient } from './YoinClient';
import init, { YoinDoc } from '../../core/pkg/core';

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

async function bootstrap() {
    log("🚀 正在啟動 WASM...");
    await init();
    log("✅ WASM 載入完成");

    const client = new YoinClient({
        url: 'ws://localhost:8080',
        dbName: 'YoinDemoDB',
        docId: 'demo-doc-v2'
    });

    // ==========================================
    // 🟢 實作感知系統 (Awareness)
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

    // 3. 訂閱所有人(包含自己)的狀態，畫出圓形頭像
    client.subscribeAwareness((states) => {
        const container = document.getElementById('awareness-container');
        if (!container) return;
        
        // 清空舊的頭像，保留「線上:」文字
        container.innerHTML = '<span style="font-size: 0.9rem; color: #666; margin-right: 5px;">在線成員:</span>';

        // 尋訪每一個在線上的人
        states.forEach((state, clientId) => {
            const avatar = document.createElement('div');
            // 畫一個漂亮的圓形頭像
            avatar.style.width = '28px';
            avatar.style.height = '28px';
            avatar.style.borderRadius = '50%';
            avatar.style.backgroundColor = state.color;
            avatar.style.display = 'flex';
            avatar.style.alignItems = 'center';
            avatar.style.justifyContent = 'center';
            avatar.style.color = 'white';
            avatar.style.fontWeight = 'bold';
            avatar.style.fontSize = '12px';
            avatar.style.cursor = 'help';
            avatar.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            
            // 取名字的第一個字母當頭像
            avatar.innerText = state.name.substring(0, 1);
            // 滑鼠移過去顯示全名
            avatar.title = `${state.name} (ID: ${clientId})`;

            // 如果是自己，加一個白邊框標示
            if (state.name === myName) {
                avatar.style.border = '2px solid #2c3e50';
            }

            container.appendChild(avatar);
        });
    });
    document.getElementById('doc-id')!.innerText = 'demo-doc-v1';
    document.getElementById('connection-status')!.innerText = '🟢 連線中...';

    // ==========================================
    // 1. 畫面更新邏輯 (當收到任何更新時觸發)
    // ==========================================
    client.subscribe((text) => {
        // A. 更新文字
        const display = document.getElementById('display');
        if (display) display.innerText = text;

        // B. 🟢 更新 Map (設定檔)
        const mapData = client.getMap('app-settings');
        const mapDisplay = document.getElementById('map-display');
        if (mapDisplay) {
            // 1. 顯示 JSON 字串 (你剛剛看到的結果)
            mapDisplay.innerText = JSON.stringify(mapData, null, 2);
            
            // 2. 🌟 加上這段魔法：讓資料真正驅動畫面！
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

        // C. 🟢 更新 Array (歷史紀錄)
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

    // 🟢 綁定清空按鈕
    const btnClear = document.getElementById('btn-clear');
    if (btnClear) {
        btnClear.onclick = () => {
            // 呼叫我們剛剛寫的捷徑方法
            client.clearText();
            log(`🗑️ 已清空筆記內容`);
        };
    }

    // 🟢 測試 Map: 隨機改變顏色設定與更新時間
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

    // 🟢 測試 Array: 推入一筆新的時間紀錄
    const btnPushArray = document.getElementById('btn-push-array');
    if (btnPushArray) {
        btnPushArray.onclick = () => {
            const timeStr = new Date().toLocaleTimeString();
            // 這裡我們刻意推入一個 Object 測試複雜資料
            const logEntry = { action: 'CLICK', time: timeStr };
            
            client.pushArray('action-logs', logEntry);
            log(`➕ 已新增日誌紀錄`);
        };
    }
    // 🟢 當網頁準備重新整理、關閉、或跳轉時觸發
    window.addEventListener('beforeunload', () => {
        client.leaveAwareness();
    });
}

bootstrap().catch(err => { /* ... 錯誤處理保留 ... */ });