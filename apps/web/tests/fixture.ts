import { expect, type Page, type WebSocketRoute } from '@playwright/test';

type Options = {
  serial?: boolean;
  theme?: 'light' | 'dark';
  cameraError?: string;
  homeFailure?: 'silent' | 'wrong-angle';
  commandSilence?: boolean;
};

// All camera, serial and API traffic is isolated from the user's running devices.
export async function mockRoom(page: Page, options: Options = {}) {
  const sockets = new Set<WebSocketRoute>();
  const requests: string[] = [];
  const clientMessages: Record<string, unknown>[] = [];
  let state: Record<string, unknown> = {
    connection_state: 'STREAMING', vision_status: 'STOPPED', vision_error: null,
    face_detected: false, gaze_ready: false, scan_interval_ms: 2000,
    interaction_mode: 'EXPLORE', selected_target: 'FAN', learning_enabled: true,
    gaze_error_x: 0.08, gaze_error_y: -0.04, gaze_deadzone: 0.03,
    emergency_active: false, sample_sequence: 1, tracking_session_id: 'mock-ui-session',
    tv: { power: true, channel: 1, volume: 50, mute: false, revision: 0 }
  };
  const emit = (patch: Record<string, unknown>) => {
    state = { ...state, ...patch };
    for (const socket of sockets) socket.send(JSON.stringify(state));
  };
  let blinkSequence = 0;
  const blink = async (event = 'SELECT') => {
    emit({ is_blinking: true });
    await page.waitForTimeout(40);
    emit({ is_blinking: false, blink_sequence: ++blinkSequence, last_blink_event: event });
    await page.waitForTimeout(40);
  };
  await page.routeWebSocket('**/ws/state', (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify(state));
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage(message => { try { clientMessages.push(JSON.parse(message.toString())); } catch { /* Non-JSON client messages are irrelevant here. */ } });
  });
  await page.route(/\/(vision|state|events|emergency|health|tv)(\/|\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/vision/start') emit({ vision_status: 'STARTING', vision_error: null });
    if (url.pathname === '/state/mode') emit({ interaction_mode: url.searchParams.get('mode') });
    if (url.pathname === '/state/target') emit({ selected_target: url.searchParams.get('target') });
    if (url.pathname === '/state/scan-speed') emit({ scan_interval_ms: Number(url.searchParams.get('scan_interval_ms')) });
    if (url.pathname === '/vision/learning') emit({ learning_enabled: url.searchParams.get('enabled') === 'true' });
    if (url.pathname === '/emergency/clear') emit({ emergency_active: false, interaction_mode: 'EXPLORE' });
    if (url.pathname === '/tv/command') {
      const tv = { ...(state.tv as { power: boolean; channel: number; volume: number; mute: boolean; revision: number }) };
      const command = url.searchParams.get('command');
      if (!tv.power && command !== 'POWER_TOGGLE') {
        await route.fulfill({ status: 409, json: { detail: 'TV 전원이 꺼져 있습니다' } });
        return;
      }
      if (command === 'POWER_TOGGLE') tv.power = !tv.power;
      if (command === 'CHANNEL_NEXT') tv.channel = tv.channel % 3 + 1;
      if (command === 'CHANNEL_PREV') tv.channel = (tv.channel + 1) % 3 + 1;
      if (command === 'VOLUME_UP') { tv.volume = Math.min(100, tv.volume + 10); tv.mute = false; }
      if (command === 'VOLUME_DOWN') { tv.volume = Math.max(0, tv.volume - 10); tv.mute = tv.volume === 0; }
      tv.revision += 1;
      emit({ tv, last_command: `TV_${command}` });
      await route.fulfill({ json: { accepted: true, tv } });
      return;
    }
    await route.fulfill({ json: state });
  });
  await page.addInitScript(({ serial, theme, cameraError, homeFailure, commandSilence }) => {
    if (theme) localStorage.setItem('eyecan.themeMode', theme);
    const win = window as typeof window & {
      mockCameraError?: string; mockVideoTrack?: MediaStreamTrack; serialWrites: string[];
      serialReject?: boolean; serialDisconnect?: () => void; mockVideoTone?: string;
      mockAngle?: (pan: number, tilt: number) => void;
      mockHoldFailure?: boolean;
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
          if (command.startsWith('H ') && win.mockHoldFailure) return;
          if (/^[QHV] /.test(command)) { line(`A ${command.split(' ')[1]} ${pan * 10} ${tilt * 10}`); return; }
          if (command === 'm') { menu = 'm'; line('========================'); return; }
          if (menu === 'm') { menu = command; return; }
          if (menu === '1' && command === 'c') {
            if (homeFailure === 'silent') return;
            if (homeFailure !== 'wrong-angle') { pan = 152; tilt = 16; }
            line('[중앙 복귀] Pan/Tilt | 계속 입력하거나 m으로 메뉴 복귀');
            return;
          }
          if (win.serialReject) { line('잘못된 입력'); return; }
          if (commandSilence) return;
          if (menu === '2' && command === 'o') line('커튼 열기 시작');
          if (menu === '2' && command === 'k') line('커튼 닫기 시작');
          if (menu === '2' && command === 's') line('커튼 정지');
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
    if (options.serial) await expect(page.locator('.connection-trigger')).toContainText('연결됨', { timeout: 15_000 });
    if (await page.getByRole('button', { name: '알림 닫기' }).isVisible()) await page.getByRole('button', { name: '알림 닫기' }).click();
  };
  const menu = async (target: string) => {
    emit({ interaction_mode: 'COMMAND', selected_target: target });
    await expect(page.locator('.radial-overlay')).toBeVisible();
  };
  return { emit, blink, requests, clientMessages, goToEye, goToCamera, enterRoom, menu };
}
