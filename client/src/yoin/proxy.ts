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

            // 讀取屬性時，回傳一個帶有路徑累積能力的 Deep Proxy
            return createDeepProxy(client, mapName, [String(prop)]);
        },

        set(target, prop, value) {
            // 根屬性寫入 -> setMap
            const key = String(prop);
            console.log(`[MapProxy] Set: ${mapName}.${key} =`, value);
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
 * 限制：暫不支援透過索引賦值 (e.g. arr[0] = val)
 */
export function createArrayProxy<T>(client: YoinClient, arrayName: string): T[] {
    const handler: ProxyHandler<any> = {
        get(target, prop, receiver) {
            if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
            
            // 攔截 push 方法
            if (prop === 'push') {
                return (...items: any[]) => {
                    items.forEach(item => {
                        console.log(`[ArrayProxy] Push: ${arrayName}.push(`, item, `)`);
                        client.pushArray(arrayName, item);
                    });
                    return items.length; // 模擬標準 push 回傳值
                };
            }

            // 攔截常用唯讀方法，避免報錯 (這裡可以擴充更多 Array 方法)
            if (['map', 'forEach', 'filter', 'reduce'].includes(String(prop))) {
                console.warn(`[ArrayProxy] Method '${String(prop)}' works on local snapshot, not live data.`);
                return () => []; // 回傳空陣列避免前端崩潰，或實作讀取邏輯
            }

            return Reflect.get(target, prop, receiver);
        },

        set(target, prop, value) {
            // 阻擋索引賦值 (因為我們尚未封裝 array_update_at API)
            console.warn(`[ArrayProxy] Index assignment (${String(prop)}) is not supported. Please use .push()`);
            return true; // 回傳 true 避免 Strict mode 報錯
        }
    };
    return new Proxy([], handler) as unknown as T[];
}

// ==========================================
// 3. Generic/Deep Proxy (內部核心與通用入口)
// ==========================================

/**
 * 內部使用的遞迴代理處理器 (處理巢狀 Map)
 */
function createDeepProxy(client: YoinClient, rootName: string, path: string[]) {
    return new Proxy({}, {
        get(target, prop) {
            // 繼續往下鑽，累積路徑
            return createDeepProxy(client, rootName, [...path, String(prop)]);
        },
        set(target, prop, value) {
            // 巢狀屬性寫入 -> setMapDeep
            const fullPath = [...path, String(prop)];
            console.log(`[DeepProxy] Set: ${rootName}.${fullPath.join('.')} =`, value);
            client.setMapDeep(rootName, fullPath, value);
            return true;
        }
    });
}

/**
 * [Deprecated] 舊版通用入口 (為了相容性保留，或用於不確定型別時)
 * 自動判斷是 Map 行為還是 Array 行為 (基於使用方式)
 */
export function createYoinProxy<T extends object>(client: YoinClient, rootName: string): T {
    return new Proxy({}, {
        get(target, prop, receiver) {
            // 如果呼叫了 push，切換成 Array 行為
            if (prop === 'push') {
                return (...args: any[]) => {
                    args.forEach(item => client.pushArray(rootName, item));
                    return true;
                };
            }
            // 否則預設為 Map 行為，開始累積路徑
            return createDeepProxy(client, rootName, [String(prop)]);
        },
        set(target, prop, value) {
            // 根屬性寫入
            client.setMap(rootName, String(prop), value);
            return true;
        }
    }) as T;
}