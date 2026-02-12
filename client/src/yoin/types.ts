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
    offline?: boolean;
    timestamp: number;
    // 預留未來擴充游標位置等屬性
    [key: string]: any; 
}

export type NetworkStatus = 'connecting' | 'online' | 'offline';