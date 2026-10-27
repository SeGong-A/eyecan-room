import { test, expect } from '@playwright/test';
import { mockRoom } from './fixture';

test('room video presence gates learning without changing saved preference', async ({ page }) => {
  const mock = await mockRoom(page);
  await mock.goToCamera();
  await page.waitForTimeout(1100);
  expect(mock.clientMessages.length).toBeGreaterThan(0);
  expect(mock.clientMessages.every(message => message.visible === false)).toBe(true);
  await page.getByRole('button', { name: '외장 카메라 연결', exact: true }).click();
  await expect.poll(() => mock.clientMessages.at(-1)?.visible).toBe(true);
  await page.locator('.room-video').evaluate((video: HTMLVideoElement) => video.pause());
  await expect.poll(() => mock.clientMessages.at(-1)?.visible).toBe(false);
  await page.locator('.room-video').evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => mock.clientMessages.at(-1)?.visible).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => mock.clientMessages.at(-1)?.visible).toBe(false);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => mock.clientMessages.at(-1)?.visible).toBe(true);
  mock.emit({ emergency_active: true });
  await expect.poll(() => mock.clientMessages.at(-1)?.visible).toBe(false);
  mock.emit({ emergency_active: false });
  await expect.poll(() => mock.clientMessages.at(-1)?.visible).toBe(true);
  await page.evaluate(() => (window as any).mockVideoTrack.dispatchEvent(new Event('ended')));
  await expect.poll(() => mock.clientMessages.at(-1)?.visible).toBe(false);
  expect(mock.requests.some(url => url.startsWith('/vision/learning'))).toBe(false);
});

for (const width of [1366, 360]) test(`logo source annotation hidden at ${width}px`, async ({ page }) => {
  await mockRoom(page); await page.setViewportSize({ width, height: 800 }); await page.goto('/');
  await expect(page.locator('.brand-logo')).toHaveCSS('clip-path', 'inset(20% 0px 0px)');
  await page.screenshot({ path: `../../docs/aac-2.1/screenshots/logo-clean-${width}.png` });
});
