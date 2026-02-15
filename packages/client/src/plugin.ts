// packages/client/src/plugin.ts
import type { YoinClient } from './YoinClient';

export interface YoinPlugin {
  readonly name: string;

  onInstall(client: YoinClient): void;

  onBeforeUpdate?(update: Uint8Array): void;

  onAfterUpdate?(update: Uint8Array): void;

  onDestroy?(): void;
}
