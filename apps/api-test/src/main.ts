import {
  initYoin, isYoinInitialized,
  YoinClient,
  createUndoPlugin, createDbPlugin, createLoggerPlugin,
  createMapProxy, createArrayProxy,
} from '@yoin/client';

const workerUrl = import.meta.env.VITE_YOIN_WORKER_URL;

if (!workerUrl) {
  throw new Error('VITE_YOIN_WORKER_URL is not set');
}

// ============================================================
// Yoin API 全功能測試
// ============================================================

interface TestResult { name: string; pass: boolean; detail: string; }
const results: TestResult[] = [];

function ok(name: string, detail = '') { results.push({ name, pass: true, detail }); }
function fail(name: string, detail: string) { results.push({ name, pass: false, detail }); }

function renderResults() {
  const el = document.querySelector<HTMLPreElement>('#results')!;
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  el.innerHTML = `<b>結果：${passed} 通過 / ${failed} 失敗</b>\n\n` +
    results.map(r =>
      `${r.pass ? '✅' : '❌'} ${r.name}${r.detail ? '  —  ' + r.detail : ''}`
    ).join('\n');
}

async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <h1>Yoin API 全功能測試</h1>
    <p id="status">測試進行中...</p>
    <pre id="results" style="white-space:pre-wrap; font-size:13px; line-height:1.6;"></pre>
  `;

  const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
  const room = 'api-test-' + Date.now();

  // ──────────────────────────────────────────────
  // 1. 初始化
  // ──────────────────────────────────────────────
  try {
    await initYoin();
    ok('initYoin()', '首次初始化成功');
  } catch (e) { fail('initYoin()', String(e)); renderResults(); return; }

  try {
    await initYoin(); // 冪等呼叫
    ok('initYoin() 冪等', '重複呼叫不報錯');
  } catch (e) { fail('initYoin() 冪等', String(e)); }

  try {
    const ready = isYoinInitialized();
    ready ? ok('isYoinInitialized()', `回傳 ${ready}`) : fail('isYoinInitialized()', '回傳 false');
  } catch (e) { fail('isYoinInitialized()', String(e)); }

  // ──────────────────────────────────────────────
  // 2. YoinClient 建構
  // ──────────────────────────────────────────────
  let client: YoinClient;
  try {
    client = new YoinClient({
      url: workerUrl,
      docId: room,
    });
    ok('new YoinClient()', `docId = ${room}`);
  } catch (e) { fail('new YoinClient()', String(e)); renderResults(); return; }

  // ──────────────────────────────────────────────
  // 3. 底層存取
  // ──────────────────────────────────────────────
  try {
    const doc = client.getDoc();
    doc ? ok('getDoc()', `typeof = ${typeof doc}`) : fail('getDoc()', '回傳 null');
  } catch (e) { fail('getDoc()', String(e)); }

  try {
    const cfg = client.getConfig();
    cfg.docId === room ? ok('getConfig()', `docId 正確`) : fail('getConfig()', `docId = ${cfg.docId}`);
  } catch (e) { fail('getConfig()', String(e)); }

  try {
    const id = client.getClientId();
    id ? ok('getClientId()', id) : fail('getClientId()', '空字串');
  } catch (e) { fail('getClientId()', String(e)); }

  // ──────────────────────────────────────────────
  // 4. Text API
  // ──────────────────────────────────────────────
  try {
    await client.insertText(0, 'Hello');
    const t1 = client.getText();
    t1 === 'Hello' ? ok('insertText()', `"${t1}"`) : fail('insertText()', `預期 "Hello"，得到 "${t1}"`);
  } catch (e) { fail('insertText()', String(e)); }

  try {
    await client.insertText(5, ' World');
    const t2 = client.getText();
    t2 === 'Hello World' ? ok('insertText() 追加', `"${t2}"`) : fail('insertText() 追加', `"${t2}"`);
  } catch (e) { fail('insertText() 追加', String(e)); }

  try {
    await client.deleteText(5, 6);
    const t3 = client.getText();
    t3 === 'Hello' ? ok('deleteText()', `"${t3}"`) : fail('deleteText()', `預期 "Hello"，得到 "${t3}"`);
  } catch (e) { fail('deleteText()', String(e)); }

  try {
    await client.clearText();
    const t4 = client.getText();
    t4 === '' ? ok('clearText()', '清空成功') : fail('clearText()', `殘留 "${t4}"`);
  } catch (e) { fail('clearText()', String(e)); }

  // subscribe
  try {
    let cbCalled = false;
    const unsub = client.subscribe(() => { cbCalled = true; });
    await client.insertText(0, 'test');
    unsub();
    await client.insertText(4, '!');
    cbCalled ? ok('subscribe() / unsubscribe', '回呼被觸發') : fail('subscribe() / unsubscribe', '回呼未觸發');
    await client.clearText();
  } catch (e) { fail('subscribe()', String(e)); }

  // ──────────────────────────────────────────────
  // 5. Map API
  // ──────────────────────────────────────────────
  try {
    await client.setMap('settings', 'theme', 'dark');
    const m = client.getMap('settings');
    m.theme === 'dark' ? ok('setMap() + getMap()', `theme = "${m.theme}"`) : fail('setMap() + getMap()', JSON.stringify(m));
  } catch (e) { fail('setMap() + getMap()', String(e)); }

  try {
    await client.setMap('settings', 'fontSize', 16);
    const m = client.getMap('settings');
    m.fontSize === 16 ? ok('setMap() 數值', `fontSize = ${m.fontSize}`) : fail('setMap() 數值', String(m.fontSize));
  } catch (e) { fail('setMap() 數值', String(e)); }

  try {
    await client.setMap('settings', 'nested', { a: 1, b: 'x' });
    const m = client.getMap('settings');
    m.nested?.a === 1 ? ok('setMap() 物件', JSON.stringify(m.nested)) : fail('setMap() 物件', JSON.stringify(m.nested));
  } catch (e) { fail('setMap() 物件', String(e)); }

  // setMapDeep
  try {
    client.setMapDeep('config', ['ui', 'sidebar', 'width'], 300);
    client.setMapDeep('config', ['ui', 'sidebar', 'visible'], true);
    const cfg = client.getMap('config');
    cfg?.ui?.sidebar?.width === 300 && cfg?.ui?.sidebar?.visible === true
      ? ok('setMapDeep()', JSON.stringify(cfg.ui.sidebar))
      : fail('setMapDeep()', JSON.stringify(cfg));
  } catch (e) { fail('setMapDeep()', String(e)); }

  // batchSet
  try {
    client.batchSet([
      ['batch', 'a', 1],
      ['batch', 'b', 'hello'],
      ['batch', 'c', true],
    ]);
    const bm = client.getMap('batch');
    bm.a === 1 && bm.b === 'hello' && bm.c === true
      ? ok('batchSet()', JSON.stringify(bm))
      : fail('batchSet()', JSON.stringify(bm));
  } catch (e) { fail('batchSet()', String(e)); }

  // ──────────────────────────────────────────────
  // 6. Array API
  // ──────────────────────────────────────────────
  try {
    await client.pushArray('logs', { action: 'click', time: 123 });
    await client.pushArray('logs', 'simple-string');
    const arr = client.getArray('logs');
    arr.length === 2 && arr[0]?.action === 'click' && arr[1] === 'simple-string'
      ? ok('pushArray() + getArray()', JSON.stringify(arr))
      : fail('pushArray() + getArray()', JSON.stringify(arr));
  } catch (e) { fail('pushArray() + getArray()', String(e)); }

  // ──────────────────────────────────────────────
  // 7. Proxy 透明寫入
  // ──────────────────────────────────────────────
  try {
    interface ProxyTest { color: string; size: number; }
    const proxy = createMapProxy<ProxyTest>(client, 'proxy-test');
    proxy.color = 'red';
    proxy.size = 42;
    const pm = client.getMap('proxy-test');
    pm.color === 'red' && pm.size === 42
      ? ok('createMapProxy()', JSON.stringify(pm))
      : fail('createMapProxy()', JSON.stringify(pm));
  } catch (e) { fail('createMapProxy()', String(e)); }

  try {
    const arrProxy = createArrayProxy<string>(client, 'proxy-arr');
    arrProxy.push('aaa');
    arrProxy.push('bbb');
    const pa = client.getArray('proxy-arr');
    pa.length === 2 && pa[0] === 'aaa'
      ? ok('createArrayProxy()', JSON.stringify(pa))
      : fail('createArrayProxy()', JSON.stringify(pa));
  } catch (e) { fail('createArrayProxy()', String(e)); }

  // ──────────────────────────────────────────────
  // 8. Awareness API
  // ──────────────────────────────────────────────
  try {
    client.setAwareness({ name: 'Tester', color: '#ff0000' });
    const states = client.getAwarenessStates();
    const myId = client.getClientId();
    const myState = states.get(myId);
    myState?.name === 'Tester' && myState?.color === '#ff0000'
      ? ok('setAwareness() + getAwarenessStates()', `name=${myState.name}, color=${myState.color}`)
      : fail('setAwareness()', JSON.stringify(myState));
  } catch (e) { fail('setAwareness()', String(e)); }

  try {
    let cbStates: any = null;
    const unsubAw = client.onAwarenessChange((s) => { cbStates = s; });
    cbStates !== null
      ? ok('onAwarenessChange()', `首次觸發，size=${cbStates.size}`)
      : fail('onAwarenessChange()', '首次未觸發');
    unsubAw();
  } catch (e) { fail('onAwarenessChange()', String(e)); }

  try {
    client.leaveAwareness();
    const states2 = client.getAwarenessStates();
    const myId = client.getClientId();
    !states2.has(myId)
      ? ok('leaveAwareness()', '本地狀態已清除')
      : fail('leaveAwareness()', '本地狀態仍存在');
  } catch (e) { fail('leaveAwareness()', String(e)); }

  // ──────────────────────────────────────────────
  // 9. 網路狀態
  // ──────────────────────────────────────────────
  try {
    let netStatus = 'unknown';
    client.subscribeNetwork((s) => { netStatus = s; });
    ok('subscribeNetwork()', `已訂閱，初始狀態：${netStatus}`);
  } catch (e) { fail('subscribeNetwork()', String(e)); }

  // ──────────────────────────────────────────────
  // 10. Plugin 系統
  // ──────────────────────────────────────────────

  // Logger
  try {
    client.use(createLoggerPlugin('[Test]'));
    ok('createLoggerPlugin()', '安裝成功（見 console）');
  } catch (e) { fail('createLoggerPlugin()', String(e)); }

  // Undo / Redo
  try {
    const { plugin: undoPlugin, undo, redo } = createUndoPlugin();
    client.use(undoPlugin);

    await client.setMap('undo-test', 'val', 1);
    await delay(600); // 讓 undo manager 區分不同操作組
    await client.setMap('undo-test', 'val', 2);
    const before = client.getMap('undo-test');

    undo();
    const after = client.getMap('undo-test');

    redo();
    const afterRedo = client.getMap('undo-test');

    if (before.val === 2 && after.val === 1 && afterRedo.val === 2) {
      ok('createUndoPlugin() undo+redo', `2→1→2 ✓`);
    } else {
      fail('createUndoPlugin()', `before=${before.val} after=${after.val} afterRedo=${afterRedo.val}`);
    }
  } catch (e) { fail('createUndoPlugin()', String(e)); }

  // DB Plugin
  try {
    const { plugin: dbPlugin, forceSave } = createDbPlugin({
      dbName: `yoin-test-${room}`,
      debounceMs: 100,
    });
    client.use(dbPlugin);
    ok('createDbPlugin() 安裝', '安裝成功');

    await client.setMap('db-test', 'ts', Date.now());
    await delay(200); // 等 debounce
    await forceSave();
    ok('forceSave()', '強制存檔成功');

    // 直接讀 IndexedDB 驗證
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(`yoin-test-${room}`, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('documents', 'readonly');
    const store = tx.objectStore('documents');
    const data: Uint8Array | null = await new Promise((resolve, reject) => {
      const req = store.get(room);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();

    data && data.byteLength > 0
      ? ok('DB 持久化驗證', `IndexedDB 有 ${data.byteLength} bytes`)
      : fail('DB 持久化驗證', '讀不到資料');
  } catch (e) { fail('createDbPlugin()', String(e)); }

  // 自訂 Plugin
  try {
    let installed = false;
    let beforeCalled = false;
    let afterCalled = false;
    const customPlugin = {
      name: 'test-custom',
      onInstall() { installed = true; },
      onBeforeUpdate() { beforeCalled = true; },
      onAfterUpdate() { afterCalled = true; },
      onDestroy() {},
    };
    client.use(customPlugin);
    await client.setMap('custom-test', 'x', 1);
    installed && beforeCalled && afterCalled
      ? ok('自訂 Plugin', '所有 hook 正常觸發')
      : fail('自訂 Plugin', `installed=${installed} before=${beforeCalled} after=${afterCalled}`);
  } catch (e) { fail('自訂 Plugin', String(e)); }

  // ──────────────────────────────────────────────
  // 11. Hook API
  // ──────────────────────────────────────────────
  try {
    let docUpdated = false;
    const unsub = client.onDocUpdate(() => { docUpdated = true; });
    await client.setMap('hook-test', 'a', 1);
    unsub();
    docUpdated ? ok('onDocUpdate()', '觸發成功') : fail('onDocUpdate()', '未觸發');
  } catch (e) { fail('onDocUpdate()', String(e)); }

  try {
    let localUpdated = false;
    const unsub = client.onLocalUpdate(() => { localUpdated = true; });
    await client.setMap('hook-test', 'b', 2);
    unsub();
    localUpdated ? ok('onLocalUpdate()', '觸發成功') : fail('onLocalUpdate()', '未觸發');
  } catch (e) { fail('onLocalUpdate()', String(e)); }

  // ──────────────────────────────────────────────
  // 12. 底層 Map/Array
  // ──────────────────────────────────────────────
  try {
    const raw = client.map_get_all('settings');
    typeof raw === 'object' ? ok('map_get_all()', '回傳物件') : fail('map_get_all()', typeof raw);
  } catch (e) { fail('map_get_all()', String(e)); }

  try {
    const raw = client.array_get_all('logs');
    Array.isArray(raw) ? ok('array_get_all()', `length=${raw.length}`) : fail('array_get_all()', typeof raw);
  } catch (e) { fail('array_get_all()', String(e)); }

  // ──────────────────────────────────────────────
  // 13. Destroy
  // ──────────────────────────────────────────────
  try {
    client.destroy();
    ok('destroy()', '銷毀成功');
  } catch (e) { fail('destroy()', String(e)); }

  // ──────────────────────────────────────────────
  // 完成
  // ──────────────────────────────────────────────
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  statusEl.textContent = `測試完成：${passed} 通過 / ${failed} 失敗`;
  statusEl.style.color = failed > 0 ? '#e74c3c' : '#27ae60';
  renderResults();
}

main();