# Yoin SDK API

---

### 📦 Yoin SDK 目前公開的 API (Current Public API)

只要 `import { initYoin, YoinClient } from './yoin';`，外部開發者就能使用以下四大模組的能力：

#### 1. 系統初始化與生命週期

* `initYoin(): Promise<void>`
* **用途**：非同步啟動底層 Rust WASM 引擎。外部不需知道 WASM 的存在。


* `new YoinClient(config: YoinConfig)`
* **用途**：實例化同步客戶端，自動連接 WebSocket 與 IndexedDB。



#### 2. 📝 Text (協作文字) API

支援自動合併衝突的純文字操作。

* `getText(): string`：取得目前完整文字內容。
* `insertText(index: number, text: string)`：在指定位置插入文字。
* `deleteText(index: number, length: number)`：刪除指定範圍的文字。
* `clearText()`：一鍵清空所有文字。
* `subscribe(callback: (text: string) => void)`：訂閱文字變更事件。

#### 3. 🧩 結構化資料 API (Map & Array)

支援跨裝置即時同步的 JSON 狀態管理，並具備「精細讀取」效能優化。

* **Map (鍵值對設定)**
* `setMap(mapName: string, key: string, value: any)`：寫入/覆蓋特定鍵值（支援存入物件）。
* `getMap(mapName: string): Record<string, any>`：取得整個 Map 的 JSON 物件。
* `getMapItem(mapName: string, key: string): any`：⚡ 高效讀取單一設定值。


* **Array (列表與歷史)**
* `pushArray(arrayName: string, item: any)`：在陣列尾端推入新項目。
* `getArray(arrayName: string): any[]`：取得整個陣列內容。
* `getArrayItem(arrayName: string, index: number): any`：⚡ 高效讀取特定索引項目。



#### 4. 🟢 Awareness (感知系統) API

處理輕量級、不進資料庫的「短暫狀態」（如線上名單、游標位置），並內建防抖與幽靈清理機制。

* `setAwarenessState(state: Record<string, any>)`：廣播自己的狀態（內建 100ms 節流）。
* `subscribeAwareness(callback: (states: Map) => void)`：訂閱所有在線成員的狀態變化。
* `leaveAwareness()`：主動宣告下線，觸發對方畫面清除自己的頭像。

---

### 🚀 未來預計擴展的 API 選項 (Future Roadmap)

有了目前穩固的架構，未來要幫這個黑盒子加入新功能會變得非常容易。以下是你可以考慮擴展的幾個高級特性：

#### 選項 A：網路狀態控制 API (Network & UI Feedback)

目前網路連線是寫死的，我們需要讓外部 UI 能針對「斷線」、「重連中」顯示對應的畫面。

* `client.onConnectionChange(callback: (status: 'online' | 'offline' | 'connecting') => void)`
* `client.disconnect()` / `client.connect()`：允許使用者手動切換離線模式。

#### 選項 B：事件驅動訂閱 (Event-driven Subscriptions)

目前 `client.subscribe` 只會回傳 text，且任何變動都會觸發。未來可以改造成更精細的事件監聽器。

* `client.on('text-update', callback)`
* `client.on('map-change', (mapName, key, newValue) => {...})`

#### 選項 C：進階資料操作 (Advanced CRDT Methods)

目前的 Map 和 Array 只有「新增/覆蓋」，還缺少刪除功能。

* `deleteMapItem(mapName: string, key: string)`：從 Rust 核心支援刪除 Map 的特定鍵。
* `removeArrayItem(arrayName: string, index: number)`：從 Array 中刪除特定項目。
* `insertArrayItem(arrayName: string, index: number, item: any)`：在陣列中間安插資料。

#### 選項 D：Undo / Redo (歷史復原管理)

CRDT (`yrs`) 底層其實支援強大的 Undo Manager，這對編輯器來說是必備功能。

* `client.undo()`
* `client.redo()`
* `client.canUndo(): boolean`

#### 選項 E：多房間與身分驗證 (Rooms & Auth)

為未來的後端伺服器升級做準備。

* `client.joinRoom(roomId: string)`
* `client.authenticate(token: string)`
