import { expect, type Page, type WebSocketRoute } from '@playwright/test';

type Options = { serial?: boolean; theme?: 'light' | 'dark'; cameraError?: string; homeFailure?: 'silent' | 'wrong-angle' };

// All camera, serial and API traffic is isolated from the user's running devices.
export async function mockRoom(page: Page, options: Options = {}) {
  const sockets = new Set<WebSocketRoute>();
  const requests: string[] = [];
  let state: Record<string, unknown> = {
    connection_state: 'STREAMING', vision_status: 'STOPPED', vision_error: null,
    face_detected: false, gaze_ready: false, scan_interval_ms: 2000,
    interaction_mode: 'EXPLORE', selected_target: 'FAN', learning_enabled: true,
    gaze_error_x: 0.08, gaze_error_y: -0.04, gaze_deadzone: 0.03,
    emergency_active: false, sample_sequence: 1, tracking_session_id: 'mock-ui-session'
  };
  const emit = (patch: Record<string, unknown>) => {
    state = { ...state, ...patch };
    for (const socket of sockets) socket.send(JSON.stringify(state));
  };
  await page.routeWebSocket('**/ws/state', (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify(state));
    socket.onClose(() => sockets.delete(socket));
  });
  await page.route(/\/(vision|state|events|emergency|health)(\/|\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/vision/start') emit({ vision_status: 'STARTING', vision_error: null });
    if (url.pathname === '/state/mode') emit({ interaction_mode: url.searchParams.get('mode') });
    if (url.pathname === '/state/target') emit({ selected_target: url.searchParams.get('target') });
    if (url.pathname === '/state/scan-speed') emit({ scan_interval_ms: Number(url.searchParams.get('scan_interval_ms')) });
    if (url.pathname === '/vision/learning') emit({ learning_enabled: url.searchParams.get('enabled') === 'true' });
    if (url.pathname === '/emergency/clear') emit({ emergency_active: false, interaction_mode: 'EXPLORE' });
    await route.fulfill({ json: state });
  });
  await page.addInitScript(({ serial, theme, cameraError, homeFailure }) => {
    if (theme) localStorage.setItem('eyecan.themeMode', theme);
    const win = window as typeof window & {
      mockCameraError?: string; mockVideoTrack?: MediaStreamTrack; serialWrites: string[];
      serialReject?: boolean; serialDisconnect?: () => void; mockVideoTone?: string;
      mockAngle?: (pan: number, tilt: number) => void;
    };
    win.mockCameraError = cameraError;
    const devices = [
      { kind: 'videoinput', deviceId: 'builtin', label: 'FaceTime HD Camera' },
      { kind: 'videoinput', deviceId: 'usb-camera', label: 'USB Room Camera' }
    ];
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => devices });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      if (win.mockCameraError) throw new DOMException('Mock camera unavailable', win.mockCameraError);
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d')!;
      const draw = () => {
        ctx.fillStyle = win.mockVideoTone === 'dark' ? '#171B1A' : '#DAE2DD';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = win.mockVideoTone === 'dark' ? '#303934' : '#ABBDB1';
        ctx.fillRect(0, 500, 1280, 220);
        ctx.fillStyle = '#83968A'; ctx.fillRect(140, 100, 300, 360);
        ctx.fillStyle = '#F3F4EC'; ctx.fillRect(154, 114, 272, 332);
        ctx.fillStyle = '#9DB2A6'; ctx.fillRect(282, 114, 16, 332);
        ctx.fillRect(154, 270, 272, 16);
        ctx.fillStyle = '#596D60'; ctx.fillRect(850, 290, 250, 200);
        ctx.fillStyle = '#EAC4AA'; ctx.fillRect(0, 0, 32, 32);
      };
      draw(); window.setInterval(draw, 100);
      const stream = canvas.captureStream(10);
      win.mockVideoTrack = stream.getVideoTracks()[0];
      return stream;
    } });
    win.serialWrites = [];
    if (!serial) {
      Object.defineProperty(navigator, 'serial', { value: undefined, configurable: true });
      return;
    }
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let menu = 'm';
    let pan = 130, tilt = 55;
    const line = (text: string) => controller.enqueue(new TextEncoder().encode(`${text}\n`));
    win.mockAngle = (nextPan, nextTilt) => { pan = nextPan; tilt = nextTilt; line(`A 0 ${pan * 10} ${tilt * 10}`); };
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      async open() {
        this.readable = new ReadableStream({ start(value) { controller = value; } });
        this.writable = new WritableStream({ write(bytes) {
          const command = new TextDecoder().decode(bytes).trim();
          win.serialWrites.push(command);
          if (/^[QHV] /.test(command)) { line(`A ${command.split(' ')[1]} ${pan * 10} ${tilt * 10}`); return; }
          if (command === 'm') { menu = 'm'; line('========================'); return; }
          if (menu === 'm') { menu = command; return; }
          if (menu === '1' && command === 'c') {
            if (homeFailure === 'silent') return;
            if (homeFailure !== 'wrong-angle') { pan = 90; tilt = 20; }
            line('[중앙 복귀] Pan/Tilt | 계속 입력하거나 m으로 메뉴 복귀');
            return;
          }
          if (win.serialReject) { line('잘못된 입력'); return; }
          if (menu === '2') line(`서보모터 이동 완료 -> 각도: ${command}`);
          if (menu === '3') line(`조명 밝기 변경 -> Level ${command}`);
          if (menu === '4') line(`선풍기 속도 변경 -> Level ${command}`);
        } });
        line('========================');
      },
      async close() {}
    };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: {
      getPorts: async () => [port], requestPort: async () => port,
      addEventListener: (name: string, callback: () => void) => { if (name === 'disconnect') win.serialDisconnect = callback; },
      removeEventListener: () => { win.serialDisconnect = undefined; }
    } });
  }, options);
  const goToEye = async () => {
    await page.goto('/');
    await page.getByRole('button', { name: '시작하기' }).click();
  };
  const goToCamera = async () => {
    await goToEye();
    await page.getByRole('button', { name: '눈동자 인식 시작' }).click();
    emit({ vision_status: 'RUNNING', face_detected: true, gaze_ready: true });
    await page.getByRole('button', { name: '방 카메라 연결로 이동' }).click();
  };
  const enterRoom = async () => {
    await goToCamera();
    await page.getByRole('button', { name: '외장 카메라 연결', exact: true }).click();
    await expect(page.locator('.room-video')).toBeVisible();
    if (options.serial) await expect(page.locator('.connection-trigger')).toContainText('연결됨');
    if (await page.getByRole('button', { name: '알림 닫기' }).isVisible()) await page.getByRole('button', { name: '알림 닫기' }).click();
  };
  const menu = async (target: string) => {
    emit({ interaction_mode: 'COMMAND', selected_target: target });
    await expect(page.locator('.radial-overlay')).toBeVisible();
  };
  return { emit, requests, goToEye, goToCamera, enterRoom, menu };
}
