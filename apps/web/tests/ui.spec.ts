import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mockRoom } from './fixture';

const viewports = [
  { width: 1440, height: 900 }, { width: 1280, height: 800 },
  { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 800 }
];

async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  if (info.title === 'layout light 1440x900' || info.title === 'layout dark 390x844') {
    await page.screenshot({ path: `../../docs/ui-redesign/after-${info.title.split(' ').slice(1).join('-')}-${name}.png`, fullPage: true });
  }
}

async function fitsViewport(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  const size = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
}

async function noMenuOverlap(page: Page) {
  const overlaps = await page.locator('.radial-command, .radial-center, .radial-current').evaluateAll((nodes) => {
    const boxes = nodes.map((node) => ({ name: node.textContent, box: node.getBoundingClientRect() }));
    const result: string[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box, b = boxes[j].box;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) result.push(`${boxes[i].name} / ${boxes[j].name}`);
    }
    return result;
  });
  expect(overlaps).toEqual([]);
}

async function selectCommand(page: Page, command: string, interval = 2000) {
  const items = await page.locator('.radial-command').evaluateAll((nodes) => nodes.map((node) => ({ command: node.getAttribute('data-command'), active: node.classList.contains('active') })));
  const index = items.findIndex((item) => item.command === command);
  expect(index).toBeGreaterThanOrEqual(0);
  const steps = (index - items.findIndex((item) => item.active) + items.length) % items.length;
  if (steps) await page.clock.runFor(steps * interval);
  await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', command);
  await page.getByRole('button', { name: '선택', exact: true }).click();
}

async function pauseClock(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
}

for (const theme of ['light', 'dark'] as const) for (const viewport of viewports) {
  test(`layout ${theme} ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    const mock = await mockRoom(page, { theme });
    await page.goto('/');
    await expect(page.locator('.brand-symbol use')).toHaveAttribute('href', '/brand/eyecan.svg#mark');
    await fitsViewport(page, '.home-start');
    await capture(page, info, 'home');
    await page.getByRole('button', { name: '시작하기' }).click();
    await fitsViewport(page, '.setup-primary');
    await capture(page, info, 'eye');
    mock.emit({ vision_status: 'RUNNING', face_detected: true, gaze_ready: true });
    await page.getByRole('button', { name: '방 카메라 연결로 이동' }).click();
    await fitsViewport(page, '.setup-primary');
    await capture(page, info, 'camera');
    await page.getByRole('button', { name: '외장 카메라 연결', exact: true }).click();
    await expect(page.locator('.room-video')).toBeVisible();
    await page.getByRole('button', { name: '알림 닫기' }).click();
    await expect(page.locator('.room-video')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
    await fitsViewport(page, '.room-tools');
    await fitsViewport(page, '.current-target');
    await capture(page, info, 'room');
    for (const [target, count] of [['CURTAIN', 4], ['LIGHT', 5], ['FAN', 6]] as const) {
      await mock.menu(target);
      await expect(page.locator('.radial-command')).toHaveCount(count);
      await fitsViewport(page, '.radial-current');
      await noMenuOverlap(page);
      await capture(page, info, target.toLowerCase());
    }
    mock.emit({ emergency_active: true });
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, info, 'emergency');
    expect(errors).toEqual([]);
  });
}

test('onboarding reflects real readiness, errors and camera retry', async ({ page }, info) => {
  const mock = await mockRoom(page, { cameraError: 'NotAllowedError' });
  await mock.goToEye();
  await page.getByRole('button', { name: '눈동자 인식 시작' }).click();
  await expect(page.getByRole('button', { name: '카메라 확인 중' })).toBeDisabled();
  await page.screenshot({ path: '../../docs/ui-redesign/after-loading.png', fullPage: true });
  mock.emit({ vision_status: 'RUNNING', face_detected: false });
  await expect(page.getByRole('heading', { name: '얼굴을 기다리고 있습니다' })).toBeVisible();
  await expect(page.getByRole('button', { name: '시선 인식 중' })).toBeDisabled();
  mock.emit({ face_detected: true });
  await expect(page.getByRole('heading', { name: '기준점을 맞추고 있습니다' })).toBeVisible();
  mock.emit({ vision_status: 'ERROR', vision_error: '모델을 불러오지 못했습니다' });
  await expect(page.getByText('모델을 불러오지 못했습니다')).toBeVisible();
  await page.screenshot({ path: '../../docs/ui-redesign/after-vision-error.png', fullPage: true });
  await page.getByRole('button', { name: '다시 시도' }).click();
  mock.emit({ vision_status: 'RUNNING', face_detected: true, gaze_ready: true, vision_error: null });
  await page.getByRole('button', { name: '방 카메라 연결로 이동' }).click();
  await page.getByRole('button', { name: '외장 카메라 연결', exact: true }).click();
  await expect(page.getByRole('heading', { name: '카메라 권한이 필요합니다' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('camera-permission-error.png'), fullPage: true });
  await page.evaluate(() => { (window as any).mockCameraError = ''; });
  await page.getByRole('button', { name: '다시 연결' }).click();
  await expect(page.locator('.room-video')).toBeVisible();
  await page.evaluate(() => { (window as any).mockVideoTrack.dispatchEvent(new Event('ended')); });
  await expect(page.getByRole('heading', { name: '방 카메라 연결이 끊겼습니다' })).toBeVisible();
  await page.screenshot({ path: '../../docs/ui-redesign/after-camera-disconnected.png', fullPage: true });
  await page.getByRole('button', { name: '다시 연결' }).click();
  await expect(page.locator('.room-video')).toBeVisible();
});

test('two second scanner wraps monotonically and cancel sends no command', async ({ page }) => {
  const mock = await mockRoom(page);
  await mock.enterRoom();
  await pauseClock(page);
  await mock.menu('FAN');
  await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', 'FAN_ON');
  await page.clock.runFor(1999);
  await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', 'FAN_ON');
  await page.clock.runFor(1);
  await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', 'FAN_OFF');
  await page.clock.runFor(10000);
  await expect(page.locator('.command-wheel')).toHaveAttribute('style', '--wheel-rotation: -360deg;');
  await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', 'FAN_ON');
  await page.clock.runFor(10000);
  await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', 'CANCEL');
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  expect(mock.requests.filter((url) => url.startsWith('/events/command'))).toEqual([]);
});

test('settings hierarchy, speed and theme persist across reload', async ({ page }) => {
  const mock = await mockRoom(page);
  await mock.enterRoom();
  await pauseClock(page);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.radial-center h2')).toHaveText('선택 속도');
  await expect(page.locator('.radial-command')).toHaveCount(6);
  await page.clock.runFor(4000);
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('eyecan.scanIntervalMs'))).toBe('3000');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.clock.runFor(3000);
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.radial-center h2')).toHaveText('화면');
  await page.clock.runFor(3000);
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  mock.emit({ scan_interval_ms: 2000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('eyecan.scanIntervalMs'))).toBe('3000');
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.getByRole('button', { name: '방 카메라 연결로 이동' }).click();
  await page.getByRole('button', { name: '외장 카메라 연결', exact: true }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.clock.runFor(9000);
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.radial-center h2')).toHaveText('설치 점검');
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.radial-center h2')).toHaveText('카메라 이동');
  await page.clock.runFor(12000);
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.radial-center h2')).toHaveText('설치 점검');
  await page.clock.runFor(3000);
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.radial-center h2')).toHaveText('방향 반전');
});

test('mock serial command success, rejection and disconnect feedback', async ({ page }) => {
  const mock = await mockRoom(page, { serial: true });
  await mock.enterRoom();
  await page.getByRole('button', { name: '연결 상태 상세' }).click();
  await expect(page.locator('.connection-details')).toBeVisible();
  await page.screenshot({ path: '../../docs/ui-redesign/after-connection-details.png', fullPage: true });
  await mock.menu('CURTAIN');
  await expect(page.locator('.connection-details')).toHaveCount(0);
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.toast--success')).toContainText('커튼 열기 명령을 전달했습니다');
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  const writes = await page.evaluate(() => (window as any).serialWrites as string[]);
  expect(writes.join('|')).toContain('m|2|180');
  expect(mock.requests).toContain('/events/command?command=CURTAIN_OPEN');
  await page.evaluate(() => { (window as any).serialReject = true; });
  await mock.menu('FAN');
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.toast--error')).toContainText('잘못된 입력');
  await expect(page.locator('.toast--success')).toHaveCount(0);
  await page.evaluate(() => (window as any).serialDisconnect());
  await expect(page.locator('.connection-trigger')).toContainText('연결 확인');
  await expect(page.getByRole('button', { name: 'Arduino 연결', exact: true })).toBeEnabled();
});

test('unsupported serial and failed commands never show success', async ({ page }) => {
  const mock = await mockRoom(page);
  await mock.enterRoom();
  await expect(page.getByRole('button', { name: 'Arduino 연결', exact: true })).toBeDisabled();
  await mock.menu('LIGHT');
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.toast--error')).toContainText('Chrome 또는 Edge');
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  expect(mock.requests).toContain('/events/command?command=LIGHT_ON');
});

test('emergency interrupts every menu, traps focus and requires explicit acknowledgement', async ({ page }) => {
  const mock = await mockRoom(page);
  await mock.enterRoom();
  await mock.menu('LIGHT');
  mock.emit({ emergency_active: true, emergency_sequence: 1 });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '상황 확인 및 해제' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('시연 모드 · 실제 벨 및 외부 연락은 실행되지 않습니다')).toBeVisible();
  await page.getByRole('button', { name: '상황 확인 및 해제' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('emergency clear failure keeps the alert visible and allows retry', async ({ page }) => {
  const mock = await mockRoom(page);
  await mock.enterRoom();
  mock.emit({ emergency_active: true, emergency_sequence: 1 });
  await page.route('**/emergency/clear', (route) => route.fulfill({ status: 503, body: 'unavailable' }), { times: 1 });
  await page.getByRole('button', { name: '상황 확인 및 해제' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('해제 요청을 전달하지 못했습니다');
  await page.getByRole('button', { name: '상황 확인 및 해제' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mock.requests).toContain('/emergency/clear');
});

test('200 percent text zoom and reduced motion preserve controls', async ({ page }, info) => {
  const mock = await mockRoom(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mock.enterRoom();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await mock.menu('FAN');
  await expect(page.locator('.command-wheel')).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: '선택', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '선택', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('zoom-200.png'), fullPage: true });
});

test('every settings submenu fits mobile and personalization errors remain visible', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const mock = await mockRoom(page, { theme: 'dark' });
  await mock.enterRoom();
  await pauseClock(page);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const inspect = async (name: string) => {
    await noMenuOverlap(page);
    await fitsViewport(page, '.radial-current');
    const overflow = await page.locator('.radial-command, .radial-center').evaluateAll((nodes) => nodes.filter((node) => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent));
    expect(overflow).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
    if (name === 'root') await page.screenshot({ path: '../../docs/ui-redesign/after-mobile-settings.png' });
  };
  await inspect('root');
  for (const command of ['SETTINGS_SCAN_SPEED', 'SETTINGS_THEME', 'SETTINGS_PERSONALIZATION']) {
    await selectCommand(page, command);
    await inspect(command);
    await selectCommand(page, 'BACK');
  }
  await selectCommand(page, 'SETTINGS_MOTOR');
  await inspect('installation');
  await selectCommand(page, 'SETTINGS_MOTOR_MOVE');
  await inspect('move');
  await selectCommand(page, 'BACK');
  await selectCommand(page, 'SETTINGS_MOTOR_DIRECTION');
  await inspect('directions');
  await selectCommand(page, 'MOTOR_FLIP_PAN');
  expect(await page.evaluate(() => localStorage.getItem('eyecan.motorPanSign'))).toBe('-1');
  await selectCommand(page, 'BACK');
  await selectCommand(page, 'BACK');
  await selectCommand(page, 'SETTINGS_PERSONALIZATION');
  await page.route('**/vision/model/save', (route) => route.fulfill({ status: 500, json: { detail: 'Mock save failure' } }));
  await selectCommand(page, 'SETTINGS_SAVE_MODEL');
  await expect(page.locator('.toast--error')).toBeVisible();
  await expect(page.locator('.radial-center h2')).toHaveText('시선 개인화');
});

for (const seconds of [1, 2, 3, 4, 5]) {
  test(`rotation setting ${seconds}s takes effect on the scanner`, async ({ page }) => {
    const mock = await mockRoom(page);
    await mock.enterRoom();
    await pauseClock(page);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await selectCommand(page, 'SETTINGS_SCAN_SPEED');
    await selectCommand(page, `SCAN_SPEED_${seconds * 1000}`);
    await expect(page.locator('.radial-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.clock.runFor(seconds * 1000 - 1);
    await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', 'SETTINGS_SCAN_SPEED');
    await page.clock.runFor(1);
    await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', 'SETTINGS_THEME');
  });
}

for (const [command, endpoint] of [
  ['SETTINGS_LEARNING', '/vision/learning?enabled=false'],
  ['SETTINGS_SAVE_MODEL', '/vision/model/save'],
  ['SETTINGS_RESET_MODEL', '/vision/model/reset']
]) {
  test(`personalization ${command} uses the existing API`, async ({ page }) => {
    const mock = await mockRoom(page);
    await mock.enterRoom();
    await pauseClock(page);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await selectCommand(page, 'SETTINGS_PERSONALIZATION');
    await selectCommand(page, command);
    await expect(page.locator('.radial-overlay')).toHaveCount(0);
    expect(mock.requests).toContain(endpoint);
    await expect(page.locator('.toast--success')).toBeVisible();
  });
}

for (const [target, command, index, sequence] of [
  ['CURTAIN', 'CURTAIN_CLOSE', 1, 'm|2|0'], ['CURTAIN', 'CURTAIN_STOP', 2, 'm|2|90'],
  ['LIGHT', 'LIGHT_ON', 0, 'm|3|10'], ['LIGHT', 'LIGHT_OFF', 1, 'm|3|0'],
  ['LIGHT', 'LIGHT_UP', 2, 'm|3|2'], ['LIGHT', 'LIGHT_DOWN', 3, 'm|3|0'],
  ['FAN', 'FAN_ON', 0, 'm|4|10'], ['FAN', 'FAN_OFF', 1, 'm|4|0'],
  ['FAN', 'FAN_LOW', 2, 'm|4|3'], ['FAN', 'FAN_MID', 3, 'm|4|6'], ['FAN', 'FAN_HIGH', 4, 'm|4|10']
] as const) {
  test(`device selection ${command} preserves the serial sequence`, async ({ page }) => {
    const mock = await mockRoom(page, { serial: true });
    await mock.enterRoom();
    await pauseClock(page);
    await mock.menu(target);
    await page.clock.runFor(index * 2000);
    await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', command);
    await page.getByRole('button', { name: '선택', exact: true }).click();
    await page.clock.runFor(1000);
    await expect(page.locator('.radial-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).serialWrites.join('|'))).toContain(sequence);
    expect(mock.requests).toContain(`/events/command?command=${command}`);
    await expect(page.locator('.toast--success')).toContainText('명령을 전달했습니다');
  });
}

test('text token contrasts meet WCAG AA in both themes', async ({ page }) => {
  await mockRoom(page);
  await page.goto('/');
  const ratios = await page.evaluate(() => {
    const luminance = (hex: string) => {
      const rgb = hex.trim().replace('#', '').match(/../g)!.map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const result: Record<string, number> = {};
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset.theme = theme;
      const css = getComputedStyle(document.documentElement);
      for (const [fg, bg] of [['--ink', '--background'], ['--muted', '--surface'], ['--primary', '--surface'], ['--on-primary', '--primary'], ['--error', '--error-surface'], ['--warning', '--background']]) {
        const a = luminance(css.getPropertyValue(fg)), b = luminance(css.getPropertyValue(bg));
        result[`${theme} ${fg}/${bg}`] = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }
    }
    return result;
  });
  for (const [name, ratio] of Object.entries(ratios)) expect(ratio, name).toBeGreaterThanOrEqual(4.5);
});

for (const [pan, tilt, target, name] of [[60, 20, 'CURTAIN', '커튼'], [120, 20, 'FAN', '선풍기'], [90, 0, 'LIGHT', '조명']] as const) {
  test(`camera angle and blink still select ${target}`, async ({ page }) => {
    const mock = await mockRoom(page, { serial: true });
    await mock.enterRoom();
    await page.evaluate(([pan, tilt]) => (window as any).mockAngle(pan, tilt), [pan, tilt]);
    await expect(page.locator('.current-target strong')).toHaveText(name);
    mock.emit({ blink_sequence: 1, last_blink_event: 'SELECT' });
    await expect(page.locator('.radial-center h2')).toHaveText(name);
    await expect(page.locator('.gaze-joystick')).toHaveCount(0);
    mock.emit({ blink_sequence: 2, last_blink_event: 'SELECT' });
    await expect(page.locator('.radial-overlay')).toHaveCount(0);
    await expect(page.locator('.toast--success')).toContainText('명령을 전달했습니다');
    expect(mock.requests).toContain(`/state/target?target=${target}`);
  });
}

test('gaze visual geometry is preserved and every unsafe state hides the knob', async ({ page }, info) => {
  const mock = await mockRoom(page);
  await mock.enterRoom();
  const knob = page.locator('.joystick-knob');
  await expect(knob).toHaveAttribute('cx', String(100 + (0.08 / 0.15) * 76));
  const diameter = await page.locator('.joystick-field').evaluate((node) => {
    const circle = node as SVGCircleElement;
    return circle.getBBox().width * circle.getScreenCTM()!.a;
  });
  expect(diameter).toBeCloseTo(900 * 0.48, 1);
  for (const patch of [{ is_blinking: true }, { face_detected: false }, { calibration_active: true }, { saccade_braking: true }]) {
    mock.emit({ is_blinking: false, face_detected: true, calibration_active: false, saccade_braking: false, ...patch });
    await expect(knob).toHaveCount(0);
  }
  mock.emit({ calibration_active: false, saccade_braking: false, gaze_error_x: 0, gaze_error_y: 0 });
  await expect(knob).toHaveCount(0);
  mock.emit({ gaze_error_x: 0.08, gaze_error_y: -0.04 });
  await page.evaluate(() => { (window as any).mockVideoTone = 'dark'; });
  await page.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames > 5);
  await page.screenshot({ path: info.outputPath('gaze-dark-video.png'), fullPage: true });
  await page.screenshot({ path: '../../docs/ui-redesign/after-dark-video.png', fullPage: true });
});
