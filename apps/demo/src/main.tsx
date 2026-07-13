// apps/demo/src/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { initYoin, YoinClient, createUndoPlugin, createDbPlugin } from '@yoin/client';
import { YoinProvider } from '@yoin/client/react';
import { App } from './App';
import { z } from 'zod'; // Zod Schema
import './style.css';

const workerUrl = import.meta.env.VITE_YOIN_WORKER_URL;

if (!workerUrl) {
    throw new Error('VITE_YOIN_WORKER_URL is not set');
}

async function bootstrap() {
    console.log("Initializing Yoin Engine...");
    await initYoin();

    // 1. Set up Client and Schema
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room') || 'react-demo';

    const client = new YoinClient({
        url: workerUrl,
        docId: room,
        dbName: `YoinReactDB-${room}`,
        awarenessThrottleMs: 30,
        heartbeatIntervalMs: 5000,
        schemas: {
            'app-settings': z.object({
                themeColor: z.string(),
                username: z.string().optional()
            }),
            'action-logs': z.array(z.object({
                action: z.string(),
                time: z.string()
            }))
        }
    });

    // 2. Mount Plugin
    client
        .use(createDbPlugin({ dbName: `YoinReactDB-${room}` }).plugin)
        .use(createUndoPlugin().plugin);

    // 3. Mount React App
    const rootEl = document.getElementById('root');
    if (rootEl) {
        const root = createRoot(rootEl);
        root.render(
            <React.StrictMode>
                <YoinProvider client={client}>
                    <App />
                </YoinProvider>
            </React.StrictMode>
        );
        console.log("✅ React App Mounted");
    }
}

bootstrap();