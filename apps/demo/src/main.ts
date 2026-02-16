// apps/demo/src/main.ts
import {
  initYoin,
  YoinClient,
  createUndoPlugin,
  createDbPlugin,
  createLoggerPlugin,
  createMapProxy,
  createArrayProxy,
} from '@yoin/client';
import type { CursorRenderer, AwarenessState } from '@yoin/client';
import { createDefaultCursor, createEmojiCursor, createAvatar } from './renderers';
import { z } from 'zod';
import './style.css';

// ==========================================
// Tool function log: output to the page and console at the same time
// ==========================================
function log(msg: string) {
    const container = document.getElementById('log-container');
    if (container) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        container.prepend(entry);
    }
    console.log(msg);
}

async function bootstrap() {
    // ==========================================
    // 1. Init WASM + Client
    // ==========================================
    log("Starting WASM...");
    await initYoin();
    log("WASM loaded successfully");

    const urlParams = new URLSearchParams(window.location.search);
    const currentRoom = urlParams.get('room') || 'default-room';

    // ==========================================
    // Micro-kernel
    // ==========================================
    const client = new YoinClient({
        url: 'wss://yoin-worker.saiguanen.workers.dev', // Please confirm your Worker URL
        docId: currentRoom,
        awarenessThrottleMs: 30,
        heartbeatIntervalMs: 5000,
        heartbeatTimeoutMs: 30000,
        
        // Data Validation Rules
        schemas: {
            'app-settings': z.object({
                themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "The color must be in Hex format (e.g., #ff0000)"),
                lastUpdatedBy: z.string().optional(),
                // Allow arbitrary additional properties to support Deep Proxy testing (such as ui.sidebar)
            }).passthrough(), 
            'action-logs': z.array(z.object({
                action: z.string(),
                time: z.string()
            }))
        }
    });

    // ==========================================
    // Micro-kernel: Mount plugins
    // ==========================================
    // Note: undoPlugin must be mounted after dbPlugin, or adjust according to dependencies
    // Here we demonstrate the standard order: DB -> Undo -> Logger
    
    const dbPlugin = createDbPlugin({
        dbName: `YoinDemoDB-${currentRoom}`,
        debounceMs: 1000,
    });
    
    const undoPlugin = createUndoPlugin();

    client
        .use(dbPlugin.plugin)    // 1. IndexedDB Persistence
        .use(undoPlugin.plugin)  // 2. Undo/Redo functionality
        .use(createLoggerPlugin()); // 3. Logger Plugin

    log('🔌 Plugins installed: yoin-db, yoin-undo, logger');

    (window as any).client = client;
    console.log("✅ Yoin Client has been mounted to window.client for debugging");

    const docIdEl = document.getElementById('doc-id');
    if (docIdEl) docIdEl.innerText = currentRoom;

    // ==========================================
    // 2. Awareness: Identity Initialization
    // ==========================================
    const randomColors = ['#ff7675', '#74b9ff', '#55efc4', '#fdcb6e', '#a29bfe'];
    const myColor = randomColors[Math.floor(Math.random() * randomColors.length)];
    const myName = 'User_' + Math.floor(Math.random() * 100);
    const myClientId = client.getClientId();

    client.setAwareness({ name: myName, color: myColor });

    // ==========================================
    // 3. Mouse Input Throttled by rAF (Performance: Input)
    // ==========================================
    
    // Determine Device Type (Mobile vs Desktop) for Adaptive Cursor Rendering
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    let pendingCursor: { x: number; y: number } | null = null;
    let rafScheduled = false;

    // Function to define broadcast location updates, throttled by requestAnimationFrame
    const updateCursor = (x: number, y: number) => {
        pendingCursor = { x, y };
        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
                if (pendingCursor) {
                    client.setAwareness({
                        cursorX: pendingCursor.x,
                        cursorY: pendingCursor.y,
                        device: isMobile ? 'mobile' : 'desktop',
                        lastActive: Date.now()              // Used to determine if it is a 'ghost'
                    });
                    pendingCursor = null;
                }
                rafScheduled = false;
            });
        }
    };

    // Bind Desktop Event (Mouse)
    window.addEventListener('mousemove', (e) => {
        if (!isMobile) {
            updateCursor(e.clientX, e.clientY);
        }
    });

    // Bind Mobile Event (Touch)
    window.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            const touch = e.touches[0];
            updateCursor(touch.clientX, touch.clientY);
        }
    }, { passive: true });

    // Also update when clicking on mobile, since touchmove may not trigger if user just taps without moving
    window.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            const touch = e.touches[0];
            updateCursor(touch.clientX, touch.clientY);
        }
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
        pendingCursor = null;
        // Clear coordinates when leaving the window to prevent ghost cursors
        client.setAwareness({ cursorX: null, cursorY: null });
    });

    // ==========================================
    // 4. Renderer Switching (Dynamic UI)
    // ==========================================
    let currentRenderer: CursorRenderer = createDefaultCursor;

    // Cache the cursor DOM element (for DOM Diffing)
    const cursorElements = new Map<string, HTMLElement>();

    const btnToggleCursor = document.getElementById('btn-toggle-cursor');
    if (btnToggleCursor) {
        btnToggleCursor.onclick = () => {
            if (currentRenderer === createDefaultCursor) {
                currentRenderer = createEmojiCursor;
                log("🔄 Switched to: Emoji style");
            } else {
                currentRenderer = createDefaultCursor;
                log("🔄 Switched to: Default style");
            }
            cursorElements.forEach(el => el.remove());
            cursorElements.clear();
            client.notifyAwarenessListeners();
        };
    }

    // ==========================================
    // 5. 🌟 Awareness Rendering Loop (DOM Diffing)
    // ==========================================

    // Create a fullscreen layer dedicated to the cursor 
    let cursorLayer = document.getElementById('cursor-layer');
    if (!cursorLayer) {
        cursorLayer = document.createElement('div');
        cursorLayer.id = 'cursor-layer';
        cursorLayer.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            pointer-events: none;
            z-index: 9999;
            overflow: hidden;
        `;
        document.body.appendChild(cursorLayer);
    }

    client.onAwarenessChange((states: Map<string, AwarenessState>) => {
        const now = Date.now();

        // --- A. Update the profile picture list in the top right corner ---
        const avatarContainer = document.getElementById('awareness-container');
        if (avatarContainer) {
            avatarContainer.innerHTML = '<span style="font-size: 0.9rem; color: #666; margin-right: 5px;">Online Members:</span>';
            states.forEach((state, clientId) => {
                const isSelf = clientId === myClientId;
                const avatar = createAvatar(state.name || 'User', state.color || '#ccc', isSelf, clientId);
                avatarContainer.appendChild(avatar);
            });
        }

        // --- B. 🎯 DOM Diffing + CSS transform Cursor Rendering ---
        // Collect the remote cursor IDs that should exist in this frame
        const activeIds = new Set<string>();

        states.forEach((state, clientId) => {
            if (clientId === myClientId) return;
            const lastSeen = state.lastActive ?? state.timestamp;
            if (lastSeen && (now - lastSeen > 5000)) {
                return;
            }

            if (state.cursorX == null || state.cursorY == null) return;
            
            activeIds.add(clientId);

            let el = cursorElements.get(clientId);

            if (!el) {
                // 🆕 New user → create cursor DOM and add it to the layer
                // If it's Mobile, we manually override the renderer or check inside the renderer
                // Simple demonstration here: if it's Mobile, use a dot style
                if (state.device === 'mobile') {
                    el = document.createElement('div');
                    el.style.cssText = `
                        position: absolute; width: 12px; height: 12px; border-radius: 50%;
                        background-color: ${state.color}; border: 2px solid white;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        transition: transform 100ms linear;
                    `;
                    const label = document.createElement('div');
                    label.innerText = state.name || 'User';
                    label.style.cssText = `
                        position: absolute; left: 16px; top: -4px;
                        background: ${state.color}; color: #fff;
                        padding: 2px 6px; border-radius: 4px; font-size: 10px; white-space: nowrap;
                    `;
                    el.appendChild(label);
                } else {
                    el = currentRenderer(state.color || '#000', state.name || 'User');
                    el.style.transition = 'transform 100ms linear';
                }
                
                el.id = `cursor-${clientId}`;
                cursorLayer!.appendChild(el);
                cursorElements.set(clientId, el);
            }
            el.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px)`;
        });

        // Remove old cursors that are offline or have no coordinates
        for (const [clientId, el] of cursorElements.entries()) {
            if (!activeIds.has(clientId)) {
                el.remove();
                cursorElements.delete(clientId);
            }
        }

        // --- C. Whiteboard Object Selection Border (Selection Awareness) ---
        document.querySelectorAll('.shape').forEach(shape => {
            (shape as HTMLElement).style.border = '';
        });
        states.forEach((state) => {
            if (state.selection) {
                const el = document.getElementById(state.selection);
                if (el) {
                    el.style.border = `2px solid ${state.color}`;
                }
            }
        });
    });

    // ==========================================
    // 6. CRDT Data Subscription (Text / Map / Array)
    // ==========================================
    client.subscribe((text) => {
        // A. Text
        const display = document.getElementById('display');
        if (display) display.innerText = text;

        // B. Map (ex: settings)
        const mapData = client.getMap('app-settings');
        const mapDisplay = document.getElementById('map-display');
        if (mapDisplay) {
            mapDisplay.innerText = JSON.stringify(mapData, null, 2);
            if (mapData.themeColor) {
                const appContainer = document.getElementById('app-container');
                if (appContainer) {
                    appContainer.style.borderTop = `12px solid ${mapData.themeColor}`;
                    appContainer.style.transition = 'border-color 0.3s ease';
                }
                mapDisplay.style.borderLeft = `8px solid ${mapData.themeColor}`;
            }
        }

        // C. Array (ex: Historical records)
        const arrayData = client.getArray('action-logs');
        const arrayDisplay = document.getElementById('array-display');
        if (arrayDisplay) {
            arrayDisplay.innerHTML = '';
            if (arrayData.length === 0) {
                arrayDisplay.innerHTML = '<li>No logs available yet</li>';
            } else {
                arrayData.forEach(item => {
                    const li = document.createElement('li');
                    let content = item;
                    if (typeof item === 'string') {
                         try { content = JSON.parse(item); } catch {}
                    }
                    
                    li.innerText = typeof content === 'object' ? 
                        `[${content.time}] ${content.action}` : String(content);
                        
                    arrayDisplay.appendChild(li);
                });
            }
        }

        // D. Config (Background Color)
        const configData = client.getMap('config');
        if (configData && configData.bg) {
            document.body.style.backgroundColor = configData.bg;
            document.body.style.transition = 'background-color 0.5s ease';
        }
    });

    // ==========================================
    // 7. Button Binding (CRDT Operations)
    // ==========================================

    // Write test text
    const btnInsert = document.getElementById('btn-insert');
    if (btnInsert) {
        btnInsert.onclick = () => {
            const currentLen = client.getText().length;
            client.insertText(currentLen, " Hello! ");
        };
    }

    // Clear content
    const btnClear = document.getElementById('btn-clear');
    if (btnClear) {
        btnClear.onclick = () => {
            client.clearText();
            log(`🗑️ Notes have been cleared`);
        };
    }

    // Randomly switch theme color (write to 'app-settings')
    const btnUpdateMap = document.getElementById('btn-update-map');
    if (btnUpdateMap) {
        btnUpdateMap.onclick = () => {
            const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#34495e', '#d35400'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            client.setMap('app-settings', 'themeColor', randomColor);
            client.setMap('app-settings', 'lastUpdatedBy', myName);
            log(`🎨 Theme color has been updated to ${randomColor}`);
        };
    }

    // Change Theme Button: Changes the background color of the entire page
    const btnTheme = document.getElementById('btn-theme');
    if (btnTheme) {
        btnTheme.onclick = () => {
            const colors = ['#dfe6e9', '#ffeaa7', '#81ecec', '#fab1a0', '#74b9ff', '#a29bfe'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            log(`[UI] Setting theme color to: ${randomColor}`);
            // "config" is the name of the map, and "bg" is the key for theme color. 
            client.setMap('config', 'bg', randomColor);
        };
    }

    // Push to history
    const btnPushArray = document.getElementById('btn-push-array');
    if (btnPushArray) {
        btnPushArray.onclick = () => {
            const timeStr = new Date().toLocaleTimeString();
            client.pushArray('action-logs', { action: 'CLICK', time: timeStr });
            log(`➕ Log entry added`);
        };
    }

    // ==========================================
    // 8. Network Status UI
    // ==========================================
    client.subscribeNetwork((status) => {
        const statusEl = document.getElementById('connection-status');
        if (!statusEl) return;

        if (status === 'online') {
            statusEl.innerText = '🟢 Connected';
            statusEl.className = 'status-indicator online';
        } else if (status === 'connecting') {
            statusEl.innerText = '🟡 Connecting...';
            statusEl.className = 'status-indicator';
            statusEl.style.color = '#f39c12';
        } else {
            statusEl.innerText = '🔴 Offline (Reconnecting...)';
            statusEl.className = 'status-indicator offline';
        }
    });

    // ==========================================
    // 9. Cleaning: Notify upon departure
    // ==========================================
    window.addEventListener('beforeunload', () => {
        client.destroy(); // Use destroy to clean up heartbeat and awareness
    });

    // ==========================================
    // 10. Whiteboard Object Selection (Selection Awareness)
    // ==========================================
    document.querySelectorAll('.shape').forEach(el => {
        el.addEventListener('click', (e) => {
            const shapeId = (e.target as HTMLElement).id;
            client.setAwareness({ selection: shapeId });
        });
    });

    // ==========================================
    // Undo / Redo Buttons & Shortcuts
    // ==========================================
    const btnUndo = document.getElementById('btn-undo');
    if (btnUndo) {
        btnUndo.onclick = () => undoPlugin.undo();
    }

    const btnRedo = document.getElementById('btn-redo');
    if (btnRedo) {
        btnRedo.onclick = () => undoPlugin.redo();
    }
    
    // Keyboard shortcuts (Ctrl+Z / Ctrl+Y)
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undoPlugin.undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            undoPlugin.redo();
        }
    });

    // ==========================================
    // 🔮 Test Case 4: Proxy Transparency (Deep Proxy)
    // ==========================================
    
   // Define App settings type
    type AppSettings = {
        themeColor: string;
        lastUpdatedBy?: string;
        ui?: {
            sidebar?: {
                width: number;
                collapsed: boolean;
            }
        }
    };

    // 1. Set up a proxy for 'app-settings'
    const settingsStore = createMapProxy<AppSettings>(client, 'app-settings');

    // 2. Create an Array Proxy for 'action-logs'
    // Define the Log Item type
    interface ActionLog {
        action: string;
        time: string;
    }
    const logsStore = createArrayProxy<ActionLog>(client, 'action-logs');

    // 3. Bind Test Button for Proxy Operations
    const btnProxyTest = document.getElementById('btn-proxy-test');
    
    if (btnProxyTest) {
        btnProxyTest.onclick = () => {
            console.log("🔮 [Proxy Test] Executing transparent updates...");
            
            // --- Test A: Map Proxy ---
            try {
                // Automatically converted to client.setMap()
                settingsStore.themeColor = '#fd79a8'; 
                settingsStore.lastUpdatedBy = 'Proxy_User';

                // DDeep Proxy: Automatically converts to client.setMapDeep()
                // Note: Extra attributes must be allowed in the schema (.passthrough()), otherwise Zod will block them
                if (!settingsStore.ui) {
                    // Here we simulate creating a structure, but in Yoin Proxy,
                    // we can directly assign values to paths (if your Proxy implementation supports automatically creating paths)
                    // For safety, let's first use setMap to create the first layer
                    // client.setMap('app-settings', 'ui', {}); 
                    // Or try writing directly with Proxy (depending on the implementation of createDeepProxy)
                }
                
                // Assuming Proxy supports deep writing
                if (settingsStore.ui?.sidebar) {
                    settingsStore.ui.sidebar.width = Math.floor(Math.random() * 500);
                    settingsStore.ui.sidebar.collapsed = false;
                }
            } catch (e) {
                console.error("Proxy Map Error:", e);
            }

            // --- Test B: Array Proxy ---
            console.log("🔮 [Proxy Test] Testing Array Push...");
            try {
                // Automatically converted to client.pushArray()
                logsStore.push({
                    action: 'PROXY_PUSH',
                    time: new Date().toLocaleTimeString()
                });
            } catch (err) {
                console.error("Proxy Push Failed (Zod?):", err);
            }
        };
    }
}

bootstrap().catch(err => {
    console.error("Failed to start:", err);
});