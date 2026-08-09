import React from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { YoinClient, createDbPlugin, createUndoPlugin, initYoin } from '@yoin/client';
import { YoinProvider } from '@yoin/client/react';
import { App } from './App';
import './style.css';

/** WebSocket relay URL; the local Node relay makes the example runnable offline. */
const workerUrl = import.meta.env.VITE_YOIN_WORKER_URL ?? 'ws://localhost:8080';
/** Document identity shared by every tab that opens the same `?room=` value. */
const room = new URLSearchParams(window.location.search).get('room') ?? 'morning-handover';

/**
 * Initializes the WASM runtime and composes the Yoin client used by React.
 *
 * The client is intentionally created outside React so a Strict Mode re-render
 * never creates a second WebSocket connection or CRDT document. The database
 * and undo plugins are then installed before the UI mounts.
 *
 * @returns A promise that resolves once the application has been rendered.
 */
async function bootstrap() {
  await initYoin();

  // The schemas make this reference app fail fast when its shared data shape
  // is accidentally changed by a future feature.
  const client = new YoinClient({
    url: workerUrl,
    docId: room,
    awarenessThrottleMs: 50,
    schemas: {
      handover: z.object({
        teamName: z.string(),
        shift: z.string(),
        status: z.enum(['normal', 'watch', 'incident']),
        summary: z.string(),
        onCall: z.string(),
        updatedAt: z.string(),
      }),
      events: z.array(z.object({
        id: z.string(),
        kind: z.enum(['note', 'watch', 'incident', 'resolved']),
        message: z.string(),
        author: z.string(),
        createdAt: z.string(),
      })),
    },
  });

  const { plugin: dbPlugin } = createDbPlugin({ dbName: 'yoin-reference-handover' });
  const { plugin: undoPlugin, undo, redo } = createUndoPlugin();
  client.use(dbPlugin).use(undoPlugin);

  window.addEventListener('beforeunload', () => client.destroy(), { once: true });

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <YoinProvider client={client}>
        <App room={room} undo={undo} redo={redo} />
      </YoinProvider>
    </React.StrictMode>,
  );
}

/** Render a visible startup error instead of failing silently on WASM or configuration errors. */
bootstrap().catch((error: unknown) => {
  document.getElementById('root')!.textContent = `無法啟動 Yoin：${String(error)}`;
  console.error(error);
});
