// client/src/yoin/plugins/undo.ts
// ============================================================
// @yoin/undo — Undo/Redo 插件
// ============================================================
//
// 將 UndoManager 邏輯從 YoinClient 核心完全抽離。
// 透過 onInstall 掛載到核心，並利用 doc.undo() / doc.redo()
// (Rust WASM) 執行操作，再透過 broadcastUpdate 廣播變更。
// ============================================================

import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';
import type { YoinDoc } from '../../../../core/pkg-web/core';

export class YoinUndoPlugin implements YoinPlugin {
    readonly name = 'yoin-undo';

    private client!: YoinClient;
    private doc!: YoinDoc;

    // ==========================================
    // Lifecycle: onInstall
    // ==========================================
    onInstall(client: YoinClient): void {
        this.client = client;
        this.doc = client.getDoc();

        console.log('[YoinUndoPlugin] ↩️ Undo/Redo plugin installed');
    }

    // ==========================================
    // Public API
    // ==========================================

    /**
     * 執行 Undo
     * 呼叫 Rust WASM 的 undo()，取得反向 diff，
     * 廣播給其他 Peers 並更新本地 UI。
     */
    public undo(): void {
        try {
            const diff = this.doc.undo();

            if (diff && diff.length > 0) {
                // 1. 廣播 undo 的效果給其他 Peers
                this.client.broadcastUpdate(diff);
                // 2. 更新本地 UI
                this.client.notifyListeners();

                console.log('[YoinUndoPlugin] ↩️ Undo applied');
            }
        } catch (e) {
            console.error('[YoinUndoPlugin] Undo failed:', e);
        }
    }

    /**
     * 執行 Redo
     * 呼叫 Rust WASM 的 redo()，取得正向 diff，
     * 廣播給其他 Peers 並更新本地 UI。
     */
    public redo(): void {
        try {
            const diff = this.doc.redo();

            if (diff && diff.length > 0) {
                this.client.broadcastUpdate(diff);
                this.client.notifyListeners();

                console.log('[YoinUndoPlugin] ↪️ Redo applied');
            }
        } catch (e) {
            console.error('[YoinUndoPlugin] Redo failed:', e);
        }
    }

    // ==========================================
    // Plugin Lifecycle (optional hooks)
    // ==========================================

    onDestroy(): void {
        console.log('[YoinUndoPlugin] Destroyed');
    }
}

// ============================================================
// 組合式函式 (Composable Function) 風格的替代方案
// ============================================================

/**
 * 建立 Undo/Redo 能力的組合式函式
 * 可以不需要 class，直接回傳 { undo, redo, plugin }
 *
 * @example
 * const { undo, redo, plugin } = createUndoPlugin();
 * client.use(plugin);
 * btnUndo.onclick = undo;
 */
export function createUndoPlugin() {
    const instance = new YoinUndoPlugin();
    return {
        /** 插件實例，傳入 client.use() */
        plugin: instance,
        /** 執行 Undo */
        undo: () => instance.undo(),
        /** 執行 Redo */
        redo: () => instance.redo(),
    };
}
