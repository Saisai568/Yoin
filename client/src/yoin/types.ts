// client/src/yoin/types.ts

export interface YoinConfig {
    url: string;
    dbName: string;
    docId: string;
    awarenessThrottleMs?: number; 
}
// ==========================================舊版
// export interface AwarenessState {
//    clientId: string;
//    name: string;
//    color: string;
//    cursorX?: number | null;
//    cursorY?: number | null;
//    selection?: string | null; 
//    offline?: boolean;
//    timestamp: number;
//}
// ==========================================

export interface AwarenessState {
    clientId: number;       // 每個連線唯一的 ID
    name: string;           // 使用者名稱 (例如 "Alice")
    color: string;          // 代表色 (例如 "#FF0000")
    
    // 🖱️ 游標協作核心
    cursor?: { x: number; y: number }; 
    
    // 🎯 選取協作核心 (例如 'rect-1')
    selection?: string | null; 
    
    updatedAt: number;      //這可以用來判斷是否離線 (Heartbeat)
}
// 用來通知 UI 更新的回呼函數型別
export type AwarenessListener = (states: Map<number, AwarenessState>) => void;
export type NetworkStatus = 'connecting' | 'online' | 'offline';