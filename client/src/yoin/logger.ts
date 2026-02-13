// 1. 從正確的檔案匯入實體類別
import { YoinClient } from './YoinClient';
// 2. 使用 'import type' 匯入介面
import type { YoinPlugin } from './plugin';

export function createLoggerPlugin(prefix: string = '[YoinLogger]'): YoinPlugin {
    return {
        name: 'logger',
        
        onInstall(_client: YoinClient) {
            console.log(`${prefix} Plugin installed!`);
        },

        // 攔截所有本地寫入
        onBeforeUpdate(update: Uint8Array) {
            console.log(`${prefix} 📝 Update detected, size: ${update.length} bytes`);
        },

        // 監聽所有網路同步
        onAfterUpdate(update: Uint8Array) {
            console.log(`${prefix} 📡 Update received, size: ${update.length} bytes`);
        }
    };
}