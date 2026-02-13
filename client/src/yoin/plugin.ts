// client/src/yoin/plugin.ts
// ============================================================
// Micro-kernel Plugin Interface
// ============================================================
//
// 所有 Yoin 擴充功能（Undo、IndexedDB、Schema Validation…）
// 都透過此介面掛載到輕量化的 YoinClient 核心上。
// ============================================================

import type { YoinClient } from './YoinClient';

/**
 * YoinPlugin 生命週期介面
 *
 * onInstall   — 插件被 `.use()` 註冊時觸發，用於初始化內部狀態並綁定事件
 * onBeforeUpdate — 本地資料變更「即將」被廣播前觸發（可攔截 / 記錄）
 * onAfterUpdate  — 任何文件更新（本地或遠端）套用後觸發
 * onDestroy      — Client 銷毀時觸發，用於清理計時器與資源
 */
export interface YoinPlugin {
    /** 插件名稱（用於除錯與日誌） */
    readonly name: string;

    /**
     * 插件安裝勾子
     * 在 `client.use(plugin)` 時被呼叫
     * @param client — YoinClient 實例，可存取公開 API 與內部勾子
     */
    onInstall(client: YoinClient): void;

    /**
     * 本地變更即將被廣播前呼叫
     * @param update — 即將廣播的 delta update (Uint8Array)
     */
    onBeforeUpdate?(update: Uint8Array): void;

    /**
     * 任何文件更新（本地 or 遠端）套用後呼叫
     * @param update — 已套用的 update (Uint8Array)
     */
    onAfterUpdate?(update: Uint8Array): void;

    /**
     * Client 銷毀時呼叫，用於清理資源
     */
    onDestroy?(): void;
}
