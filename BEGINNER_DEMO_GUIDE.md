# Yoin 新手最小可行性 Demo 指南 (MVP)

這是一份專為零基礎新手設計的指南。我們將建立一個**「即時同步便利貼 (Sticky Notes)」**應用，支援雙分頁即時拖曳、新增、刪除與修改文字，以及顯示對方的游標。

---

## 步驟一：建立獨立的前端專案

請在您的電腦上找一個空白資料夾（不要放在 Yoin 原始碼目錄內，模擬真實外部使用者），開啟終端機執行：

```bash
# 1. 使用 Vite 建立一個 Vanilla TypeScript 專案
npm create vite@latest my-yoin-demo -- --template vanilla-ts

# 2. 進入專案目錄
cd my-yoin-demo

# 3. 安裝基礎依賴
npm install
```

---

## 步驟二：安裝 Yoin SDK 與 Vite 插件

因為 Yoin 底層使用了 Rust WebAssembly (WASM)，在 Vite 中需要安裝輔助插件（`@yoin/client` 已將其列為選用 peerDependencies）：

```bash
# 1. 安裝 Vite 的 WASM 支援插件
npm install -D vite-plugin-wasm vite-plugin-top-level-await

# 2. 安裝 Yoin 客戶端 SDK（指向打包好的 tgz 檔案，或從 npm 安裝）
npm install /你的路徑/Yoin/yoin-client-0.1.2.tgz
```

接著，在專案根目錄新增一個 `vite.config.ts` 檔案，加入以下內容：

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
});
```

---

## 步驟三：貼上最小可行性程式碼

請打開 `src/main.ts`，將裡面的內容**全部清空**，並貼上以下約 110 行的完整程式碼：

```typescript
import { initYoin, YoinClient, createMapProxy } from '@yoin/client';

// 定義便利貼的資料結構
interface Note {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
}

async function startApp() {
  // 1. 初始化 WASM 引擎 (全域只需呼叫一次)
  await initYoin();

  // 2. 連線到 Yoin 伺服器 (這裡連到本地端測試伺服器，可參考 Yoin-apps-example/server)
  const client = new YoinClient({
    url: 'ws://localhost:8080',
    docId: 'beginner-demo-room', // 房間名稱，相同名稱的分頁會自動同步
  });

  // 3. 建立畫布 UI
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.fontFamily = 'sans-serif';
  
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <div style="padding: 15px; background: #333; color: white; display: flex; gap: 15px; align-items: center;">
      <strong>Yoin 最小範例</strong>
      <button id="add-btn" style="padding: 6px 12px; cursor: pointer;">＋ 新增便利貼</button>
      <span id="status" style="font-size: 14px; color: #aaa;">連線中...</span>
    </div>
    <div id="board" style="position: relative; width: 100vw; height: calc(100vh - 50px); background: #f4f4f9;"></div>
  `;

  const board = document.getElementById('board')!;
  const statusEl = document.getElementById('status')!;

  // 4. 啟用多人游標感知 (Awareness)
  const myColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  const myName = 'User-' + Math.floor(Math.random() * 1000);
  
  client.setAwareness({ name: myName, color: myColor });
  // 自動監聽滑鼠移動，並在畫布上畫出其他人的游標！
  client.bindCursorTracking(board, (color, name) => {
    const el = document.createElement('div');
    el.innerHTML = `<div style="width:10px;height:10px;background:${color};border-radius:50%;"></div>
                    <span style="background:${color};color:#fff;font-size:10px;padding:2px 4px;border-radius:3px;">${name}</span>`;
    return el;
  });

  // 監聽網路狀態
  client.subscribeNetwork((status) => {
    statusEl.textContent = status === 'online' ? '🟢 已連線 (可開新分頁測試)' : '🔴 離線';
  });

  // 5. 建立 Map Proxy：讓我們用操作普通 JS 物件的方式來操作 CRDT！
  const notesProxy = createMapProxy<Record<string, Note>>(client, 'notes');

  // 點擊按鈕新增一張便利貼
  document.getElementById('add-btn')!.onclick = () => {
    const id = 'note_' + Date.now();
    // 直接賦值！Yoin 會保留完整型別並自動同步給所有分頁
    notesProxy[id] = {
      id,
      text: '點我修改文字...',
      x: 50 + Math.random() * 200,
      y: 50 + Math.random() * 200,
      color: ['#ffeb3b', '#ff9800', '#a7ffeb', '#f8bbd0'][Math.floor(Math.random() * 4)],
    };
  };

  // 6. 畫面渲染邏輯 (當資料變更時更新 DOM)
  let draggingId: string | null = null;

  function renderNotes() {
    const allNotes = client.getMap('notes') as Record<string, Note>;

    // 移除已經被刪除的便利貼 DOM
    Array.from(board.querySelectorAll<HTMLDivElement>('.sticky-note')).forEach((el) => {
      const noteId = el.id.replace('dom-', '');
      if (!allNotes[noteId]) el.remove();
    });

    Object.values(allNotes).forEach((note) => {
      if (!note || !note.id) return;

      let noteEl = document.getElementById(`dom-${note.id}`) as HTMLDivElement;

      // 如果畫面上還沒有這張便利貼，就建立它
      if (!noteEl) {
        noteEl = document.createElement('div');
        noteEl.id = `dom-${note.id}`;
        noteEl.className = 'sticky-note';
        noteEl.style.cssText = `
          position: absolute; width: 160px; height: 140px; padding: 12px;
          box-shadow: 2px 4px 10px rgba(0,0,0,0.15); border-radius: 6px;
          cursor: grab; user-select: none; display: flex; flex-direction: column;
        `;

        // 點擊兩下修改文字
        noteEl.ondblclick = () => {
          const newText = prompt('修改內容：', notesProxy[note.id]?.text);
          if (newText !== null && notesProxy[note.id]) {
            notesProxy[note.id] = { ...notesProxy[note.id], text: newText };
          }
        };

        // 右鍵刪除便利貼（直接 delete proxy[key] 即可同步刪除！）
        noteEl.oncontextmenu = (e) => {
          e.preventDefault();
          delete notesProxy[note.id];
        };

        // 拖曳邏輯
        noteEl.onmousedown = (e) => {
          draggingId = note.id;
          const startX = e.clientX - note.x;
          const startY = e.clientY - note.y;

          const onMouseMove = (moveEvent: MouseEvent) => {
            if (draggingId === note.id && notesProxy[note.id]) {
              notesProxy[note.id] = {
                ...notesProxy[note.id],
                x: moveEvent.clientX - startX,
                y: moveEvent.clientY - startY,
              };
            }
          };

          const onMouseUp = () => {
            draggingId = null;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        };

        board.appendChild(noteEl);
      }

      // 更新位置、顏色與文字
      noteEl.style.left = `${note.x}px`;
      noteEl.style.top = `${note.y}px`;
      noteEl.style.background = note.color;
      noteEl.textContent = note.text;
    });
  }

  // 7. 精準訂閱 'notes' Map 容器的資料變更（本地修改或收到遠端同步都會觸發）
  client.subscribeMap('notes', () => {
    renderNotes();
  });
}

startApp();
```

---

## 步驟四：啟動並測試雙分頁同步！

要讓兩個分頁能夠互相溝通，我們需要一個簡單的 WebSocket 轉發伺服器（Relay Server）。

1. **啟動後端轉發伺服器**：
   請克隆或前往 [`Yoin-apps-example`](https://github.com/s9900930/Yoin-apps-example) 的 `server` 資料夾啟動測試伺服器：
   ```bash
   cd Yoin-apps-example/server
   node index.js
   ```
   *(終端機會顯示伺服器運行於 `ws://localhost:8080`)*

2. **啟動您的前端專案**：
   回到您剛剛建立的 `my-yoin-demo` 終端機，執行：
   ```bash
   npm run dev
   ```

3. **見證奇蹟**：
   打開瀏覽器輸入 `http://localhost:5173`，並且**開兩個分頁並排**。
   - 在左邊分頁點擊「＋ 新增便利貼」，右邊分頁會瞬間出現！
   - 按住便利貼拖曳，另一邊會以 60FPS 即時跟著移動！
   - 雙擊便利貼修改文字、或按右鍵刪除便利貼，另一邊也會同步更新！
   - 移動滑鼠，您會在另一個分頁看到您的專屬彩色游標！
