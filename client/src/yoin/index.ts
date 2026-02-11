// client/src/yoin/index.ts
import initWasm from '../../../core/pkg/core'; 

// 2. 換個友善的名字匯出，隱藏 WASM 的實作細節
export const initYoin = initWasm;

// 3. 匯出其他核心類別與型別
export { YoinClient } from './YoinClient';
export type { YoinConfig, AwarenessState } from './types';