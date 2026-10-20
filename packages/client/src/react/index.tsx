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
import type { TextDeltaOp } from '../types';

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
 * useYoinMap - Reactive Map Hook (Container-Scoped)
 * @param mapName Map name
 * @returns Proxy object with reactive read/write/delete
 */
export function useYoinMap<T extends object>(mapName: string): T {
  const client = useYoinClient();

  const subscribe = useMemo(() => {
    return (callback: () => void) =>
      client.subscribeMap(mapName, () => callback());
  }, [client, mapName]);

  const getSnapshot = () => {
    const data = client.getMap(mapName);
    return JSON.stringify(data ?? {});
  };

  const snapshotKey = useSyncExternalStore(subscribe, getSnapshot);

  const proxy = useMemo(() => {
    return createMapProxy<T>(client, mapName);
  }, [client, mapName, snapshotKey]);

  return proxy;
}

/**
 * useYoinArray - Reactive Array Hook (Container-Scoped)
 * @param arrayName Array name
 * @returns Proxy array with reactive push/splice/pop/shift/unshift
 */
export function useYoinArray<T>(arrayName: string): T[] {
  const client = useYoinClient();

  const subscribe = useMemo(() => {
    return (callback: () => void) =>
      client.subscribeArray(arrayName, () => callback());
  }, [client, arrayName]);

  const getSnapshot = () => {
    const data = client.getArray(arrayName);
    return JSON.stringify(data ?? []);
  };

  const snapshotKey = useSyncExternalStore(subscribe, getSnapshot);

  const proxy = useMemo(() => {
    return createArrayProxy<T>(client, arrayName);
  }, [client, arrayName, snapshotKey]);

  return proxy;
}

/**
 * useYoinText - Reactive Text & Rich Text Delta Hook
 * @param textName Optional text container name (default: 'content')
 */
export function useYoinText(textName: string = 'content'): {
  text: string;
  delta: TextDeltaOp[];
  insert: (index: number, chunk: string, attrs?: Record<string, any>) => Promise<void>;
  deleteText: (index: number, length: number) => Promise<void>;
  format: (index: number, length: number, attrs: Record<string, any>) => Promise<void>;
  applyDelta: (ops: TextDeltaOp[]) => Promise<void>;
} {
  const client = useYoinClient();

  const subscribe = useMemo(() => {
    return (callback: () => void) =>
      client.subscribeText(textName, () => callback());
  }, [client, textName]);

  const getSnapshot = () => {
    return JSON.stringify(client.getTextDelta(textName));
  };

  useSyncExternalStore(subscribe, getSnapshot);

  return useMemo(
    () => ({
      text: client.getText(textName),
      delta: client.getTextDelta(textName),
      insert: (index: number, chunk: string, attrs?: Record<string, any>) =>
        client.insertText(index, chunk, attrs, textName),
      deleteText: (index: number, length: number) =>
        client.deleteText(index, length, textName),
      format: (index: number, length: number, attrs: Record<string, any>) =>
        client.formatText(index, length, attrs, textName),
      applyDelta: (ops: TextDeltaOp[]) =>
        client.applyTextDelta(ops, textName),
    }),
    [client, textName, client.getText(textName), JSON.stringify(client.getTextDelta(textName))],
  );
}

// ==========================================
// 3. Utility Hooks
// ==========================================

export function useYoinAwareness() {
  const client = useYoinClient();

  const subscribe = useMemo(() => {
    return (callback: () => void) => {
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
      const unsubscribeNet = client.subscribeNetwork(() => callback());

      window.addEventListener('online', callback);
      window.addEventListener('offline', callback);

      return () => {
        unsubscribeNet();
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
