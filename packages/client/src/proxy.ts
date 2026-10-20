// packages/client/src/proxy.ts
import { YoinClient } from './YoinClient';

// ==========================================
// 1. Map Proxy
// ==========================================
export function createMapProxy<T extends object>(
  client: YoinClient,
  mapName: string,
): T {
  const handler: ProxyHandler<any> = {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === 'toJSON') {
        return () => ({
          __type: 'MapProxy',
          mapName,
          ...client.getMap(mapName),
        });
      }

      const key = String(prop);
      const currentMap = client.getMap(mapName);
      const val = currentMap[key];

      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        return createDeepProxy(client, mapName, [key], val);
      }

      return val;
    },

    set(_target, prop, value) {
      const key = String(prop);
      void client.setMap(mapName, key, value);
      return true;
    },

    deleteProperty(_target, prop) {
      const key = String(prop);
      void client.deleteMap(mapName, key);
      return true;
    },

    has(target, prop) {
      if (typeof prop === 'symbol') return prop in target;
      const currentMap = client.getMap(mapName);
      return Object.prototype.hasOwnProperty.call(currentMap, prop);
    },

    ownKeys() {
      return Reflect.ownKeys(client.getMap(mapName));
    },

    getOwnPropertyDescriptor(_target, prop) {
      const currentMap = client.getMap(mapName);
      if (Object.prototype.hasOwnProperty.call(currentMap, prop)) {
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: currentMap[String(prop)],
        };
      }
      return undefined;
    },
  };
  return new Proxy({}, handler) as T;
}

// ==========================================
// 2. Array Proxy
// ==========================================
export function createArrayProxy<T>(
  client: YoinClient,
  arrayName: string,
): T[] {
  const getLiveArray = (): T[] => {
    try {
      const raw = client.getArray<T>(arrayName);
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  };

  const handler: ProxyHandler<T[]> = {
    get(_target, prop, _receiver) {
      if (prop === 'push') {
        return (...items: T[]) => {
          items.forEach((item) => {
            void client.pushArray(arrayName, item);
          });
          return getLiveArray().length;
        };
      }

      if (prop === 'splice') {
        return (start: number, deleteCount?: number, ...items: T[]) => {
          const current = getLiveArray();
          const len = current.length;
          const actualStart =
            start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
          const actualDelete =
            deleteCount === undefined
              ? len - actualStart
              : Math.max(0, Math.min(deleteCount, len - actualStart));

          const removed = current.slice(actualStart, actualStart + actualDelete);
          if (actualDelete > 0) {
            void client.deleteArray(arrayName, actualStart, actualDelete);
          }
          items.forEach((item, idx) => {
            void client.insertArray(arrayName, actualStart + idx, item);
          });
          return removed;
        };
      }

      if (prop === 'pop') {
        return () => {
          const current = getLiveArray();
          if (current.length === 0) return undefined;
          const last = current[current.length - 1];
          void client.deleteArray(arrayName, current.length - 1, 1);
          return last;
        };
      }

      if (prop === 'shift') {
        return () => {
          const current = getLiveArray();
          if (current.length === 0) return undefined;
          const first = current[0];
          void client.deleteArray(arrayName, 0, 1);
          return first;
        };
      }

      if (prop === 'unshift') {
        return (...items: T[]) => {
          items.forEach((item, idx) => {
            void client.insertArray(arrayName, idx, item);
          });
          return getLiveArray().length;
        };
      }

      const live = getLiveArray();
      const value = Reflect.get(live, prop, live);

      if (typeof value === 'function') {
        return value.bind(live);
      }
      return value;
    },

    set(_target, prop, _value) {
      console.warn(
        `[ArrayProxy] Index assignment (${String(prop)}) is not supported. Please use .push()`,
      );
      return true;
    },

    has(_target, prop) {
      const live = getLiveArray();
      return Reflect.has(live, prop);
    },

    ownKeys() {
      const live = getLiveArray();
      return Reflect.ownKeys(live);
    },

    getOwnPropertyDescriptor(_target, prop) {
      const live = getLiveArray();
      return Object.getOwnPropertyDescriptor(live, prop);
    },
  };

  return new Proxy([] as T[], handler);
}

// ==========================================
// 3. Generic/Deep Proxy (Internal)
// ==========================================

function createDeepProxy(
  client: YoinClient,
  rootName: string,
  path: string[],
  currentTarget: Record<string, any>,
): any {
  const handler: ProxyHandler<any> = {
    get(_target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(currentTarget, prop, receiver);
      }
      if (prop === 'toJSON') {
        return () => currentTarget;
      }

      const key = String(prop);
      const val = currentTarget[key];

      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        return createDeepProxy(client, rootName, [...path, key], val);
      }

      return val;
    },

    set(_target, prop, value) {
      const fullPath = [...path, String(prop)];
      client.setMapDeep(rootName, fullPath, value);
      return true;
    },

    has(_target, prop) {
      return Reflect.has(currentTarget, prop);
    },

    ownKeys() {
      return Reflect.ownKeys(currentTarget);
    },

    getOwnPropertyDescriptor(_target, prop) {
      return Object.getOwnPropertyDescriptor(currentTarget, prop);
    },
  };

  return new Proxy(currentTarget, handler);
}
