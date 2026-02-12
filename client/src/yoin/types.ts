// client/src/yoin/types.ts
// ============================================================
// Layer 1: Interface — 定義 Yoin 2.0 感知系統的資料契約
// ============================================================

/**
 * YoinClient 初始化設定
 */
export interface YoinConfig {
    url: string;
    dbName: string;
    docId: string;
    /** Awareness 網路廣播的節流間隔 (ms)，預設 30 */
    awarenessThrottleMs?: number;
    /** Heartbeat 廣播間隔 (ms)，預設 5000 */
    heartbeatIntervalMs?: number;
    /** 判定離線的超時門檻 (ms)，預設 30000 */
    heartbeatTimeoutMs?: number;
}

/**
 * 感知狀態：每個在線使用者的即時資訊
 * - clientId / timestamp 由系統自動填入，外部不需手動設定
 * - cursorX / cursorY 為 null 表示滑鼠離開畫面
 */
export interface AwarenessState {
    /** 系統自動產生的唯一識別碼 */
    clientId: string;
    /** 使用者顯示名稱 */
    name: string;
    /** 使用者代表色 (hex) */
    color: string;
    /** 游標 X 座標，null = 滑鼠離開視窗 */
    cursorX?: number | null;
    /** 游標 Y 座標，null = 滑鼠離開視窗 */
    cursorY?: number | null;
    /** 目前選取的物件 ID (白板協作用) */
    selection?: string | null;
    /** 離線旗標，僅在 leaveAwareness 時使用 */
    offline?: boolean;
    /** 最後更新時間戳 (ms)，用於 Heartbeat 判活 */
    timestamp: number;
}

/**
 * setAwareness() 接受的部分更新型別
 * clientId / timestamp 由系統自動填入，外部不需傳入
 */
export type AwarenessPartial = Partial<Omit<AwarenessState, 'clientId' | 'timestamp'>>;

/**
 * 游標渲染器的函式簽章
 */
export type CursorRenderer = (color: string, name: string) => HTMLElement;

/**
 * Awareness 變更回呼的函式簽章
 */
export type AwarenessCallback = (states: Map<string, AwarenessState>) => void;

export type NetworkStatus = 'connecting' | 'online' | 'offline';