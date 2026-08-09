// packages/client/src/react/index.tsx
// ============================================================
// React Hooks for Yoin
// ============================================================
import React, {
  createContext,
  useContext,
  useSyncExternalStore,
  useMemo,
} from 'react';
import { YoinClient } from '../YoinClient';
import { createMapProxy, createArrayProxy } from '../proxy';

// ==========================================
// 1. Context Provider
// ==========================================
const YoinContext = createContext<YoinClient | null>(null);

export const YoinProvider: React.FC<{
  client: YoinClient;
  children: React.ReactNode;
}> = ({ client, children }) => {
  return (
    <YoinContext.Provider value={client}>
      {children}
    </YoinContext.Provider>
  );
};

export const useYoinClient = () => {
  const client = useContext(YoinContext);
  if (!client)
    throw new Error(
      'useYoinClient must be used within a YoinProvider',
    );
  return client;
};

// ==========================================
// 2. Data Hooks
// ==========================================

/**
 * useYoinMap - Reactive Map Hook
 * @param mapName Map name
 * @returns Proxy object with reactive read/write
 */
export function useYoinMap<T extends object>(mapName: string): T {
  const client = useYoinClient();

  const subscribe = useMemo(() => {
    return (callback: () => void) => client.subscribe(callback);
  }, [client]);

  const getSnapshot = () => {
    const data = client.map_get_all(mapName);
    return JSON.stringify(data ?? {});
  };

  useSyncExternalStore(subscribe, getSnapshot);

  const proxy = useMemo(() => {
    return createMapProxy<T>(client, mapName);
  }, [client, mapName]);

  return proxy;
}

/**
 * useYoinArray - Reactive Array Hook
 * @param arrayName Array name
 */
export function useYoinArray<T>(arrayName: string): T[] {
  const client = useYoinClient();

  const subscribe = useMemo(() => {
    return (callback: () => void) => client.subscribe(callback);
  }, [client]);

  const getSnapshot = () => {
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

  const subscribe = useMemo(() => {
    return (callback: () => void) => {
      // Awareness packets do not modify the CRDT document, so subscribing to
      // document updates misses joins, leaves, and cursor/presence changes.
      return client.onAwarenessChange(() => callback());
    };
  }, [client]);

  const getSnapshot = () => {
    return JSON.stringify(
      Array.from(client.getAwarenessStates().entries()),
    );
  };

  useSyncExternalStore(subscribe, getSnapshot);

  return client.getAwarenessStates();
}

// ==========================================
// 4. Network Status Hook
// ==========================================
export function useYoinStatus() {
  const client = useYoinClient();

  const subscribe = React.useMemo(() => {
    return (callback: () => void) => {
      const unsubscribe = client.subscribe(callback);

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
    return client.network?.isConnected ? 'connected' : 'disconnected';
  };

  const status = React.useSyncExternalStore(subscribe, getSnapshot);
  return status === 'connected';
}
