// client/src/react/index.tsx
// ============================================================
// React Hooks for Yoin
import React, { createContext, useContext, useSyncExternalStore, useMemo } from 'react';
import { YoinClient } from '../yoin/YoinClient';
import { createMapProxy, createArrayProxy } from '../yoin/proxy';

// ==========================================
// 1. Context Provider
// ==========================================
const YoinContext = createContext<YoinClient | null>(null);

export const YoinProvider: React.FC<{ client: YoinClient; children: React.ReactNode }> = ({ client, children }) => {
    return <YoinContext.Provider value={client}>{children}</YoinContext.Provider>;
};

export const useYoinClient = () => {
    const client = useContext(YoinContext);
    if (!client) throw new Error('useYoinClient must be used within a YoinProvider');
    return client;
};

// ==========================================
// 2. Data Hooks (The Magic 🪄)
// ==========================================

/**
 * useYoinMap - 響應式的 Map Hook
 * @param mapName Map 名稱
 * @returns [ProxyObject, setMap]
 */
export function useYoinMap<T extends object>(mapName: string): T {
    const client = useYoinClient();

    // A. 訂閱 store (React 18+ 推薦寫法)
    // 這裡我們利用 YoinClient 的 notifyListeners 機制來觸發 React 重繪
    const subscribe = useMemo(() => {
        return (callback: () => void) => client.subscribe(callback);
    }, [client]);

    // B. 取得快照 (Snapshot)
    // 每次重繪時，回傳最新的資料快照
    // 注意：為了效能，通常這裡應該回傳 immutable 的副本，但因為我們有 Proxy，
    // 我們回傳 Proxy 實例讓使用者可以直接讀取最新值
    const getSnapshot = () => {
        // Serialize to JSON string for React equality comparison (useSyncExternalStore)
        // map_get_all now returns a native JS object, so we stringify for stable comparison
        const data = client.map_get_all(mapName);
        return JSON.stringify(data ?? {}); 
    };

    // C. 觸發 React 更新
    useSyncExternalStore(subscribe, getSnapshot);

    // D. 回傳穩定的 Proxy 物件
    // 使用者可以直接修改這個物件 (state.prop = val) 來觸發更新
    const proxy = useMemo(() => {
        return createMapProxy<T>(client, mapName);
    }, [client, mapName]);

    return proxy;
}

/**
 * useYoinArray - 響應式的 Array Hook
 * @param arrayName Array 名稱
 */
export function useYoinArray<T>(arrayName: string): T[] {
    const client = useYoinClient();

    const subscribe = useMemo(() => {
        return (callback: () => void) => client.subscribe(callback);
    }, [client]);

    const getSnapshot = () => {
        // Serialize to JSON string for React equality comparison
        // array_get_all now returns a native JS array, so we stringify for stable comparison
        const data = client.array_get_all(arrayName);
        return JSON.stringify(data ?? []);
    };

    useSyncExternalStore(subscribe, getSnapshot);

    const proxy = useMemo(() => {
        return createArrayProxy<T>(client, arrayName);
    }, [client, arrayName]);

    return proxy;
}

// ==========================================
// 3. Utility Hooks
// ==========================================

export function useYoinAwareness() {
    const client = useYoinClient();
    
    // 訂閱 Awareness 變更
    const subscribe = useMemo(() => {
        return (callback: () => void) => {
            // 這裡假設你的 client 有暴露 awareness 的監聽方法
            // 如果沒有，可能需要擴充 YoinClient 或利用通用的 subscribe
            return client.subscribe(callback); 
        };
    }, [client]);

    const getSnapshot = () => {
        // 回傳 Awareness Map 的字串化版本
        return JSON.stringify(Array.from(client.getAwarenessStates().entries()));
    };

    useSyncExternalStore(subscribe, getSnapshot);

    return client.getAwarenessStates();
}

// ==========================================
// 4. Network Status Hook (新增這個!)
// ==========================================
export function useYoinStatus() {
    const client = useYoinClient();
    
    // 使用 useSyncExternalStore 訂閱網路狀態
    const subscribe = React.useMemo(() => {
        return (callback: () => void) => {
            // 這裡假設你的 NetworkProvider 有 'status' 事件
            // 如果沒有，我們需要去 NetworkProvider 補上，或者簡單地用 setInterval 輪詢
            // 這裡我們先用一個簡單的 hack: 監聽 client 的任何變化
            const unsubscribe = client.subscribe(callback);
            
            // 監聽 window 的 online/offline 事件作為輔助
            window.addEventListener('online', callback);
            window.addEventListener('offline', callback);
            
            return () => {
                unsubscribe();
                window.removeEventListener('online', callback);
                window.removeEventListener('offline', callback);
            };
        };
    }, [client]);

    const getSnapshot = () => {
        // 回傳目前的連線狀態字串
        // 請確保你的 YoinClient.network 有 exposing isConnected 或類似屬性
        // 如果沒有，請回報，我們先假設 NetworkProvider 有暴露狀態
        return client.network?.isConnected ? 'connected' : 'disconnected';
    };

    const status = React.useSyncExternalStore(subscribe, getSnapshot);
    return status === 'connected';
}