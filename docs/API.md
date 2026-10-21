[ç¹é?ä¸­æ?](API.md) | [English](API_en.md)

# Yoin API ?ƒè€ƒæ???

> ?ˆæœ¬ï¼š`@yoin/client` v0.1.2

## ?®é?

- [?å??–](#?å???
  - [`initYoin(wasmInput?)`](#inityoinwasminput)
  - [`isYoinInitialized()`](#isyoininitialized)
- [YoinClient ?¸å?é¡åˆ¥](#yoinclient-?¸å?é¡åˆ¥)
  - [å»ºæ?å­è?è¨­å?](#å»ºæ?å­è?è¨­å?)
  - [Text APIï¼ˆå??‡æœ¬?‡å??‡å?å®¹å™¨ï¼‰](#text-apiå¯Œæ??¬è?å¤šæ?å­—å®¹??
  - [Map APIï¼ˆå???CRUD ?‡å??Ÿå??¥ä??Ÿï?](#map-apiå®Œæ•´-crud-?‡å??Ÿå??¥ä???
  - [Array APIï¼ˆPush / Insert / Delete / Moveï¼‰](#array-apipush--insert--delete--move)
  - [å®¹å™¨ç´šç²¾æº–è??±è??Ÿå‘½?±æ?](#å®¹å™¨ç´šç²¾æº–è??±è??Ÿå‘½?±æ?)
  - [ä¼ºæ??¨å¿«?§é?è¼‰è??Œæ­¥?§åˆ¶](#ä¼ºæ??¨å¿«?§é?è¼‰è??Œæ­¥?§åˆ¶)
  - [Hook APIï¼ˆæ?ä»¶ç³»çµ±ä½¿?¨ï?](#hook-api?’ä»¶ç³»çµ±ä½¿ç”¨)
  - [Awareness API](#awareness-api)
  - [å­˜å??¨è?å·¥å…·?¹æ?](#å­˜å??¨è?å·¥å…·?¹æ?)
- [Proxy ?æ?è®€å¯«](#proxy-?æ?è®€å¯?
  - [`createMapProxy<T>(client, mapName)`](#createmapProxyTclient-mapname)
  - [`createArrayProxy<T>(client, arrayName)`](#createarrayproxytclient-arrayname)
- [?’ä»¶ç³»çµ±](#?’ä»¶ç³»çµ±)
  - [`YoinPlugin` ä»‹é¢](#yoinplugin-ä»‹é¢)
  - [`createDbPlugin(options)` ??IndexedDB ?ä??–](#createdbpluginoptions--indexeddb-?ä???
  - [`createUndoPlugin()` ??å¾©å?/?å?](#createundoplugin--å¾©å??å?)
  - [`createLoggerPlugin(prefix?)` ???¤éŒ¯?¥è?](#createloggerpluginprefix--?¤éŒ¯?¥è?)
  - [?ªè??’ä»¶ç¯„ä?](#?ªè??’ä»¶ç¯„ä?)
- [React Hooks (`@yoin/client/react`)](#react-hooks-yoinclientreact)
  - [`<YoinProvider>`](#yoinprovider)
  - [`useYoinClient()`](#useyoinclient)
  - [`useYoinMap<T>(mapName)`](#useyoinmaptmapname)
  - [`useYoinArray<T>(arrayName)`](#useyoinarraytarrayname)
  - [`useYoinText(textName?)`](#useyointexttextname)
  - [`useYoinAwareness()`](#useyoinawareness)
  - [`useYoinStatus()`](#useyoinstatus)
  - [`useYoinUndo()`](#useyoinundo)
- [åº•å±¤æ¨¡ç?](#åº•å±¤æ¨¡ç?)
  - [`NetworkManager`](#networkmanager)
  - [`StorageAdapter`](#storageadapter)
- [Schema é©—è?ï¼ˆZod ?´å?ï¼‰](#schema-é©—è?zod-?´å?)
- [?‹åˆ¥å®šç¾©](#?‹åˆ¥å®šç¾©)
- [?šè??”è­°](#?šè??”è­°)

---

## ?å???

?¨ä½¿?¨ä»»ä½?Yoin ?Ÿèƒ½ä¹‹å?ï¼Œå??ˆå?è¼‰å…¥ä¸¦å?å§‹å?åº•å±¤??Rust WebAssembly å¼•æ???

### `initYoin(wasmInput?)`

```typescript
function initYoin(wasmInput?: unknown): Promise<void>
```

è¼‰å…¥ä¸¦å?å§‹å? Yoin ??WASM CRDT å¼•æ??‚å…¨?Ÿåª?€?¼å«ä¸€æ¬¡ï??è??¼å«?¯å†ªç­‰ç?ï¼ˆç›´?¥å??³å·²å®Œæ???Promiseï¼‰ï??Œæ??·å?ä¸¦è??–é˜²æ­¢é?è¤‡è??¥ã€?

**?ƒæ•¸**ï¼?
- `wasmInput` *(?¸å¡«)*ï¼šè‡ªè¨‚ç? WASM æ¨¡ç?ä¾†æ?ï¼ˆ`RequestInfo | URL | Response | BufferSource | WebAssembly.Module`ï¼‰ã€‚ç??¥æ?ä½¿ç”¨å¥—ä»¶?§å»º??`core_bg.wasm`??

**ç¯„ä?**ï¼?

```typescript
import { initYoin } from '@yoin/client';

// æ¨™æ??¨æ? ???ªå?è¼‰å…¥?§å»º WASM
await initYoin();

// ?ªè? WASM è·¯å?ï¼ˆä?å¦‚å? CDN è¼‰å…¥ï¼?
await initYoin('https://cdn.example.com/core_bg.wasm');
```

### `isYoinInitialized()`

```typescript
function isYoinInitialized(): boolean
```

æª¢æŸ¥ WASM å¼•æ??¯å¦å·²å??å?å§‹å???

---

## YoinClient ?¸å?é¡åˆ¥

`YoinClient` ??Yoin ?„å¾®?¸å?ï¼ˆMicro-Kernelï¼‰ï?è² è²¬ç®¡ç? CRDT ?‡ä»¶å¯¦ä??WebSocket ç¶²è·¯?šè??Awareness ?ŸçŸ¥?€?‹ï?ä»¥å??’ä»¶?Ÿå‘½?±æ???

### å»ºæ?å­è?è¨­å?

```typescript
const client = new YoinClient(config: YoinConfig)
```

> **æ³¨æ?**ï¼šå»ºæ§?`YoinClient` ?å??ˆå?å®Œæ? `await initYoin()`ï¼Œå¦?‡æ??‹å‡º?¯èª¤??

**`YoinConfig` ä»‹é¢**ï¼?

| å±¬æ€?| ?‹åˆ¥ | å¿…å¡« | ?è¨­??| èªªæ? |
|------|------|------|--------|------|
| `url` | `string` | ??| ??| WebSocket ä¼ºæ??¨åŸºç¤ç¶²?€ï¼ˆå? `'wss://yoin-worker.example.workers.dev'` ??`'ws://localhost:8080'`ï¼?|
| `docId` | `string` | ??| ??| ?‡ä»¶/?¿é??„å”¯ä¸€è­˜åˆ¥ç¢¼ã€‚æ?çµ‚é€??ç¶²å???`${url}/${docId}` |
| `dbName` | `string` | ??| ??| IndexedDB è³‡æ?åº«å?ç¨±ï??­é? `createDbPlugin` ä½¿ç”¨ï¼?|
| `awarenessThrottleMs` | `number` | ??| `30` | Awareness å»?’­ç¯€æµé??”ï?æ¯«ç?ï¼‰ï??è¨­ ~33fps |
| `heartbeatIntervalMs` | `number` | ??| `5000` | Awareness å¿ƒè·³å»?’­?“é?ï¼ˆæ¯«ç§’ï? |
| `heartbeatTimeoutMs` | `number` | ??| `30000` | ? ç«¯å®¢æˆ¶ç«¯ç„¡?æ?è¦–ç‚º?¢ç??„é€¾æ??‚é?ï¼ˆæ¯«ç§’ï? |
| `schemas` | `Record<string, z.ZodTypeAny>` | ??| ??| Zod Schema å®šç¾©ï¼Œç”¨?¼å¯«?¥å??ªå?é©—è?ï¼ˆè©³è¦?[Schema é©—è?](#schema-é©—è?zod-?´å?)ï¼?|

---

### Text APIï¼ˆå??‡æœ¬?‡å??‡å?å®¹å™¨ï¼?

?¯æ´?¨å–®ä¸€?‡ä»¶?§å»ºç«‹å??‹å…·?æ?å­—å®¹?¨ï??è¨­å®¹å™¨?ç¨±??`'content'`ï¼‰ï?ä¸¦æ”¯?´è? Quill / Tiptap ?¸å®¹?„å??‡æœ¬?¼å?å±¬æ€§è? Delta ?ä???

#### `insertText(index, text, attributes?, textName?)`

```typescript
async insertText(
  index: number,
  text: string,
  attributes?: Record<string, any>,
  textName: string = 'content'
): Promise<void>
```

?¨æ?å®šæ?å­—å®¹?¨ç? `index` ä½ç½®?’å…¥?‡å?ï¼Œå¯?¸æ??„å¸¶å¯Œæ??¬æ ¼å¼å±¬?§ï?å¦?`{ bold: true, color: '#ff0000' }`ï¼‰ã€?

#### `deleteText(index, length, textName?)`

```typescript
async deleteText(
  index: number,
  length: number,
  textName: string = 'content'
): Promise<void>
```

å¾æ?å®šæ?å­—å®¹?¨ç? `index` ä½ç½®?‹å??ªé™¤ `length` ?‹å??ƒã€?

#### `formatText(index, length, attributes, textName?)`

```typescript
async formatText(
  index: number,
  length: number,
  attributes: Record<string, any>,
  textName: string = 'content'
): Promise<void>
```

å°æ?å®šæ?å­—å®¹??`[index, index + length)` ?€?“å…§?„æ?å­—å??¨å??‡æœ¬?¼å?å±¬æ€§ï?ä¾‹å? `{ italic: true, bold: null }`ï¼‰ã€?

#### `applyTextDelta(ops, textName?)`

```typescript
async applyTextDelta(
  ops: TextDeltaOp[],
  textName: string = 'content'
): Promise<void>
```

å°?Quill ?¸å®¹??Delta ?ä????ï¼ˆæ”¯??`insert`?`retain`?`delete` ??`attributes`ï¼‰ä»¥?®ä? CRDT äº‹å?å¥—ç”¨?³æ?å®šæ?å­—å®¹?¨ã€?

```typescript
await client.applyTextDelta(
  [
    { insert: 'Hello ', attributes: { bold: true } },
    { insert: 'World\n' },
  ],
  'article'
);
```

#### `clearText(textName?)`

```typescript
async clearText(textName: string = 'content'): Promise<void>
```

æ¸…ç©º?‡å??‡å?å®¹å™¨?„æ??‰æ?å­—å…§å®¹ã€?

#### `getText(textName?)`

```typescript
getText(textName: string = 'content'): string
```

?–å??‡å??‡å?å®¹å™¨?®å??„ç??‡å?å­—ä¸²??

#### `getTextDelta(textName?)`

```typescript
getTextDelta(textName: string = 'content'): TextDeltaOp[]
```

?–å??‡å??‡å?å®¹å™¨?®å??„å??‡æœ¬ Delta ???ï¼ˆæ ¼å¼ç‚º `Array<{ insert: string, attributes?: Record<string, any> }>`ï¼‰ã€?

---

### Map APIï¼ˆå???CRUD ?‡å??Ÿå??¥ä??Ÿï?

?ä??·å???CRDT Mapï¼ˆéµ?¼å?çµæ?ï¼‰ã€‚å?å±¤é€é? Rust `yrs::Any` ?Ÿç??²å??€?‰åŸºç¤å??¥è?å·¢ç?çµæ?ï¼?*ä¸æ??¼ç? `"123"` è½‰æ•¸å­—æ? `"true"` è½‰å??—ç??‹åˆ¥å¤±ç?**??

#### `setMap(mapName, key, value)`

```typescript
async setMap(mapName: string, key: string, value: any): Promise<void>
```

?¨å???`mapName` ??Map ä¸­è¨­å®?`key` ?„å€¼ã€‚è‹¥è¨­å?äº†å??‰ç? Zod Schemaï¼Œæ??¨å¯«?¥å??ªå?é©—è???

```typescript
await client.setMap('settings', 'theme', 'dark');
await client.setMap('settings', 'code', '123');     // ä¿æ???string "123"
await client.setMap('settings', 'fontSize', 16);    // ä¿æ???number 16
await client.setMap('settings', 'profile', { name: 'Alice', role: 'admin' });
```

#### `deleteMap(mapName, key)` / `deleteMapKey(mapName, key)`

```typescript
async deleteMap(mapName: string, key: string): Promise<void>
async deleteMapKey(mapName: string, key: string): Promise<void>
```

å¾å???`mapName` ??Map ä¸­åˆª?¤æ?å®šç? `key`ï¼Œä¸¦?ªå??Œæ­¥?³æ??‰é€??ç«¯ã€‚`deleteMapKey` ??`deleteMap` ?„è??åˆ¥?ã€?

```typescript
await client.deleteMap('settings', 'code');
```

#### `hasMapKey(mapName, key)`

```typescript
hasMapKey(mapName: string, key: string): boolean
```

æª¢æŸ¥?ç‚º `mapName` ??Map ä¸­æ˜¯?¦å??¨æ?å®šç? `key`??

#### `getMap(mapName)`

```typescript
getMap(mapName: string): Record<string, any>
```

?–å??ç‚º `mapName` ??Map ä¸­æ??‰éµ?¼å?ï¼Œå??³å???JavaScript ?©ä»¶??

#### `setNested(mapName, key, obj)` (Y-02)

``typescript
async setNested(mapName: string, key: string, obj: Record<string, any>): Promise<void>
``

¦b®Ú Map ¤U¥H**³æ¤@­ì¤l Transaction** «Ø¥ß¥]§t¦h­ÓÄİ©Êªº±_ª¬ `YMap`¡C±M¬° YoinSpace ¥ÕªO¹Ï§Î¥´³y¡A¤ä´©**Äİ©Ê¯ÅµL½Ä¬ğ¦X¨Ö**¡]¨Ò¦pºİ A ²¾°Ê®y¼Ğ `x`¡Aºİ B ­×§ïÃC¦â `fill`¡AÂùºİ¦¬ÀÄ«á¨âªÌ­×§ï¬Ò«O¯d¡^¡C

#### `updateNested(mapName, key, partial)` (Y-02)

``typescript
async updateNested(mapName: string, key: string, partial: Record<string, any>): Promise<void>
``

³¡¤À§ó·s±_ª¬ `YMap` ¤¤ªº«ü©wÄæ¦ì¡A¥u­×§ï´£¨ÑªºÄİ©Ê¡A¤£·|ÂĞ»\¹Ï§Î¤¤¥¼­×§ïªº¨ä¾lÄİ©Ê¡C

#### `setMapDeep(mapName, path, value)`

```typescript
setMapDeep(mapName: string, path: string[], value: any): void
```

?¨å·¢?€ Map çµæ?ä¸­ï?æ²¿è? `path` è·¯å?æ·±å…¥è¨­å?ä»»æ? JS ?‹åˆ¥??`value`ï¼ˆæ”¯?´æ•¸å­—ã€å?ä¸²ã€å??—ã€ç‰©ä»¶ã€é™£?—è? `null`ï¼‰ã€‚è·¯å¾‘ä?ä¸å??¨ç?ä¸­é?å±?`MapPrelim` ?ƒè‡ª?•å»ºç«‹ã€?

```typescript
// ç­‰å??¼è¨­å®?canvas.node_1.position.x = 150
client.setMapDeep('canvas', ['node_1', 'position', 'x'], 150);
// äº¦æ”¯?´å?ä¸²æ??©ä»¶
client.setMapDeep('canvas', ['node_1', 'label'], 'Hero Card');
```

#### `batchSet(entries)`

```typescript
batchSet(entries: Array<[string, string, any]>): void
```

??*?®ä? CRDT äº‹å?**ä¸­æ‰¹æ¬¡å¯«?¥å?ç­?Map è³‡æ?ï¼Œåª?¢ç?ä¸€æ¬?diff ?‡ä?æ¬¡ç¶²è·¯å»£?­ã€‚è‹¥è¨­å?äº?Zod Schemaï¼Œæ??¨å¯«?¥å?å°æ??‰é??®åŸ·è¡Œé?è­‰ã€?

```typescript
client.batchSet([
  ['node-1', 'x', 100],
  ['node-1', 'y', 200],
  ['node-2', 'x', 300],
  ['node-2', 'y', 400],
]);
```

---

### Array APIï¼ˆPush / Insert / Delete / Moveï¼?

?ä??·å???CRDT Arrayï¼ˆæ?åºå?è¡¨ç?æ§‹ï???

#### `pushArray(arrayName, item)`

```typescript
async pushArray(arrayName: string, item: any): Promise<void>
```

å°?`item` ?¨å…¥?ç‚º `arrayName` ??Array å°¾ç«¯ï¼ˆæ”¯?´ä»»?å???JS ?‹åˆ¥?‡ç‰©ä»¶ï??‚è‹¥è¨­å?äº†å??‰ç? Zod Schemaï¼Œæ??¨å¯«?¥å??ªå?é©—è???

#### `insertArray(arrayName, index, item)`

```typescript
async insertArray(arrayName: string, index: number, item: any): Promise<void>
```

?¨å???`arrayName` ??Array ?„æ?å®?`index` ä½ç½®?’å…¥ `item`?‚è‹¥è¨­å?äº†å??‰ç? Zod Schemaï¼Œæ??¨å¯«?¥å??ªå?é©—è???

#### `deleteArray(arrayName, index, length?)`

```typescript
async deleteArray(arrayName: string, index: number, length: number = 1): Promise<void>
```

å¾å???`arrayName` ??Array ??`index` ä½ç½®?‹å??ªé™¤ `length` ?‹å?ç´ ï??è¨­?ªé™¤ 1 ?‹ï???

#### `moveArray(arrayName, fromIndex, toIndex)`

```typescript
async moveArray(arrayName: string, fromIndex: number, toIndex: number): Promise<void>
```

å°‡å???`arrayName` ??Array ä¸­ä???`fromIndex` ?„å?ç´ ç§»?•è‡³ `toIndex`ï¼ˆé©?¨æ–¼?–å±¤ z-index ?’å??ç??¿å¡?‡æ??³æ?åºï???

#### `getArray(arrayName)`

```typescript
getArray(arrayName: string): any[]
```

?–å??ç‚º `arrayName` ??Array ä¸­æ??‰å?ç´ ã€?

---

### å®¹å™¨ç´šç²¾æº–è??±è??Ÿå‘½?±æ?

#### `subscribeMap(mapName, listener)`

```typescript
subscribeMap(mapName: string, listener: () => void): () => void
```

?…è??±æ?å®?`mapName` å®¹å™¨?„è??´ã€‚æœ¬?°ä¿®?¹å…¶ä»–å®¹?¨ï?ä¾‹å??“å??–ä¿®?¹å…¶ä»?Mapï¼‰æ?**ä¸æ?**è§¸ç™¼æ­¤å??¼ï??¶åˆ°? ç«¯å¢é??´æ–°?–å¿«?§æ??ƒè‡ª?•è§¸?¼ã€‚è??±æ??ƒç??³è§¸?¼ä?æ¬¡å?å§‹å‘¼?«ï?ä¸¦å??³å?æ¶ˆè??±å‡½å¼ã€?

#### `subscribeArray(arrayName, listener)`

```typescript
subscribeArray(arrayName: string, listener: () => void): () => void
```

?…è??±æ?å®?`arrayName` å®¹å™¨?„è??´ã€‚è??±æ??ƒç??³è§¸?¼ä?æ¬¡å?å§‹å‘¼?«ï?ä¸¦å??³å?æ¶ˆè??±å‡½å¼ã€?

#### `subscribeText(textName, listener)`

```typescript
subscribeText(textName: string, listener: (text: string) => void): () => void
```

?…è??±æ?å®?`textName` ?‡å?å®¹å™¨?„è??´ï??å‘¼?ƒæ•¸?ºè©²å®¹å™¨?®å??„ç??‡å?å­—ä¸²?‚è??±æ??ƒç??³è§¸?¼ä?æ¬¡å?å§‹å‘¼?«ï?ä¸¦å??³å?æ¶ˆè??±å‡½å¼ã€?

#### `subscribe(listener)`

```typescript
subscribe(listener: (text: string) => void): () => void
```

?¨å?è¨‚é–±?‡ä»¶è®Šæ›´ï¼ˆä»»ä½•æœ¬?°æ?? ç«¯è®Šæ›´?†æ?è§¸ç™¼ï¼‰ã€‚è??±æ??ƒç??³ä»¥?®å? `getText()` ?„å€¼è§¸?¼ä?æ¬¡ã€?

#### `subscribeNetwork(cb)`

```typescript
subscribeNetwork(cb: (status: NetworkStatus) => void): () => void
```

è¨‚é–±ç¶²è·¯????€?‹è??´ï?`'connecting' | 'online' | 'offline' | 'failed'`ï¼‰ã€‚æ”¯?´è¨»?Šå??‹ç›£?½å™¨ï¼Œè??±æ?ç«‹å³ä»¥ç›®?ç??‹è§¸?¼ä?æ¬¡ï?ä¸¦å??³å?æ¶ˆè??±å‡½å¼ã€?

#### `use(plugin)`

```typescript
use(plugin: YoinPlugin): this
```

?›è?ä¸€?‹æ?ä»¶åˆ°å®¢æˆ¶ç«¯ã€‚æ”¯?´é?å¼å‘¼?«ï?ä¸”å?ä¸€?‹æ?ä»¶å¯¦ä¾‹ä??ƒè¢«?è?å®‰è???

#### `destroy()`

```typescript
destroy(): void
```

?·æ?å®¢æˆ¶ç«¯å¯¦ä¾‹ï??‹æ”¾?€?‰è?æºï?
1. æ¸…é™¤å¿ƒè·³?‡å??¾å??¶è??‚å™¨
2. ?¼å«?€?‰å·²å®‰è??’ä»¶??`onDestroy()`ï¼ˆå??«é???IndexedDB ???ï¼?
3. ?¼é€é›¢ç·?Awareness å»?’­ä¸¦é???WebSocket ???
4. æ¸…é™¤?€?‰è??±è€…è?ä½‡å?
5. ?¼å« `this.doc.free?.()` ?‹æ”¾åº•å±¤ Rust WASM ç·šæ€§è??¶é?

---

### ä¼ºæ??¨å¿«?§é?è¼‰è??Œæ­¥?§åˆ¶

#### `exportSnapshot()`

```typescript
exportSnapshot(): Uint8Array
```

å°‡ç›®?æ•´??CRDT ?‡ä»¶?€?‹åŒ¯?ºç‚ºå®Œæ•´?„ä??²ä?å¿«ç…§ï¼ˆç??Œæ–¼å°ç©º State Vector è¨ˆç?å®Œæ•´ diffï¼‰ï??¯ç›´?¥å„²å­˜è‡³å¾Œç«¯è³‡æ?åº«ï?å¦?PostgreSQL `bytea` ??S3ï¼‰ã€?

#### `applySnapshot(snapshot)`

```typescript
applySnapshot(snapshot: Uint8Array): void
```

å°‡å??¨ï?ä¾‹å?ä¼ºæ???REST API ?è??–æœ¬?°å?ä»½ï??„ä??²ä?å¿«ç…§å¥—ç”¨?³ç•¶??CRDT ?‡ä»¶ï¼Œä¸¦?šçŸ¥?€?‰å®¹?¨è??¨å?è¨‚é–±?…ã€?

#### `syncWithPeers()`

```typescript
syncWithPeers(): void
```

ä¸»å??‘æˆ¿?“å…§?€?‰å·²????Œå??¼é€?`MSG_SYNC_STEP_1`ï¼ˆState Vectorï¼‰è?æ±‚å·®?°å?æ­¥ï?ä¾‹å???IndexedDB ?å?æ­¥è??¥å??å??ªå??¼å«ï¼‰ã€?

---

### Hook APIï¼ˆæ?ä»¶ç³»çµ±ä½¿?¨ï?

#### `onDocUpdate(cb)`

```typescript
onDocUpdate(cb: (update: Uint8Array) => void): () => void
```

è¨»å?ä¸€?‹åœ¨**ä»»ä??´æ–°**ï¼ˆæœ¬?°æ?ä½œæ?? ç«¯?Œæ­¥ï¼‰ç™¼?Ÿå??½æ?è¢«å‘¼?«ç??å‘¼?‚å??³å?æ¶ˆè¨»?Šå‡½å¼ã€?

#### `onLocalUpdate(cb)`

```typescript
onLocalUpdate(cb: (update: Uint8Array) => void): () => void
```

è¨»å?ä¸€??*?…åœ¨?¬åœ°?ä?**?¢ç? diff ?‚è¢«?¼å«?„å??¼ã€‚å??³å?æ¶ˆè¨»?Šå‡½å¼ã€?

---

### Awareness API

Awareness ?¨æ–¼?³é?**?«æ?ï¼ˆEphemeralï¼‰ç?ä½¿ç”¨?…å??¨è?è¨?*ï¼ˆæ¸¸æ¨™ä?ç½®ã€é¸?–ç??ã€å?ç¨±ã€é??²ç?ï¼‰ï?ä¸ç???CRDT æ­·å²è¨˜é?ï¼Œä??¨é›¢ç·šæ?æ¨™è???`{ transient: true }` ä¸æ?å¡å…¥?¢ç??é€ä??—ã€?

#### `setAwareness(state)`

```typescript
setAwareness(state: AwarenessPartial): void
```

?´æ–°?¬åœ°ç«¯ç? Awareness ?€?‹ä¸¦å»?’­çµ¦å…¶ä»–é€??ç«¯ï??§å»ºç¯€æµæ??¶ï??è¨­ 30msï¼‰ã€?

#### `onAwarenessChange(cb)`

```typescript
onAwarenessChange(cb: AwarenessCallback): () => void
```

è¨‚é–±?€?‰é€??ç«¯ç? Awareness ?€?‹è??´ã€‚å??³å?æ¶ˆè??±å‡½å¼ã€?

#### `getAwarenessStates()`

```typescript
getAwarenessStates(): Map<string, AwarenessState>
```

?–å??®å??€?‰é€??ç«¯ï??…å«?ªå·±ï¼‰ç? Awareness ?€??Mapï¼Œkey ??`clientId`??

#### `leaveAwareness()`

```typescript
leaveAwareness(): void
```

ä¸»å??šçŸ¥?¶ä????ç«¯æœ¬å®¢æˆ¶ç«¯å·²?¢é???

#### `bindCursorTracking(container, renderer)`

```typescript
bindCursorTracking(container: HTMLElement, renderer: CursorRenderer): () => void
```

?ªå??¨æ?å®šç? HTML å®¹å™¨ä¸Šç?å®šæ?é¼ ç§»?•ä?ä»¶ï?ä¸¦è‡ª?•æ¸²?“æ??‰é?ç«¯ä½¿?¨è€…ç?æ¸¸æ? DOM ?ƒç??‚å??³æ??†å‡½å¼ã€?

---

### å­˜å??¨è?å·¥å…·?¹æ?

| ?¹æ? | ?å‚³?‹åˆ¥ | èªªæ? |
|------|----------|------|
| `getDoc()` | `YoinDoc` | ?–å?åº•å±¤??WASM `YoinDoc` å¯¦ä?ï¼ˆä??²é??ä??–æ?ä»¶ä½¿?¨ï? |
| `getConfig()` | `YoinConfig` | ?–å?å»ºæ??‚å‚³?¥ç?è¨­å??©ä»¶ |
| `getClientId()` | `string` | ?–å??¬å®¢?¶ç«¯?„éš¨æ©?8 ç¢¼è??¥ç¢¼ |

---

## Proxy ?æ?è®€å¯?

Proxy æ¨¡ç?è®“ä??¨å???JavaScript ?„å±¬?§è³¦?¼è?????¹æ??´æ¥?ä? CRDTï¼Œç„¡?€?‹å??¼å« `setMap` / `deleteMap` / `pushArray`??

### `createMapProxy<T>(client, mapName)`

```typescript
function createMapProxy<T extends Record<string, any>>(
  client: YoinClient,
  mapName: string
): T
```

å»ºç?ä¸€?‹ç?å®šåˆ°?‡å? CRDT Map ?„é€æ? Proxy ?©ä»¶ï¼?
- **è®€??(`proxy.key`)**ï¼šå³?‚å? `client.getMap(mapName)` ?–å€¼ï??¥éµä¸å??¨å???`undefined`?‚è‹¥?¼ç‚ºå·¢ç??©ä»¶ï¼Œå??³æ”¯?´æ·±å±¤è?å¯«ç? Proxy??
- **å¯«å…¥ (`proxy.key = val` / `proxy.a.b = val`)**ï¼šé?å±¤è‡ª?•å‘¼??`client.setMap`ï¼Œæ·±å±¤è‡ª?•å‘¼??`client.setMapDeep`??
- **?ªé™¤ (`delete proxy.key`)**ï¼šè‡ª?•å‘¼??`client.deleteMap(mapName, key)`??
- **?µæª¢?¥è??—è? (`'key' in proxy` / `Object.keys(proxy)`)**ï¼šç›´?¥å???CRDT Map ?®å??„æ??‰éµ??

```typescript
import { createMapProxy } from '@yoin/client';

interface BoardState {
  title: string;
  zoom: number;
  viewport?: { x: number; y: number };
}

const board = createMapProxy<BoardState>(client, 'board');

board.title = 'å°ˆæ??½æ¿';
board.zoom = 1.5;
board.viewport = { x: 0, y: 0 };
board.viewport.x = 120;         // æ·±å±¤å¯«å…¥ ???ªå??¼å« setMapDeep
delete (board as any).zoom;     // ?ªé™¤?????ªå??¼å« deleteMap
```

### `createArrayProxy<T>(client, arrayName)`

```typescript
function createArrayProxy<T>(
  client: YoinClient,
  arrayName: string
): T[]
```

å»ºç?ä¸€?‹ç?å®šåˆ°?‡å? CRDT Array ?„é€æ? Proxy ???ï¼Œæ?æ¬¡è??–ï?å¦?`arr[0]`?`arr.length`?`arr.map(...)`ï¼‰ç??³æ?å¾?`client.getArray(arrayName)` ?–å??€?°ç??‹ï?ä¸¦æ”¯?´ä»¥ä¸‹è??°æ–¹æ³•ï?
- **`.push(...items)`** ???¼å« `client.pushArray`
- **`.splice(start, deleteCount?, ...items)`** ??çµ„å??¼å« `client.deleteArray` ??`client.insertArray`
- **`.pop()`** ???ªé™¤ä¸¦å??³æ?å¾Œä??‹å?ç´?
- **`.shift()`** ???ªé™¤ä¸¦å??³ç¬¬ä¸€?‹å?ç´?
- **`.unshift(...items)`** ???¨é??­ä?åºæ??¥å?ç´?

```typescript
import { createArrayProxy } from '@yoin/client';

const todos = createArrayProxy<{ text: string; done: boolean }>(client, 'todos');

todos.push({ text: 'å®Œæ? API ?‡ä»¶', done: false });
todos.splice(0, 1, { text: 'å®Œæ? v0.1.2 ?‡ç?', done: true });
```

---

## ?’ä»¶ç³»çµ±

Yoin ?¡ç”¨å¾®æ ¸å¿ƒæ¶æ§‹ï?å°‡é??¸å??Ÿèƒ½ï¼ˆæ?ä¹…å??å¾©???å??æ—¥èªŒç?ï¼‰è§£?¦ç‚º?¨ç??’ä»¶??

### `YoinPlugin` ä»‹é¢

```typescript
interface YoinPlugin {
  readonly name: string;
  onInstall(client: YoinClient): void;
  onBeforeUpdate?(update: Uint8Array): void;
  onAfterUpdate?(update: Uint8Array): void;
  onDestroy?(): void;
}
```

### `createDbPlugin(options)` ??IndexedDB ?ä???

```typescript
function createDbPlugin(options: YoinDbPluginOptions): {
  plugin: YoinDbPlugin;
  forceSave: () => Promise<void>;
}
```

?ªå?å°?CRDT ?‡ä»¶å¿«ç…§?ä??–åˆ°?è¦½?¨ç? IndexedDBï¼ˆå…§å»?`IDBDatabase` ???å¿«å?ï¼‰ï?
1. **å®‰è???*ï¼šè‡ª?•å? IndexedDB è¼‰å…¥æ­·å²å¿«ç…§ä¸¦å?ä½µåˆ°?¶å??‡ä»¶ï¼›è‹¥æ­¤æ?ç¶²è·¯å·²é€??ï¼Œæ??ªå??¼å« `client.syncWithPeers()` ?‡é?ç«¯å??•äº¤?›å·®?°ã€?
2. **?´æ–°??*ï¼šæ?æ¬¡æ?ä»¶è??´ï??¬åœ°?–é?ç«¯ï?å¾Œï?ä»¥é˜²?–ï?Debounceï¼Œé?è¨?`1000ms`ï¼‰æ–¹å¼è‡ª?•æ?ç¨‹å?æª”ã€?
3. **?·æ???*ï¼šè‡ª?•å?æ¶ˆè??‚å™¨ä¸¦é???IndexedDB ?????

### `createUndoPlugin()` ??å¾©å?/?å?

```typescript
function createUndoPlugin(): {
  plugin: YoinUndoPlugin;
  undo: () => void;
  redo: () => void;
}
```

?ºæ–¼ Yrs ?§å»º??`UndoManager`ï¼Œæ?ä¾›æœ¬?°æ?ä½œç?å¾©å?ï¼ˆUndoï¼‰è??å?ï¼ˆRedoï¼‰å??½ï?
- å®‰è??‚è‡ª?•å??¨é?è¨?`'content'` Text ?„è¿½è¹¤ã€?
- ?¶ä½¿?¨è€…é€é? `setMap`?`deleteMap`?`setMapDeep`?`batchSet`?`pushArray`?`insertArray`?`deleteArray`?`moveArray` ?–è‡ªè¨?`textName` ?„æ?å­—æ–¹æ³•æ?ä½œå®¹?¨æ?ï¼?*?ªå?å°‡è©²å®¹å™¨? å…¥ Undo è¿½è¹¤ç¯„å?**ï¼ˆé€é?åº•å±¤ `expand_undo_scope_for`ï¼‰ã€?
- ?ªæ?å¾©å?**?¬åœ°ç«?*?„æ?ä½œï?ä¸æ?å¾©å??¶ä??”ä??…ç?è®Šæ›´??

### `createLoggerPlugin(prefix?)` ???¤éŒ¯?¥è?

```typescript
function createLoggerPlugin(prefix?: string): YoinPlugin
```

### ?ªè??’ä»¶ç¯„ä?

```typescript
import type { YoinPlugin } from '@yoin/client';

const analyticsPlugin: YoinPlugin = {
  name: 'analytics-plugin',
  onInstall(client) {
    console.log(`Analytics mounted for doc: ${client.getConfig().docId}`);
  },
  onAfterUpdate(update) {
    navigator.sendBeacon('/api/metrics', JSON.stringify({ bytes: update.byteLength }));
  },
};
```

---

## React Hooks (`@yoin/client/react`)

å¾?`@yoin/client/react` ?¯å…¥?‚æ??‰ç??‹å? Hooks ?†åŸº??React 18 ??`useSyncExternalStore` å¯¦ä?ï¼Œä¸¦?¡ç”¨å®¹å™¨ç´šè??±ä»¥ç¢ºä??€ä½³æ¸²?“æ??½ã€?

### `<YoinProvider>`

```tsx
function YoinProvider(props: {
  config: YoinConfig;
  children: ReactNode;
  fallback?: ReactNode;
}): JSX.Element
```

### `useYoinClient()`

```typescript
function useYoinClient(): YoinClient
```

### `useYoinMap<T>(mapName)`

```typescript
function useYoinMap<T extends Record<string, any>>(mapName: string): T
```

?å‚³ä¸€?‹ç?å®šåˆ°?‡å? CRDT Map ??*?¿æ?å¼?Proxy ?©ä»¶**?‚å?å±¤ä½¿??`client.subscribeMap(mapName, ...)`ï¼Œå??¨è©² Map è®Šæ›´?‚è§¸?¼å?ä»¶é??°æ¸²?“ï?ä¸¦è‡ª?•æ›´??Proxy ?ƒè€ƒä»¥ç¢ºä? React å­å?ä»¶èƒ½æ­?¢º?µæ¸¬ props è®Šæ›´??

### `useYoinArray<T>(arrayName)`

```typescript
function useYoinArray<T = any>(arrayName: string): T[]
```

?å‚³ä¸€?‹ç?å®šåˆ°?‡å? CRDT Array ??*?¿æ?å¼?Proxy ???**?‚å?å±¤ä½¿??`client.subscribeArray(arrayName, ...)`ï¼Œæ”¯??`.push()`?`.splice()`?`.pop()`?`.shift()`?`.unshift()` ?‡ç´¢å¼•è??–ã€?

### `useYoinText(textName?)`

```typescript
function useYoinText(textName: string = 'content'): {
  text: string;
  delta: TextDeltaOp[];
  insert: (index: number, content: string, attributes?: Record<string, any>) => Promise<void>;
  deleteText: (index: number, length: number) => Promise<void>;
  format: (index: number, length: number, attributes: Record<string, any>) => Promise<void>;
  applyDelta: (ops: TextDeltaOp[]) => Promise<void>;
  clear: () => Promise<void>;
}
```

è¨‚é–±ä¸¦æ?ä½œæ?å®šç??·å? CRDT ?‡å?å®¹å™¨ï¼ˆé?è¨­ç‚º `'content'`ï¼‰ï??ä?ç´”æ?å­?`text`?å??‡æœ¬ `delta` ä»¥å?å®Œæ•´?„ç·¨è¼¯æ–¹æ³•ã€?

### `useYoinAwareness()`

```typescript
function useYoinAwareness(): {
  states: Map<string, AwarenessState>;
  setLocalState: (state: AwarenessPartial) => void;
}
```

### `useYoinStatus()`

```typescript
function useYoinStatus(): NetworkStatus
```

?–å??®å???WebSocket ç¶²è·¯????€?‹ï?`'connecting' | 'online' | 'offline' | 'failed'`ï¼‰ã€‚å?å±¤ä½¿??`client.subscribeNetwork`ï¼Œå¯å®‰å…¨?¨å??‹å?ä»¶ä¸­?Œæ?ä½¿ç”¨??

### `useYoinUndo()`

```typescript
function useYoinUndo(): {
  undo: () => void;
  redo: () => void;
}
```

---

## åº•å±¤æ¨¡ç?

### `NetworkManager`

```typescript
class NetworkManager {
  constructor(url: string, docId: string, onMessageCallback: (data: Uint8Array) => void);
  onStatusChange?: (status: NetworkStatus) => void;
  connect(): void;
  broadcast(data: Uint8Array, options?: BroadcastOptions): void;
  getQueueLength(): number;
  clearQueue(): void;
  disconnect(): void;
}
```

- **?‡æ•¸?€?¿é???*ï¼šæ–·ç·šå??ªå??é€??å»¶é²å¾?`1000ms` ?‹å??å?ï¼Œä???`30000ms`ï¼Œæ?å¤šé?è©?`50` æ¬¡ï?è¶…é?ä¸Šé??‚ç™¼??`'failed'` ?€?‹ã€?
- **?«æ?è¨Šæ¯?æ¿¾ (`BroadcastOptions.transient`)**ï¼šç•¶ `options.transient === true` ?‚ï?å¦?Awareness?å?è·³ã€ä??‘äº¤?¡å??…ï?ï¼Œé›¢ç·šæ??“æ??´æ¥ä¸Ÿæ??Œä??²å…¥ `messageQueue`ï¼Œç¢ºä¿é?????ªé??ç?æ­?? CRDT è³‡æ?è®Šæ›´??

### `StorageAdapter`

```typescript
class StorageAdapter {
  constructor(dbName: string);
  saveSnapshot(docId: string, snapshotBytes: Uint8Array): Promise<void>;
  loadSnapshot(docId: string): Promise<Uint8Array | null>;
  close(): void;
}
```

å°è??è¦½??IndexedDBï¼ˆObject Store ?ç¨±??`'snapshots'`ï¼‰ï??§å»º `IDBDatabase` ???å¯¦ä?å¿«å?ï¼Œé¿?é??»å?æª”æ??è??‹å?è³‡æ?åº«é€????

---

## Schema é©—è?ï¼ˆZod ?´å?ï¼?

Yoin ?¯æ´?é? [Zod](https://zod.dev/) ?¨å¯«??CRDT ?é?è­‰è??™ç?æ§‹ã€‚åªè¦åœ¨ `YoinConfig.schemas` ä¸­å?ç¾©å???Map ??Array ?ç¨±??Schemaï¼Œ`setMap`?`batchSet`?`pushArray`?`insertArray` ?½æ??¨å¯«?¥å??ªå??·è?é©—è???

---

## ?‹åˆ¥å®šç¾©

### `TextDeltaOp`

```typescript
interface TextDeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
  attributes?: Record<string, any>;
}
```

### `BroadcastOptions`

```typescript
interface BroadcastOptions {
  transient?: boolean;
}
```

### `NetworkStatus`

```typescript
type NetworkStatus = 'connecting' | 'online' | 'offline' | 'synced' | 'failed';
```

### `YoinConfig` / `AwarenessState` / `AwarenessPartial` / `YoinPlugin`

ï¼ˆå??´å?ç¾©è?è¦‹ä??¹å?ç« ç?ï¼?

---

## ?šè??”è­°

Yoin ä½¿ç”¨ 1-byte Header ?„ä??²ä??”è­°?²è? WebSocket ?šè?ï¼?

| é¡å? | å¸¸æ•¸?ç¨± | ??| ?¹å? | èªªæ? |
|------|----------|----|------|------|
| Sync Step 1 | `MSG_SYNC_STEP_1` | `0` | Client ??Server ??Client | ?¼é€?State Vector è«‹æ??Œæ­¥ |
| Sync Step 2 | `MSG_SYNC_STEP_2` | `1` | ?™å? | ?³é€é?ç©ºç? CRDT Update / Diff |
| Sync Step 1 Reply | `MSG_SYNC_STEP_1_REPLY` | `2` | Client ??Server ??Client | ?æ??ªå·±??State Vector |
| Awareness | `MSG_AWARENESS` | `3` | ?™å? | ?ŸçŸ¥?€?‹å»£?­ï?JSON over binaryï¼Œæ?è¨˜ç‚º `transient`ï¼?|
| Join Room | `MSG_JOIN_ROOM` | `4` | Client ??Server | ? å…¥?¿é??šçŸ¥ï¼ˆæ?è¨˜ç‚º `transient`ï¼?|
