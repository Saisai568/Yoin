// packages/client/src/types.ts
import { z } from 'zod';
import type { NetworkProviderOptions } from './network';

export interface TextDeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
  attributes?: Record<string, any>;
}

export interface YoinConnectParams {
  url: string;
  protocols?: string[];
}

export interface YoinConfig<TAwareness = Record<string, any>> {
  url: string;
  dbName?: string;
  docId: string;
  mode?: 'mesh' | 'server';
  autoConnect?: boolean;
  getConnectParams?: () => Promise<YoinConnectParams>;
  awarenessThrottleMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  schemas?: Record<string, z.ZodTypeAny>;
  networkOptions?: NetworkProviderOptions;
  onError?: (error: Error) => void;
}

export type AwarenessState<T = Record<string, any>> = T & {
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
};

export type AwarenessPartial<T = Record<string, any>> = Partial<
  Omit<AwarenessState<T>, 'clientId' | 'timestamp'>
>;

export type CursorRenderer = (color: string, name: string) => HTMLElement;

export type AwarenessCallback<T = Record<string, any>> = (
  states: Map<string, AwarenessState<T>>,
) => void;

export type NetworkStatus = 'connecting' | 'online' | 'synced' | 'offline' | 'failed';

export interface YoinServerError {
  code: string;
  message: string;
  seq?: number;
}
