// client/src/renderers.ts
// ============================================================
// Layer: Rendering — Pure function generates cursor/avatar DOM element
// ============================================================
// * All functions are pure functions: receive parameters → return HTMLElement
// * Does not handle positioning logic, positioning is managed by the control loop in main.ts

import type { CursorRenderer } from './yoin/types';


/**
 * Standard Cursor: Figma / Miro Style Arrow + Name Tag
 * The tip of the SVG arrow is at the top-left corner (0,0), 
 * making it convenient to position directly using translate.
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
 * Emoji Style Cursor: 👆 Finger + Outlined Name Tag
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
// 🧑‍🤝‍🧑 Avatar Renderer
// ==========================================

/**
 * Create a circular avatar element
 * @param name  User's name (take the first letter)
 * @param color Representative color
 * @param isSelf Whether it is the user themselves (add bold border)
 * @param clientId Unique identifier (used for tooltip)
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
