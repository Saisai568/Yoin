// client/src/yoin/types.ts

export interface YoinConfig {
    url: string;
    dbName: string;
    docId: string;
    awarenessThrottleMs?: number; 
}

export interface AwarenessState {
    clientId: string;
    name: string;
    color: string;
    cursorX?: number | null;
    cursorY?: number | null;
    selection?: string | null; 
    offline?: boolean;
    timestamp: number;
}

export type NetworkStatus = 'connecting' | 'online' | 'offline';