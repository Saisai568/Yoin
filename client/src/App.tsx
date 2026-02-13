import React, { useState } from 'react';
import { useYoinMap, useYoinArray, useYoinAwareness } from './react';

// 定義資料型別 (Schema)
type AppSettings = {
    themeColor: string;
    username: string;
};

type ActionLog = {
    action: string;
    time: string;
};

const UserList = () => {
    const awareness = useYoinAwareness();
    const users = Array.from(awareness.entries());

    return (
        <div style={{ padding: 10, borderBottom: '1px solid #ccc' }}>
            <h3>👥 Online Users: {users.length}</h3>
            <div style={{ display: 'flex', gap: 5 }}>
                {users.map(([id, state]: [string, any]) => (
                    <span key={id} style={{ 
                        background: state.color || '#ddd', 
                        padding: '2px 8px', 
                        borderRadius: 10,
                        fontSize: '0.8rem'
                    }}>
                        User {id}
                    </span>
                ))}
            </div>
        </div>
    );
};

const SettingsPanel = () => {
    // ✨ Magic: 直接拿到 Proxy 物件，修改它就會同步！
    const settings = useYoinMap<AppSettings>('app-settings');
    
    return (
        <div style={{ margin: 20, padding: 20, border: '1px solid #ddd', borderRadius: 8 }}>
            <h2>⚙️ Settings (Map Proxy)</h2>
            <div style={{ marginBottom: 10 }}>
                <label>Theme Color: </label>
                <input 
                    type="color" 
                    value={String(settings.themeColor ?? '#ffffff')}
                    // 直接賦值，自動觸發 setMap -> Sync -> React Render
                    onChange={(e) => settings.themeColor = e.target.value} 
                />
            </div>
            <div>
                <label>Username: </label>
                <input 
                    type="text" 
                    value={String(settings.username ?? '')}
                    onChange={(e) => settings.username = e.target.value}
                    placeholder="Enter name..."
                />
            </div>
            <pre style={{ background: '#f5f5f5', padding: 10 }}>
                {JSON.stringify(settings, null, 2)}
            </pre>
        </div>
    );
};

const LogPanel = () => {
    // ✨ Magic: 陣列操作就像本地陣列一樣
    const logs = useYoinArray<ActionLog>('action-logs');

    const addLog = () => {
        logs.push({
            action: 'REACT_CLICK',
            time: new Date().toLocaleTimeString()
        });
    };

    return (
        <div style={{ margin: 20, padding: 20, border: '1px solid #ddd', borderRadius: 8 }}>
            <h2>📜 Logs (Array Proxy)</h2>
            <button onClick={addLog}>➕ Add Log</button>
            <ul style={{ maxHeight: 200, overflowY: 'auto' }}>
                {logs.map((log, idx) => (
                    <li key={idx}>
                        [{log.time}] {log.action}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export const App = () => {
    // 取得根層級的 settings 來控制背景色
    const settings = useYoinMap<AppSettings>('app-settings');

    return (
        <div style={{ 
            minHeight: '100vh', 
            backgroundColor: settings.themeColor || '#ffffff',
            transition: 'background-color 0.3s'
        }}>
            <UserList />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <SettingsPanel />
                <LogPanel />
            </div>
        </div>
    );
};