import { YoinClient } from './YoinClient';
import type { YoinPlugin } from './plugin';

export function createLoggerPlugin(prefix: string = '[YoinLogger]'): YoinPlugin {
    return {
        name: 'logger',
        
        onInstall(_client: YoinClient) {
            console.log(`${prefix} Plugin installed!`);
        },

        onBeforeUpdate(update: Uint8Array) {
            console.log(`${prefix} 📝 Update detected, size: ${update.length} bytes`);
        },

        onAfterUpdate(update: Uint8Array) {
            console.log(`${prefix} 📡 Update received, size: ${update.length} bytes`);
        }
    };
}