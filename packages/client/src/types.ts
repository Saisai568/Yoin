// packages/client/src/types.ts
import { z } from 'zod';

export interface YoinConfig {
  url: string;
  dbName?: string;
  docId: string;
  awarenessThrottleMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  schemas?: Record<string, z.ZodTypeAny>;
}

export interface AwarenessState {
  clientId: string;
  name: string;
  color: string;
  cursorX?: number | null;
  cursorY?: number | null;
  selection?: string | null;
  offline?: boolean;
  device?: 'mobile' | 'desktop';
  lastActive?: number;
  timestamp: number;
}

export type AwarenessPartial = Partial<
  Omit<AwarenessState, 'clientId' | 'timestamp'>
>;

export type CursorRenderer = (color: string, name: string) => HTMLElement;

export type AwarenessCallback = (
  states: Map<string, AwarenessState>,
) => void;

export type NetworkStatus = 'connecting' | 'online' | 'offline' | 'failed';
