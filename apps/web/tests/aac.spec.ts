import { test, expect, type Page } from '@playwright/test';
import { mockRoom } from './fixture';
import { aacRequests, contextItems, objectItems, inAacZone } from '../src/domain/aac';
import { toSpeechText } from '../src/hooks/useSpeech';
import { cameraDirectionTarget } from '../src/hooks/useCameraDirectionTarget';
import { coverBox, iou } from '../src/utils/objectGeometry';
import { isFreshResponse, updateTracks } from '../src/utils/objectTracking';
import type { Detection } from '../src/types/aac';

const cup: Detection = { type: 'cup', confidence: .9, bbox: { x: .4, y: .4, width: .2, height: .2 } };

test('speech text does not pronounce trailing periods as dot', () => {
  expect(toSpeechText('물병을 주세요.')).toBe('물병을 주세요');
  expect(toSpeechText('물병 뚜껑을 열어주세요.')).toBe('물병 뚜껑을 열어주세요');
  expect(toSpeechText('물병을 치워주세요.')).toBe('물병을 치워주세요');
});

test('AAC strict angle boundaries, hysteresis, crop and stable one-to-one tracks', () => {
  expect(inAacZone(152, 25)).toBe(true);
  for (const pan of [147, 157, 130, 170]) expect(inAacZone(pan, 40)).toBe(false);
  expect(inAacZone(152, 24)).toBe(false); expect(inAacZone(152, 21, true)).toBe(true);
  expect(inAacZone(152, 20, true)).toBe(false);
  expect(iou(cup.bbox, cup.bbox)).toBeCloseTo(1);
  const covered = coverBox(cup.bbox, 1280, 720, 360, 800);
  expect(covered.visible).toBeGreaterThan(.5);
  expect(covered.box.x).toBeGreaterThanOrEqual(0);
  expect(coverBox({ x: 0, y: 0, width: .1, height: .1 }, 1280, 720, 360, 800).visible).toBe(0);
  const id = { current: 0 };
  let tracks = updateTracks([], [cup, cup], 0, id);
  expect(tracks).toHaveLength(2); expect(tracks[0].stable).toBe(false);
  tracks = updateTracks(tracks, [cup], 200, id);
  tracks = updateTracks(tracks, [cup], 400, id);
  expect(tracks.filter(t => t.stable)).toHaveLength(1);
  expect(updateTracks(tracks, [], 1601, id)).toHaveLength(0);
  expect(updateTracks([], [{ ...cup, confidence: .59 }, { ...cup, bbox: { ...cup.bbox, width: .001 } }], 0, id)).toHaveLength(0);
  const response = { sessionId: 'new', frameId: 2, capturedAtMs: 100, inferenceMs: 1, detections: [cup] };
  expect(isFreshResponse(response, 'new', 1, 500)).toBe(true);
  expect(isFreshResponse(response, 'old', 1, 500)).toBe(false);
  expect(isFreshResponse(response, 'new', 2, 500)).toBe(false);
  expect(isFreshResponse(response, 'new', 1, 1301)).toBe(false);
});

test('TV uses ten-degree horizontal and eight-degree vertical home bounds', () => {
  expect(cameraDirectionTarget(142, 16)).toBe('TV');
  expect(cameraDirectionTarget(162, 16)).toBe('TV');
  expect(cameraDirectionTarget(152, 24)).toBe('TV');
  expect(cameraDirectionTarget(141.9, 16)).toBe('CURTAIN');
  expect(cameraDirectionTarget(162.1, 16)).toBe('FAN');
  expect(cameraDirectionTarget(152, 10)).toBe('LIGHT');
});

test('phone uses relaxed confidence and area thresholds but keeps three-hit stabilization', () => {
  const phone: Detection = { type: 'cell_phone', confidence: .45, bbox: { x: .2, y: .2, width: .1, height: .05 } };
  const nextId = { current: 0 };
  expect(updateTracks([], [{ ...phone, confidence: .44 }], 0, nextId)).toHaveLength(0);
  expect(updateTracks([], [{ ...phone, bbox: { ...phone.bbox, width: .09 } }], 0, nextId)).toHaveLength(0);
  let tracks = updateTracks([], [phone], 0, nextId);
  expect(tracks[0].stable).toBe(false);
  tracks = updateTracks(tracks, [phone], 200, nextId);
  expect(tracks[0].stable).toBe(false);
  tracks = updateTracks(tracks, [phone], 400, nextId);
  expect(tracks[0].stable).toBe(true);
});

async function aacFixture(page: Page, theme: 'light' | 'dark' = 'light', detections: Detection[] = [cup, { ...cup, bbox: { ...cup.bbox, x: .42 } }]) {
  const mock = await mockRoom(page, { serial: true, theme });
  let detect = true;
  let sequence = 0;
  let lastFrame: number[] = [];
  await page.route('**/objects/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('health')) return route.fulfill({ json: { status: 'READY', supportedTypes: [...new Set(detections.map(d => d.type))], modelId: 'mock-objects', error: null } });
    lastFrame = Array.from(route.request().postDataBuffer() ?? []);
    return route.fulfill({ json: { sessionId: url.searchParams.get('session_id'), frameId: Number(url.searchParams.get('frame_id')),
      capturedAtMs: Number(url.searchParams.get('captured_at_ms')), inferenceMs: 10, detections: detect ? detections : [] } });
  });
  await page.addInitScript(() => {
    const win = window as any;
    win.spoken = []; win.speechMode = 'manual'; win.cancelCount = 0;
    const synth = new EventTarget() as any;
    synth.getVoices = () => [{ voiceURI: 'mock-ko', lang: 'ko-KR', default: true, name: '한국어 테스트' }];
    synth.cancel = () => { win.cancelCount++; };
    synth.speak = (utterance: any) => {
      win.spoken.push(utterance.text); win.lastUtterance = utterance;
      if (win.speechMode === 'error') setTimeout(() => utterance.onerror?.({ error: 'synthesis-failed' }), 20);
      else setTimeout(() => utterance.onstart?.(), 20);
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class {
      text: string;
      constructor(text: string) { this.text = text; }
    } });
  });
  const angle = async (pan: number, tilt: number) => page.evaluate(([p, t]) => (window as any).mockAngle(p, t), [pan, tilt]);
  const blink = async (event = 'SELECT') => {
    mock.emit({ is_blinking: true });
    await page.waitForTimeout(80);
    mock.emit({ is_blinking: false, blink_sequence: ++sequence, last_blink_event: event });
    await page.waitForTimeout(80);
  };
  const open = async () => {
    await mock.enterRoom();
    await expect(page.locator('.object-status')).toContainText(`객체 ${new Set(detections.map(d => d.type)).size}개`);
    await angle(152, 30);
    await expect(page.locator('.current-target')).toContainText('의사소통');
    await blink();
    await expect(page.locator('.radial-center')).toContainText('의사소통');
  };
  return { ...mock, angle, blink, open, frame: () => lastFrame, clearDetections: () => { detect = false; } };
}

test('cup, bottle and phone keep separate stable tracks and unique object menus', () => {
  const detections: Detection[] = [cup, { ...cup, type: 'bottle' }, { ...cup, type: 'cell_phone' }];
  const nextId = { current: 0 };
  let tracks = updateTracks([], detections, 0, nextId);
  tracks = updateTracks(tracks, detections, 200, nextId);
  tracks = updateTracks(tracks, detections, 400, nextId);
  expect(tracks.filter(t => t.stable).map(t => t.type)).toEqual(['cup', 'bottle', 'cell_phone']);
  expect(objectItems(['cell_phone', 'cup', 'bottle', 'cup']).map(item => item.label)).toEqual(['물컵', '물병', '핸드폰', '뒤로']);
  expect(contextItems('CURTAIN', ['bottle']).map(item => item.label)).toEqual(['커튼', '물병', '뒤로']);
  expect(contextItems('FAN', ['cell_phone']).map(item => item.label)).toEqual(['선풍기', '핸드폰', '뒤로']);
});

test('appliance direction without an object still opens its device menu directly', async ({ page }) => {
  const mock = await aacFixture(page);
  await mock.enterRoom();
  mock.clearDetections();
  await page.waitForTimeout(1400);
  await mock.angle(130, 16);
  await expect(page.locator('.current-target')).toContainText('커튼');
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('커튼');
  await expect(page.locator('.radial-command')).toHaveCount(5);
});

for (const scenario of [
  { target: 'CURTAIN', name: '커튼', type: 'bottle', objectName: '물병', pan: 130, command: 'BOTTLE_GIVE', spoken: '물병을 주세요' },
  { target: 'FAN', name: '선풍기', type: 'cell_phone', objectName: '핸드폰', pan: 170, command: 'PHONE_GIVE', spoken: '핸드폰을 주세요' }
] as const) {
  test(`${scenario.name} direction disambiguates its device from ${scenario.objectName}`, async ({ page }) => {
    const detection: Detection = { ...cup, type: scenario.type };
    const mock = await aacFixture(page, 'light', [detection]);
    await mock.enterRoom();
    await expect(page.locator('.object-status')).toContainText('객체 1개');
    await mock.angle(scenario.pan, 16);
    await expect(page.locator('.current-target')).toContainText(scenario.name);
    await mock.blink();
    await expect(page.locator('.radial-center')).toContainText('대상 선택');
    await expect(page.locator('.radial-command')).toHaveCount(3);
    await expect(page.locator(`.radial-command.active[data-command="CONTEXT_OBJECT_${scenario.type}"]`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.radial-overlay')).not.toHaveClass(/is-transitioning/);
    await mock.blink();
    await expect(page.locator('.radial-center')).toContainText(scenario.objectName);
    await expect(page.locator(`.radial-command.active[data-command="${scenario.command}"]`)).toBeVisible();
    await mock.blink();
    await expect(page.locator('.aac-caption')).toContainText(scenario.spoken);
    expect(await page.evaluate(() => (window as any).spoken)).toEqual([scenario.spoken]);
    expect(mock.requests.filter(r => r.startsWith('/events/command') || r.startsWith('/tv/command'))).toEqual([]);
  });
}

test('context device choice continues to the existing appliance command menu', async ({ page }) => {
  const mock = await aacFixture(page, 'light', [{ ...cup, type: 'bottle' }]);
  await mock.enterRoom();
  await mock.angle(130, 16);
  await expect(page.locator('.current-target')).toContainText('커튼');
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('대상 선택');
  await expect(page.locator('.radial-command.active[data-command="CONTEXT_DEVICE_CURTAIN"]')).toBeVisible();
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('커튼');
  await expect(page.locator('.radial-command')).toHaveCount(5);
});

test('emergency discards a pending appliance and object context menu', async ({ page }) => {
  const mock = await aacFixture(page, 'light', [{ ...cup, type: 'bottle' }]);
  await mock.enterRoom();
  await expect(page.locator('.object-status')).toContainText('객체 1개');
  await mock.angle(130, 16);
  await expect(page.locator('.current-target')).toContainText('커튼');
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('대상 선택');
  mock.emit({ emergency_active: true, interaction_mode: 'EXPLORE' });
  await expect(page.getByRole('heading', { name: '응급상황 발생' })).toBeVisible();
  mock.emit({ emergency_active: false, interaction_mode: 'EXPLORE' });
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
});

for (const type of ['bottle', 'cell_phone'] as const) {
  for (const request of aacRequests[type].filter(item => item.command !== 'AAC_BACK')) {
    test(`${type} ${request.command} speaks exactly once without a device command`, async ({ page }) => {
      const mock = await aacFixture(page, 'light', [{ ...cup, type }]);
      await mock.open();
      await mock.blink();
      await expect(page.locator('.radial-command')).toHaveCount(4);
      await expect(page.locator(`.radial-command.active[data-command="${request.command}"]`)).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.radial-overlay')).not.toHaveClass(/is-transitioning/);
      await mock.blink();
      await expect(page.locator('.aac-caption')).toContainText(request.description);
      expect(await page.evaluate(() => (window as any).spoken)).toEqual([toSpeechText(request.description)]);
      await page.evaluate(() => (window as any).lastUtterance.onend());
      await expect(page.locator('.radial-overlay')).toHaveCount(0);
      expect(mock.requests.filter(r => r.startsWith('/events/command') || r.startsWith('/tv/command'))).toEqual([]);
      const writes: string[] = await page.evaluate(() => (window as any).serialWrites);
      expect(writes.filter(w => ['2', '3', '4', 'o', 'k'].includes(w))).toEqual([]);
    });
  }
}

test('downward -> cup -> request -> speech exactly once, no device command', async ({ page }) => {
  const mock = await aacFixture(page);
  await mock.open();
  mock.emit({ blink_sequence: 1, last_blink_event: 'SELECT' });
  await page.waitForTimeout(80);
  await expect(page.locator('.radial-center')).toContainText('의사소통');
  expect(await page.locator('.radial-command').count()).toBe(2);
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('물컵');
  await expect(page.locator('.radial-command')).toHaveCount(4);
  await mock.blink();
  await expect(page.locator('.aac-caption')).toContainText('물 마시고 싶어요.');
  expect(await page.evaluate(() => (window as any).spoken)).toEqual(['물 마시고 싶어요']);
  mock.emit({ blink_sequence: 3, last_blink_event: 'SELECT' });
  await page.evaluate(() => (window as any).lastUtterance.onend());
  await expect(page.locator('.aac-caption')).toHaveCount(0);
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  expect(mock.requests.filter(r => r.startsWith('/events/command') || r.startsWith('/tv/command'))).toEqual([]);
  const writes: string[] = await page.evaluate(() => (window as any).serialWrites);
  expect(writes.filter(w => ['2', '3', '4', 'o', 'k'].includes(w))).toEqual([]);
});

test('detector receives the full frame rotated once at 640px maximum', async ({ page }) => {
  const mock = await aacFixture(page); await mock.enterRoom();
  await expect(page.locator('.object-status')).toContainText('객체 1개');
  const frame = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, pixel: Array.from(ctx.getImageData(image.width - 5, image.height - 5, 1, 1).data) };
  }, mock.frame());
  expect(frame.width).toBe(640); expect(frame.height).toBe(360);
  for (const [index, expected] of [234, 196, 170].entries()) expect(Math.abs(frame.pixel[index] - expected)).toBeLessThan(12);
  await page.screenshot({ path: '../../docs/aac-2.1/screenshots/object-overlay-mock.png' });
});

test('snapshot persists after object disappearance; back and cancel never speak', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open();
  mock.clearDetections(); await page.waitForTimeout(1400);
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('물컵');
  await mock.blink('CANCEL');
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).spoken)).toEqual([]);
});

for (const interruption of ['CANCEL', 'EMERGENCY']) test(`speech ${interruption} ignores late completion`, async ({ page }) => {
  const mock = await aacFixture(page); await mock.open(); await mock.blink(); await mock.blink();
  await expect(page.locator('.aac-caption')).toContainText('음성 출력 중');
  if (interruption === 'CANCEL') await mock.blink('CANCEL');
  else mock.emit({ emergency_active: true });
  await expect(page.locator('.aac-caption')).toHaveCount(0);
  await page.evaluate(() => (window as any).lastUtterance.onend());
  await expect(page.getByText('음성 출력 완료', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).spoken.length)).toBe(1);
});

test('speech failure stays in request menu and does not automatically replay', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open(); await mock.blink();
  await page.evaluate(() => (window as any).speechMode = 'error'); await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('물컵');
  await expect(page.locator('.aac-caption')).toContainText('실패');
  expect(await page.evaluate(() => (window as any).spoken.length)).toBe(1);
});

test('missing Korean voice does not claim success or send a request', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open(); await mock.blink();
  await page.evaluate(() => (window.speechSynthesis as any).getVoices = () => []);
  await mock.blink(); await expect(page.locator('.aac-caption')).toContainText('한국어 음성을 사용할 수 없습니다');
  await expect(page.locator('.radial-center')).toContainText('물컵');
  expect(await page.evaluate(() => (window as any).spoken)).toEqual([]);
});

test('speech start timeout unlocks the request menu without retry', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open(); await mock.blink();
  await page.evaluate(() => (window.speechSynthesis as any).speak = (utterance: any) => { (window as any).spoken.push(utterance.text); });
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 50));
  await mock.blink();
  await page.clock.runFor(5001);
  await expect(page.locator('.aac-caption')).toContainText('음성 시작 시간 초과');
  await expect(page.locator('.radial-center')).toContainText('물컵');
  expect(await page.evaluate(() => (window as any).spoken.length)).toBe(1);
});

test('face loss pauses AAC input but does not discard frozen objects', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open();
  mock.emit({ face_detected: false });
  await expect(page.locator('.aac-caption')).toContainText('일시정지');
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('의사소통');
  mock.emit({ face_detected: true }); await page.waitForTimeout(80); await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('물컵');
});

test('short blink, unavailable objects and appliance priority do not enter AAC', async ({ page }) => {
  const mock = await aacFixture(page); await mock.enterRoom(); await mock.angle(152, 30);
  await expect(page.locator('.current-target')).toContainText('의사소통');
  await mock.blink('SHORT'); await expect(page.locator('.radial-overlay')).toHaveCount(0);
  mock.clearDetections(); await page.waitForTimeout(1500); await mock.blink();
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  await mock.angle(130, 30); await expect(page.locator('.current-target')).toContainText('커튼'); await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('커튼');
});

test('down direction must be stable before eye closure, not only at eye opening', async ({ page }) => {
  const mock = await aacFixture(page); await mock.enterRoom();
  await expect(page.locator('.object-status')).toContainText('객체 1개');
  await mock.angle(152, 30);
  mock.emit({ is_blinking: true }); await page.waitForTimeout(650);
  mock.emit({ is_blinking: false, blink_sequence: 90, last_blink_event: 'SELECT' });
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  await expect(page.locator('.current-target')).toContainText('의사소통');
  await mock.blink(); await expect(page.locator('.radial-center')).toContainText('의사소통');
});

test('stop ACK failure never opens an AAC menu', async ({ page }) => {
  const mock = await aacFixture(page); await mock.enterRoom();
  await mock.angle(152, 30); await expect(page.locator('.current-target')).toContainText('의사소통');
  await page.evaluate(() => (window as any).mockHoldFailure = true);
  await mock.blink(); await page.waitForTimeout(700);
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).spoken)).toEqual([]);
});

test('AAC transition blink ignored and request back restores frozen object list', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open();
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.clock.runFor(2000);
  await expect(page.locator('.radial-overlay')).toHaveClass(/is-transitioning/);
  mock.emit({ is_blinking: true }); await page.waitForTimeout(50);
  mock.emit({ is_blinking: false, blink_sequence: 88, last_blink_event: 'SELECT' });
  await page.waitForTimeout(50);
  await expect(page.locator('.radial-center')).toContainText('의사소통');
  // Finish back's dwell and arrive at cup again.
  await page.clock.runFor(2240);
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('물컵');
  mock.clearDetections();
  await page.clock.runFor(6240);
  await expect(page.locator('.radial-command.active')).toHaveAttribute('data-command', 'AAC_BACK');
  await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('의사소통');
  await expect(page.locator('.radial-command')).toHaveCount(2);
  await page.clock.runFor(2240);
  await mock.blink();
  await expect(page.locator('.radial-overlay')).toHaveCount(0);
});

test('serial disconnect blocks selection; started speech survives face loss', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open(); await mock.blink(); await mock.blink();
  await expect(page.locator('.aac-caption')).toContainText('음성 출력 중');
  const cancels = await page.evaluate(() => (window as any).cancelCount);
  mock.emit({ face_detected: false });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).cancelCount)).toBe(cancels);
  await page.evaluate(() => (window as any).lastUtterance.onend());
  await expect(page.locator('.aac-caption')).toHaveCount(0);
  mock.emit({ face_detected: true }); await page.waitForTimeout(600); await mock.blink();
  await expect(page.locator('.radial-center')).toContainText('의사소통');
  await page.evaluate(() => (window as any).serialDisconnect());
  await expect(page.locator('.aac-caption')).toContainText('일시정지');
  await mock.blink(); await expect(page.locator('.radial-center')).toContainText('의사소통');
});

test('camera loss clears exploratory candidates and pauses a frozen AAC menu', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open();
  await page.evaluate(() => (window as any).mockVideoTrack.dispatchEvent(new Event('ended')));
  await expect(page.locator('.aac-caption')).toContainText('일시정지');
  await mock.blink(); await expect(page.locator('.radial-center')).toContainText('의사소통');
  await mock.blink('CANCEL'); await expect(page.locator('.radial-overlay')).toHaveCount(0);
  await expect(page.locator('.object-status')).toContainText('객체 0개');
});

test('detector outage leaves appliance control usable', async ({ page }) => {
  const mock = await aacFixture(page);
  await page.route('**/objects/**', route => route.fulfill({ status: 503, json: { detail: 'offline' } }));
  await mock.enterRoom(); await mock.angle(170, 16);
  await expect(page.locator('.current-target')).toContainText('선풍기');
  await mock.blink(); await expect(page.locator('.radial-center')).toContainText('선풍기');
  await mock.blink(); await expect(page.locator('.radial-overlay')).toHaveCount(0);
  expect(mock.requests.some(r => r.includes('/events/command?command=FAN_LOW'))).toBe(true);
});

test('caregiver voice test, persisted choice and JSON event export', async ({ page }) => {
  const mock = await aacFixture(page); await mock.open(); await mock.blink('CANCEL');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.locator('.aac-voice-label select').selectOption('mock-ko');
  expect(await page.evaluate(() => localStorage.getItem('eyecan.aac.voice'))).toBe('mock-ko');
  await page.getByRole('button', { name: '음성 테스트', exact: true }).click();
  expect(await page.evaluate(() => (window as any).spoken)).toEqual(['물 마시고 싶어요']);
  await page.getByRole('button', { name: '음성 중단', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '측정 로그 내보내기', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('eyecan-aac-log.json');
});

for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844], [360, 800]]) {
  for (const theme of ['light', 'dark'] as const) test(`AAC layout ${width}x${height} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const mock = await aacFixture(page, theme); await mock.open(); await mock.blink();
    const boxes = await page.locator('.radial-command, .radial-current').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    }));
    for (const box of boxes) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width + 1); expect(box.bottom).toBeLessThanOrEqual(height + 1); }
    await page.screenshot({ path: `../../docs/aac-2.1/screenshots/aac-${width}-${height}-${theme}.png` });
  });
}

for (const [width, height] of [[1366, 768], [390, 844], [360, 800]]) {
  for (const theme of ['light', 'dark'] as const) test(`context layout ${width}x${height} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const detections: Detection[] = [
      { ...cup, type: 'cup' },
      { ...cup, type: 'bottle' },
      { ...cup, type: 'cell_phone' },
      { ...cup, type: 'tissue_box' }
    ];
    const mock = await aacFixture(page, theme, detections);
    await mock.enterRoom();
    await expect(page.locator('.object-status')).toContainText('객체 4개');
    await mock.angle(130, 16);
    await expect(page.locator('.current-target')).toContainText('커튼');
    await mock.blink();
    await expect(page.locator('.radial-command')).toHaveCount(6);
    const layout = await page.locator('.radial-command, .radial-center, .radial-current').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      return { name: node.textContent?.trim(), x: r.x, y: r.y, right: r.right, bottom: r.bottom,
        overflowX: node.scrollWidth > node.clientWidth + 1, overflowY: node.scrollHeight > node.clientHeight + 1 };
    }));
    for (const box of layout) {
      expect(box.x, box.name).toBeGreaterThanOrEqual(0);
      expect(box.y, box.name).toBeGreaterThanOrEqual(0);
      expect(box.right, box.name).toBeLessThanOrEqual(width + 1);
      expect(box.bottom, box.name).toBeLessThanOrEqual(height + 1);
      expect(box.overflowX, box.name).toBe(false);
      expect(box.overflowY, box.name).toBe(false);
    }
    for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i], b = layout[j];
      const overlap = Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
      expect(overlap, `${a.name} / ${b.name}`).toBe(false);
    }
    await page.screenshot({ path: `../../docs/aac-2.1/screenshots/context-${width}-${height}-${theme}.png` });
  });
}
