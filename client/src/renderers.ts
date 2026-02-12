// client/src/renderers.ts
// ============================================================
// Layer 4a: Rendering — 純函式產生游標 / 頭像 DOM 元素
// ============================================================
// 📌 所有函式皆為 Pure Function：接收參數 → 回傳 HTMLElement
// 📌 不處理定位邏輯，定位由 main.ts 的控制迴圈負責

import type { CursorRenderer } from './yoin/types';

// ==========================================
// 🎯 游標渲染器
// ==========================================

/**
 * 標準游標：Figma / Miro 風格箭頭 + 名字標籤
 * SVG 箭頭尖端位於左上角 (0,0)，方便直接用 translate 定位
 */
export const createDefaultCursor: CursorRenderer = (color: string, name: string): HTMLElement => {
    const el = document.createElement('div');
    el.style.cssText = `
        position: absolute;
        left: 0; top: 0;
        pointer-events: none;
        z-index: 9999;
        will-change: transform;
    `;

    // 經典協作箭頭 SVG
    const svg = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
             style="filter: drop-shadow(1px 2px 3px rgba(0,0,0,0.3));">
            <path d="M3 3 L9 20 L12 12 L20 9 Z"
                  fill="${color}"
                  stroke="white"
                  stroke-width="2"
                  stroke-linejoin="round" />
        </svg>`;

    // 名字標籤 (偏移配合箭頭尖端)
    const tag = `
        <div style="
            background-color: ${color};
            color: white;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            position: absolute;
            left: 14px; top: 20px;
            white-space: nowrap;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            border: 1.5px solid white;">
            ${name}
        </div>`;

    el.innerHTML = svg + tag;
    return el;
};

/**
 * Emoji 風格游標：👆 手指 + 描邊名字標籤
 */
export const createEmojiCursor: CursorRenderer = (color: string, name: string): HTMLElement => {
    const el = document.createElement('div');
    el.style.cssText = `
        position: absolute;
        left: 0; top: 0;
        pointer-events: none;
        z-index: 9999;
        will-change: transform;
    `;

    el.innerHTML = `
        <div style="font-size: 24px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2));">👆</div>
        <div style="
            background: white;
            color: ${color};
            border: 2px solid ${color};
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: bold;
            position: absolute;
            left: 12px; top: 24px;
            white-space: nowrap;">
            ${name}
        </div>`;

    return el;
};

// ==========================================
// 🧑‍🤝‍🧑 頭像渲染器
// ==========================================

/**
 * 建立圓形頭像元素
 * @param name  使用者名稱 (取首字母)
 * @param color 代表色
 * @param isSelf 是否為自己 (加粗外框)
 * @param clientId 唯一識別碼 (用於 tooltip)
 */
export function createAvatar(
    name: string,
    color: string,
    isSelf: boolean,
    clientId: string,
): HTMLElement {
    const avatar = document.createElement('div');
    avatar.style.cssText = `
        width: 28px; height: 28px;
        border-radius: 50%;
        background-color: ${color};
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 12px;
        cursor: help;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: transform 0.15s ease;
        ${isSelf ? 'border: 2px solid #2c3e50;' : ''}
    `;
    avatar.innerText = name.substring(0, 1);
    avatar.title = `${name} (ID: ${clientId})`;

    return avatar;
}
