import { test, expect, Page } from '@playwright/test';

// Helper function: Let two windows enter the same room
async function joinRoom(page: Page, roomName: string, username: string) {
  // Note: This points to your React entry.
  await page.goto(`http://localhost:5173/react.html?room=${roomName}`);
  
  // Waiting for connection to succeed (assuming you have a .status-indicator.online element)
  await page.waitForSelector('.status-indicator.online', { timeout: 10000 });
  
  // Set the username (if there is input)
  // await page.fill('input[name="username"]', username);
}

test('Data and visuals for collaborative work between two people should remain consistent.', async ({ browser }) => {
  // 1. Create two separate browser environments (to simulate two different people)
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  
  const roomName = 'e2e-test-' + Date.now();

  // 2. Both parties enter the room
  await joinRoom(page1, roomName, 'UserA');
  await joinRoom(page2, roomName, 'UserB');

  // 3. User A Perform operation: enter text
  await page1.click('#btn-insert'); // Assume this is your 'Insert Hello' button
  await page1.type('body', 'Playwright Test'); // Or just type directly on the document

  // 4. Waiting for synchronization (crucial!)
  // We expect the text typed by User A to appear on User B's screen
  // You can check the DOM text here
  await expect(page2.locator('#display')).toContainText('Hello');

  // 5. User B performed an action: changed the color
  await page2.click('#btn-update-map'); 

  // 6. Verify whether User A receives the color change synchronously
  // Here we assume the background color will change, and we wait for the CSS change
  await page1.waitForFunction(() => {
    return document.getElementById('app-container')?.style.borderTopColor !== '';
  });

  // ==========================================
  // Core of Ghost Hunting: Visual Consistency Comparison
  // ==========================================
  
  // To avoid test failures caused by 'cursor blinking' or 'slight differences in label positions',
  // we can first hide the cursor layer (since we are mainly testing content consistency)
  await page1.evaluate(() => document.getElementById('cursor-layer')?.remove());
  await page2.evaluate(() => document.getElementById('cursor-layer')?.remove());

  const screenshot1 = await page1.screenshot();
  const screenshot2 = await page2.screenshot();

  // Comparison: Although Playwright mainly compares with the 'golden template',
  // here we can use a simple buffer comparison to ensure the screens on both sides are "completely identical"
  // (Note: This requires the window sizes on both sides to be exactly the same, Playwright sets them to be the same by default)
  expect(screenshot1).toEqual(screenshot2);
});