import { test, expect } from '@playwright/test';
import { mockRoom } from './fixture';

test('each new connection and refresh homes once before enabling gaze motion', async ({ page }) => {
  const mock = await mockRoom(page, { serial: true });
  await mock.enterRoom();
  const writes = await page.evaluate(() => (window as any).serialWrites as string[]);
  expect(writes.filter((line) => line === 'c')).toHaveLength(1);
  expect(writes.join('|')).toMatch(/Q \d+\|H \d+\|m\|1\|c\|Q \d+/);
  expect(writes.slice(0, writes.indexOf('c')).some((line) => line.startsWith('V '))).toBe(false);
  await page.getByRole('button', { name: '연결 상태 상세' }).click();
  await expect(page.locator('.device-readings')).toContainText('90° / 20°');
  await page.getByRole('button', { name: '연결 상세 닫기' }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  expect(await page.evaluate(() => (window as any).serialWrites.filter((line: string) => line === 'c').length)).toBe(1);

  await page.reload();
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.getByRole('button', { name: '방 카메라 연결로 이동' }).click();
  await page.getByRole('button', { name: '외장 카메라 연결', exact: true }).click();
  await expect(page.locator('.connection-trigger')).toContainText('연결됨');
  expect(await page.evaluate(() => (window as any).serialWrites.filter((line: string) => line === 'c').length)).toBe(1);
  await page.getByRole('button', { name: '연결 상태 상세' }).click();
  await expect(page.locator('.device-readings')).toContainText('90° / 20°');
});

for (const homeFailure of ['silent', 'wrong-angle'] as const) {
  test(`home ${homeFailure} blocks motion instead of claiming success`, async ({ page }) => {
    const mock = await mockRoom(page, { serial: true, homeFailure });
    await mock.goToCamera();
    await page.getByRole('button', { name: '외장 카메라 연결', exact: true }).click();
    await expect(page.locator('.toast--error')).toContainText('카메라 초기', { timeout: 15000 });
    await expect(page.locator('.connection-trigger')).toContainText('연결 확인');
    expect(await page.evaluate(() => (window as any).serialWrites.some((line: string) => line.startsWith('V ')))).toBe(false);
  });
}
