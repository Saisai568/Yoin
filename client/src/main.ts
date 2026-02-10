// client/src/main.ts
import './style.css' // 如果你有用 CSS 檔案的話
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

    // 1. 初始化 Client
    const client = new YoinClient({
        url: 'ws://localhost:8080',
        dbName: 'YoinDemoDB',
        docId: 'demo-doc-v1'
    });

    // 更新 UI 狀態
    document.getElementById('doc-id')!.innerText = 'demo-doc-v1';
    document.getElementById('connection-status')!.innerText = '🟢 連線中...'; // 實際應由 Client 事件驅動

    // 2. 訂閱數據變更 -> 更新 UI
    client.subscribe((text) => {
        const display = document.getElementById('display');
        if (display) {
            display.innerText = text;
            // 簡單的閃爍效果提示有更新
            display.style.backgroundColor = "#e8f8f5";
            setTimeout(() => display.style.backgroundColor = "transparent", 300);
        }
        log(`🔄 收到更新，內容長度: ${text.length}`);
    });

    // 3. 綁定按鈕操作
    const btn = document.getElementById('btn-insert');
    if (btn) {
        btn.onclick = () => {
            const text = " Hello TS! ";
            // 這裡假設你之後會實作 appendText 或 insertText
            // 目前依賴我們之前定義的介面
            const currentLen = client.getText().length; 
            client.insertText(currentLen, text);
            log(`📤 發送寫入: "${text}"`);
        };
    }
}

bootstrap().catch(err => {
    console.error(err);
    log(`❌ 錯誤: ${err.message}`);
});