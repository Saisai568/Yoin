// client/src/yoin/types.ts
// ============================================================
// Layer 1: Interface — Define the data contract for the Yoin perception system
// ============================================================
import { z } from 'zod';
/**
 * YoinClient initialization configuration
 */
export interface YoinConfig {
    url: string;
    /** IndexedDB database name (moved to DbPlugin, kept for backward compatibility) */
    dbName?: string;
    docId: string;
    /** Throttle interval for Awareness network broadcasting (ms), default 30 */
    awarenessThrottleMs?: number;
    /** Heartbeat broadcast interval (ms), default 5000 */
    heartbeatIntervalMs?: number;
    /** Timeout threshold for offline detection (ms), default 30000 */
    heartbeatTimeoutMs?: number;
    /** Schema definitions: Map name -> Zod Schema */
    schemas?: Record<string, z.ZodTypeAny>;
}

/**
 * Perception status: real-time information for each online user
 * - clientId / timestamp are automatically filled in by the system, no manual setting needed externally
 * - cursorX / cursorY being null indicates the mouse has left the screen
 */
export interface AwarenessState {
    /** System-generated unique identifier */
    clientId: string;
    /** User Display Name */
    name: string;
    /** 使用者代表色 (hex) */
    color: string;
    /** Cursor X coordinate, null = mouse leaves the window */
    cursorX?: number | null;
    /** Cursor Y coordinate, null = mouse leaves the window */
    cursorY?: number | null;
    /** Currently selected object ID (for whiteboard collaboration) */
    selection?: string | null;
    /** Offline flag, used only during leaveAwareness */
    offline?: boolean;
    /** Device Type */
    device?: 'mobile' | 'desktop';
    /** Last activity time (ms), used to determine ghost cursors */
    lastActive?: number;
    /** Timestamp of the last update (ms), used for Heartbeat to check activity */
    timestamp: number;
}

/**
 * The partial update types accepted by setAwareness()
 * clientId / timestamp are automatically filled in by the system, no need to provide them externally
 */
export type AwarenessPartial = Partial<Omit<AwarenessState, 'clientId' | 'timestamp'>>;

/**
 * Function signature of the cursor renderer
 */
export type CursorRenderer = (color: string, name: string) => HTMLElement;

/**
 * Awareness Change the callback function signature
 */
export type AwarenessCallback = (states: Map<string, AwarenessState>) => void;

export type NetworkStatus = 'connecting' | 'online' | 'offline';