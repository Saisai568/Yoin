import { YoinClient } from './YoinClient';

// ==========================================
// 1. Map Proxy 
// ==========================================
/**
 * Create proxy objects for Map  
* Supports: obj.prop = val (setMap) and obj.nested.prop = val (setMapDeep)
 */
export function createMapProxy<T extends object>(client: YoinClient, mapName: string): T {
    const handler: ProxyHandler<any> = {
        get(target, prop, receiver) {
            if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
            if (prop === 'toJSON') return () => ({ __type: 'MapProxy', mapName });

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
// 2. Array Proxy
// ==========================================
/**
 * Create a proxy object dedicated to arrays
 * Supports: arr.push(item) (pushArray)
 */
export function createArrayProxy<T>(client: YoinClient, arrayName: string): T[] {
    // Obtain the current data snapshot from the client as the target
    let snapshot: any[] = [];
    try {
        const raw = client.array_get_all(arrayName);
        snapshot = Array.isArray(raw) ? raw : [];
    } catch (e) { 
        snapshot = []; 
    }

    const handler: ProxyHandler<any> = {
        get(target, prop, receiver) {
            if (prop === 'push') {
                return (...items: any[]) => {
                    items.forEach(item => {
                        console.log(`[ArrayProxy] Push: ${arrayName}.push(`, item, `)`);
                        client.pushArray(arrayName, item);
                    });
                    return items.length;
                };
            }
            // Directly forward to the snapshot array
            const value = Reflect.get(snapshot, prop, receiver);

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
// 3. Generic/Deep Proxy (Internal Core and Common Entry)
// ==========================================

/**
 * Internal recursive proxy handler (handles nested Maps)
 */
function createDeepProxy(client: YoinClient, rootName: string, path: string[]) {
    
    // 1. First, try to read the value of this path from the local snapshot
    let snapshotValue: any = undefined;
    try {
        const rootObj = client.map_get_all(rootName);
        if (rootObj && typeof rootObj === 'object') {
            snapshotValue = rootObj;
            for (const key of path) {
                if (snapshotValue === undefined || snapshotValue === null) break;
                snapshotValue = snapshotValue[key];
            }
        }
    } catch (e) { /* ignore */ }

    // 2. Determine the value type
    // If it's a primitive type (string, number, boolean, null), return the value directly!
    // This way React won't receive a Proxy object and crash
    if (snapshotValue !== undefined && snapshotValue !== null && typeof snapshotValue !== 'object') {
        return snapshotValue;
    }

    // 3. Only return a Proxy to support writing if it is undefined (not yet created) or an object (has another layer).
    // Note: There is a trade-off here. If it is undefined, we return a Proxy so you can assign to it (obj.a = 1).
    // But if React tries to read an undefined field, it will get a Proxy.
    // So when using it in React, you must ensure that the field has been initialized, or use String() to forcibly convert it (we handle it in toString).

    const handler: ProxyHandler<any> = {
        get(target, prop) {
            if (prop === 'toString' || prop === 'valueOf') {
                return () => snapshotValue !== undefined ? String(snapshotValue) : "";
            }
            if (prop === Symbol.toPrimitive) {
                return () => snapshotValue !== undefined ? snapshotValue : "";
            }
            
            //Continue drilling down to the next layer of Proxy
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