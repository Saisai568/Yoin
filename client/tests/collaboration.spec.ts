import { test, expect, Page } from '@playwright/test';

// 輔助函式：讓兩個視窗進入同一個房間
async function joinRoom(page: Page, roomName: string, username: string) {
  // 注意：這裡指向你的 React 入口
  await page.goto(`http://localhost:5173/react.html?room=${roomName}`);
  
  // 等待連線成功 (假設你有個 .status-indicator.online 元素)
  await page.waitForSelector('.status-indicator.online', { timeout: 10000 });
  
  // 設定使用者名稱 (如果有 input)
  // await page.fill('input[name="username"]', username);
}

test('雙人協作資料與畫面應保持一致', async ({ browser }) => {
  // 1. 建立兩個獨立的瀏覽器環境 (模擬兩個不同的人)
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  
  const roomName = 'e2e-test-' + Date.now();

  // 2. 雙方進入房間
  await joinRoom(page1, roomName, 'UserA');
  await joinRoom(page2, roomName, 'UserB');

  // 3. User A 執行操作：輸入文字
  await page1.click('#btn-insert'); // 假設這是你的 "插入 Hello" 按鈕
  await page1.type('body', 'Playwright Test'); // 或者直接在 document 上打字

  // 4. 等待同步 (關鍵！)
  // 我們預期 User B 的螢幕上會出現 User A 打的字
  // 這裡可以檢查 DOM 文字
  await expect(page2.locator('#display')).toContainText('Hello');

  // 5. User B 執行操作：修改顏色
  await page2.click('#btn-update-map'); 

  // 6. 驗證 User A 是否同步收到顏色變更
  // 這裡假設背景色會變，我們等待 CSS 變化
  await page1.waitForFunction(() => {
    return document.getElementById('app-container')?.style.borderTopColor !== '';
  });

  // ==========================================
  // 💀 抓鬼核心：視覺一致性比對
  // ==========================================
  
  // 為了避免 "游標閃爍" 或 "名稱標籤位置微小差異" 導致測試失敗，
  // 我們可以先把游標圖層隱藏起來 (因為我們主要測內容一致性)
  await page1.evaluate(() => document.getElementById('cursor-layer')?.remove());
  await page2.evaluate(() => document.getElementById('cursor-layer')?.remove());

  // 截圖
  const screenshot1 = await page1.screenshot();
  const screenshot2 = await page2.screenshot();

  // 比較：雖然 Playwright 主要是跟「黃金範本」比對，
  // 但這裡我們可以用簡單的 Buffer 比較，確保兩邊畫面 "完全一樣"
  // (注意：這需要兩邊視窗大小完全一致，Playwright 預設會設為一致)
  expect(screenshot1).toEqual(screenshot2);
});