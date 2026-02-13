import { YoinClient } from './YoinClient';

// ==========================================
// 1. Map Proxy (物件代理)
// ==========================================
/**
 * 建立 Map 專用的代理物件
 * 支援：obj.prop = val (setMap) 與 obj.nested.prop = val (setMapDeep)
 */
export function createMapProxy<T extends object>(client: YoinClient, mapName: string): T {
    const handler: ProxyHandler<any> = {
        get(target, prop, receiver) {
            if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
            if (prop === 'toJSON') return () => ({ __type: 'MapProxy', mapName });

            // [關鍵修復] 1. 嘗試從底層 Yoin Doc 獲取真實值
            // 注意：這裡我們假設 mapName 是根層級 Map
            // 因為 YoinClient 沒有直接讀取 nested map 的同步 API，
            // 我們這裡做一個妥協：只針對第一層做優化，或者依賴開發者正確使用型別。
            
            // 更安全的做法：總是回傳 Deep Proxy，但在 Deep Proxy 內部做判斷
            return createDeepProxy(client, mapName, [String(prop)]);
        },

        set(target, prop, value) {
            const key = String(prop);
            client.setMap(mapName, key, value);
            return true;
        }
    };
    return new Proxy({}, handler) as T;
}

// ==========================================
// 2. Array Proxy (陣列代理)
// ==========================================
/**
 * 建立 Array 專用的代理物件
 * 支援：arr.push(item) (pushArray)
 */
export function createArrayProxy<T>(client: YoinClient, arrayName: string): T[] {
    // 為了讓 Array.map 等方法能運作，我們必須代理一個真實的陣列快照
    // 但為了效能，我們這裡還是代理一個空陣列，並攔截讀取
    
    // [優化] 為了 React 渲染，我們需要讓這個 Proxy 表現得像一個真實陣列
    // 所以我們嘗試從 Client 獲取當前數據快照作為 target
    let snapshot: any[] = [];
    try {
        const raw = client.array_get_all(arrayName);
        snapshot = raw ? JSON.parse(raw) : [];
    } catch (e) { 
        snapshot = []; 
    }

    const handler: ProxyHandler<any> = {
        get(target, prop, receiver) {
            // 如果是 push，攔截並寫入
            if (prop === 'push') {
                return (...items: any[]) => {
                    items.forEach(item => {
                        console.log(`[ArrayProxy] Push: ${arrayName}.push(`, item, `)`);
                        client.pushArray(arrayName, item);
                    });
                    return items.length;
                };
            }

            // [關鍵修復] 對於其他屬性 (length, map, forEach, 索引存取)
            // 直接轉發給快照陣列，這樣 React 才能正確渲染列表！
            const value = Reflect.get(snapshot, prop, receiver);
            
            // 如果值是函式 (e.g. map)，需要綁定到 snapshot 上執行
            if (typeof value === 'function') {
                return value.bind(snapshot);
            }
            return value;
        },

        set(target, prop, value) {
            console.warn(`[ArrayProxy] Index assignment (${String(prop)}) is not supported. Please use .push()`);
            return true;
        }
    };
    
    return new Proxy(snapshot, handler) as unknown as T[];
}

// ==========================================
// 3. Generic/Deep Proxy (內部核心與通用入口)
// ==========================================

/**
 * 內部使用的遞迴代理處理器 (處理巢狀 Map)
 */
function createDeepProxy(client: YoinClient, rootName: string, path: string[]) {
    // [關鍵修復] 這裡不能只回傳 Proxy，必須嘗試讀取值
    // 但因為 Yoin 的 map_get_deep API 可能還沒暴露，或是非同步的
    // 我們採取「混合策略」：
    
    // 1. 先嘗試讀取這個路徑在本地快照中的值
    let snapshotValue: any = undefined;
    try {
        // 取得根 Map 的完整 JSON
        const rootJson = client.map_get_all(rootName);
        if (rootJson) {
            const rootObj = JSON.parse(rootJson);
            // 依路徑往下鑽
            snapshotValue = rootObj;
            for (const key of path) {
                if (snapshotValue === undefined || snapshotValue === null) break;
                snapshotValue = snapshotValue[key];
            }
        }
    } catch (e) { /* ignore */ }

    // 2. 判斷值類型
    // 如果是基本型別 (string, number, boolean, null)，直接回傳值！
    // 這樣 React 就不會拿到 Proxy 物件而崩潰
    if (snapshotValue !== undefined && snapshotValue !== null && typeof snapshotValue !== 'object') {
        return snapshotValue;
    }

    // 3. 如果是 undefined (還沒建立) 或是 object (還有一層)，才回傳 Proxy 以支援寫入
    // 注意：這裡有一個 trade-off。如果它是 undefined，我們回傳 Proxy 讓你可以寫入 (obj.a = 1)。
    // 但如果 React 嘗試讀取一個 undefined 的欄位，它會拿到 Proxy。
    // 所以在 React 中使用時，必須確保欄位已初始化，或者使用 String() 強轉 (我們在 toString 中處理)。

    const handler: ProxyHandler<any> = {
        get(target, prop) {
            if (prop === 'toString' || prop === 'valueOf') {
                // 當被強轉為字串時 (例如 String(proxy))，回傳空字串或原始值，避免報錯
                return () => snapshotValue !== undefined ? String(snapshotValue) : "";
            }
            if (prop === Symbol.toPrimitive) {
                return () => snapshotValue !== undefined ? snapshotValue : "";
            }
            
            // 繼續往下鑽
            return createDeepProxy(client, rootName, [...path, String(prop)]);
        },
        set(target, prop, value) {
            const fullPath = [...path, String(prop)];
            console.log(`[DeepProxy] Set: ${rootName}.${fullPath.join('.')} =`, value);
            client.setMapDeep(rootName, fullPath, value);
            return true;
        }
    };

    return new Proxy({}, handler);
}