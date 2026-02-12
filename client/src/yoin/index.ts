// client/src/yoin/index.ts
import initWasm, { YoinDoc, init_panic_hook } from '../../../core/pkg-web/core'; 

export const initYoin = initWasm;
export const initPanicHook = init_panic_hook; 

export { YoinClient } from './YoinClient';
export type { YoinConfig, AwarenessState } from './types';
export { YoinDoc };