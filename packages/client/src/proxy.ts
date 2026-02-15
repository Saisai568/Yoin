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
      if (typeof prop === 'symbol')
        return Reflect.get(target, prop, receiver);
      if (prop === 'toJSON')
        return () => ({ __type: 'MapProxy', mapName });

      return createDeepProxy(client, mapName, [String(prop)]);
    },

    set(_target, prop, value) {
      const key = String(prop);
      client.setMap(mapName, key, value);
      return true;
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
  let snapshot: any[] = [];
  try {
    const raw = client.array_get_all(arrayName);
    snapshot = Array.isArray(raw) ? raw : [];
  } catch {
    snapshot = [];
  }

  const handler: ProxyHandler<any> = {
    get(target, prop, receiver) {
      if (prop === 'push') {
        return (...items: any[]) => {
          items.forEach((item) => {
            console.log(
              `[ArrayProxy] Push: ${arrayName}.push(`,
              item,
              `)`,
            );
            client.pushArray(arrayName, item);
          });
          return items.length;
        };
      }
      const value = Reflect.get(snapshot, prop, receiver);

      if (typeof value === 'function') {
        return value.bind(snapshot);
      }
      return value;
    },

    set(_target, prop, _value) {
      console.warn(
        `[ArrayProxy] Index assignment (${String(prop)}) is not supported. Please use .push()`,
      );
      return true;
    },
  };

  return new Proxy(snapshot, handler) as unknown as T[];
}

// ==========================================
// 3. Generic/Deep Proxy (Internal)
// ==========================================

function createDeepProxy(
  client: YoinClient,
  rootName: string,
  path: string[],
) {
  let snapshotValue: any = undefined;
  try {
    const rootObj = client.map_get_all(rootName);
    if (rootObj && typeof rootObj === 'object') {
      snapshotValue = rootObj;
      for (const key of path) {
        if (snapshotValue === undefined || snapshotValue === null)
          break;
        snapshotValue = snapshotValue[key];
      }
    }
  } catch {
    /* ignore */
  }

  if (
    snapshotValue !== undefined &&
    snapshotValue !== null &&
    typeof snapshotValue !== 'object'
  ) {
    return snapshotValue;
  }

  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'toString' || prop === 'valueOf') {
        return () =>
          snapshotValue !== undefined ? String(snapshotValue) : '';
      }
      if (prop === Symbol.toPrimitive) {
        return () =>
          snapshotValue !== undefined ? snapshotValue : '';
      }

      return createDeepProxy(client, rootName, [
        ...path,
        String(prop),
      ]);
    },
    set(_target, prop, value) {
      const fullPath = [...path, String(prop)];
      console.log(
        `[DeepProxy] Set: ${rootName}.${fullPath.join('.')} =`,
        value,
      );
      client.setMapDeep(rootName, fullPath, value);
      return true;
    },
  };

  return new Proxy({}, handler);
}
