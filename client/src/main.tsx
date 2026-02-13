import React from 'react';
import { createRoot } from 'react-dom/client';
import { initYoin, YoinClient, initPanicHook } from './yoin';
import { createUndoPlugin } from './yoin';
import { createDbPlugin } from './yoin';
import { YoinProvider } from './react';
import { App } from './App';
import { z } from 'zod'; // Zod Schema
import './style.css';

async function bootstrap() {
    console.log("🚀 Initializing Yoin Engine...");
    await initYoin();
    initPanicHook();

    // 1. 設定 Client 與 Schema
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room') || 'react-demo';

    const client = new YoinClient({
        url: 'ws://localhost:8080',
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

    // 2. 掛載插件
    client
        .use(createDbPlugin({ dbName: `YoinReactDB-${room}` }).plugin)
        .use(createUndoPlugin().plugin);

    // 3. 啟動 React
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