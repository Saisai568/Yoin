// packages/client/src/plugin.ts
import type { YoinClient } from './YoinClient';

export interface YoinPlugin {
  readonly name: string;

  /**
   * Called when plugin is registered with client.use().
   * If onInstall throws or rejects, the plugin is automatically rolled back (YOIN-006).
   */
  onInstall(client: YoinClient): void | Promise<void>;

  onBeforeUpdate?(update: Uint8Array): void;

  onAfterUpdate?(update: Uint8Array): void;

  /**
   * Called during client.destroy() or rollback. Can be async.
   */
  onDestroy?(): void | Promise<void>;
}
