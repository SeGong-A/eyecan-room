import type { ArduinoLevels, ArduinoStatus } from '../types/control';

export type { ArduinoLevels, ArduinoStatus } from '../types/control';

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

type SerialLike = {
  requestPort: () => Promise<SerialPortLike>;
  getPorts: () => Promise<SerialPortLike[]>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

type NavigatorWithSerial = Navigator & { serial?: SerialLike };

export type ArduinoWriteResult = {
  ok: boolean;
  skipped?: boolean;
  command?: string;
  ack?: string;
  rejected?: boolean;
  error?: string;
};

export type ArduinoEvent =
  | { type: 'line'; line: string }
  | { type: 'levels'; levels: Partial<ArduinoLevels> }
  | { type: 'rejected'; message: string }
  | { type: 'motion-protocol'; ready: boolean; error?: string }
  | { type: 'disconnected'; reason: string };

type ArduinoListener = (event: ArduinoEvent) => void;

const BAUD_RATE = 9600;
const WRITE_DELAY_MS = 90;
const ACK_WAIT_MS = 260;
const MOTION_ACK_TIMEOUT_MS = 250;
const MAX_RECENT_LINES = 40;

let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let readLoop: Promise<void> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();
let disconnectListenerAttached = false;
let recentLines: string[] = [];
let motionCommandId = 0;
let motionProtocolReady = false;
let pendingVelocity: { panDegPerSecond: number; tiltDegPerSecond: number } | null = null;
let velocityPump: Promise<void> | null = null;
let connectionPromise: Promise<void> | null = null;

type MotionAck = { pan: number; tilt: number };
const motionAckWaiters = new Map<number, {
  resolve: (ack: MotionAck) => void;
  reject: (error: Error) => void;
  timeoutId: number;
}>();

const levels: ArduinoLevels = { light: 0, fan: 0, pan: 90, tilt: 90, servo: 90 };
const listeners = new Set<ArduinoListener>();

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForBoardStartup(timeoutMs = 3500) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (recentLines.some((line) => /^={20,}$/.test(line))) return;
    await sleep(50);
  }
}

function serial(): SerialLike | undefined {
  return (navigator as NavigatorWithSerial).serial;
}

export function isArduinoSerialSupported() {
  return Boolean(serial());
}

export function getInitialArduinoStatus(): ArduinoStatus {
  return isArduinoSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED';
}

export function isArduinoConnected() {
  return Boolean(port && writer);
}

export function isMotionProtocolReady() {
  return motionProtocolReady;
}

export function getArduinoLevels(): ArduinoLevels {
  return { ...levels };
}

export function subscribeArduino(listener: ArduinoListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: ArduinoEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* a listener throwing must not break the serial pipeline */
    }
  }
}

function resetLevels() {
  levels.light = 0;
  levels.fan = 0;
  levels.pan = 90;
  levels.tilt = 90;
  levels.servo = 90;
}

function describeOpenError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/no port selected/i.test(message)) {
    return new Error('선택된 포트가 없습니다. 목록에서 아두이노 포트를 선택해주세요.');
  }
  if (/in use|already open|failed to open serial port|access denied|the device/i.test(message)) {
    return new Error('시리얼 포트를 열지 못했습니다. 다른 프로그램(예: Arduino IDE 시리얼 모니터)이 포트를 사용 중일 수 있습니다.');
  }
  return error instanceof Error ? error : new Error(message);
}

function handleLine(line: string) {
  recentLines.push(line);
  if (recentLines.length > MAX_RECENT_LINES) {
    recentLines = recentLines.slice(-MAX_RECENT_LINES);
  }
  emit({ type: 'line', line });

  const motionAck = line.match(/^A\s+(\d+)\s+(-?\d+)\s+(-?\d+)$/);
  if (motionAck) {
    const commandId = Number(motionAck[1]);
    levels.pan = Number(motionAck[2]) / 10;
    levels.tilt = Number(motionAck[3]) / 10;
    emit({ type: 'levels', levels: { pan: levels.pan, tilt: levels.tilt } });
    const waiter = motionAckWaiters.get(commandId);
    if (waiter) {
      window.clearTimeout(waiter.timeoutId);
      motionAckWaiters.delete(commandId);
      waiter.resolve({ pan: levels.pan, tilt: levels.tilt });
    }
    return;
  }

  const motionError = line.match(/^E\s+(\d+)\s+(.+)$/);
  if (motionError) {
    const commandId = Number(motionError[1]);
    const waiter = motionAckWaiters.get(commandId);
    if (waiter) {
      window.clearTimeout(waiter.timeoutId);
      motionAckWaiters.delete(commandId);
      waiter.reject(new Error(`Arduino motion error: ${motionError[2]}`));
    }
    emit({ type: 'rejected', message: line });
    return;
  }

  const panTilt = line.match(/Pan:\s*(-?\d+)\s*Tilt:\s*(-?\d+)/);
  if (panTilt) {
    levels.pan = Number(panTilt[1]);
    levels.tilt = Number(panTilt[2]);
    emit({ type: 'levels', levels: { pan: levels.pan, tilt: levels.tilt } });
  }

  const lightMenu = line.match(/조명[^\d]*현재\s*단계:\s*(\d+)/);
  if (lightMenu) {
    levels.light = Number(lightMenu[1]);
    emit({ type: 'levels', levels: { light: levels.light } });
  }
  const fanMenu = line.match(/선풍기[^\d]*현재\s*단계:\s*(\d+)/);
  if (fanMenu) {
    levels.fan = Number(fanMenu[1]);
    emit({ type: 'levels', levels: { fan: levels.fan } });
  }

  const lightChange = line.match(/조명 밝기 변경 -> Level\s*(\d+)/);
  if (lightChange) {
    levels.light = Number(lightChange[1]);
    emit({ type: 'levels', levels: { light: levels.light } });
  }
  const fanChange = line.match(/선풍기 속도 변경 -> Level\s*(\d+)/);
  if (fanChange) {
    levels.fan = Number(fanChange[1]);
    emit({ type: 'levels', levels: { fan: levels.fan } });
  }
  const servoMove = line.match(/서보모터 이동 완료 -> 각도:\s*(-?\d+)/);
  if (servoMove) {
    levels.servo = Number(servoMove[1]);
    emit({ type: 'levels', levels: { servo: levels.servo } });
  }

  if (/^이미 .*이동했습니다|잘못된 입력|각도는 0~180|중 입력하세요/.test(line)) {
    emit({ type: 'rejected', message: line });
  }
}

function startReadLoop() {
  if (!port?.readable) return;
  const activeReader = port.readable.getReader();
  reader = activeReader;
  const decoder = new TextDecoder();

  readLoop = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await activeReader.read();
        if (done) break;
        if (value) buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex < 0) break;
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '').trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) handleLine(line);
        }
      }
    } catch {
      /* reader cancelled during disconnect */
    }
  })();
}

async function stopReadLoop() {
  if (reader) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    reader = null;
  }
  if (readLoop) {
    try {
      await readLoop;
    } catch {
      /* ignore */
    }
    readLoop = null;
  }
}

function handleExternalDisconnect() {
  if (!port) return;
  emit({ type: 'disconnected', reason: 'Arduino 연결이 끊어졌습니다 (USB 분리)' });
  void disconnectArduino();
}

function attachDisconnectListener() {
  const serialApi = serial();
  if (!serialApi?.addEventListener || disconnectListenerAttached) return;
  serialApi.addEventListener('disconnect', handleExternalDisconnect);
  disconnectListenerAttached = true;
}

function detachDisconnectListener() {
  const serialApi = serial();
  if (serialApi?.removeEventListener && disconnectListenerAttached) {
    serialApi.removeEventListener('disconnect', handleExternalDisconnect);
  }
  disconnectListenerAttached = false;
}

function enqueueWrite(lines: string[], delayMs = WRITE_DELAY_MS): Promise<void> {
  const run = async () => {
    if (!writer) throw new Error('Arduino가 연결되지 않았습니다');
    const encoder = new TextEncoder();
    for (const line of lines) {
      await writer.write(encoder.encode(`${line}\n`));
      if (delayMs > 0) await sleep(delayMs);
    }
  };
  const result = writeChain.then(run, run);
  writeChain = result.catch(() => {});
  return result;
}

function waitForMotionAck(commandId: number): Promise<MotionAck> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      motionAckWaiters.delete(commandId);
      reject(new Error('Arduino motion ACK timeout'));
    }, MOTION_ACK_TIMEOUT_MS);
    motionAckWaiters.set(commandId, { resolve, reject, timeoutId });
  });
}

async function sendMotionLine(lineFactory: (commandId: number) => string): Promise<MotionAck> {
  if (!writer) throw new Error('Arduino가 연결되지 않았습니다');
  const commandId = ++motionCommandId;
  const ackPromise = waitForMotionAck(commandId);
  try {
    await enqueueWrite([lineFactory(commandId)], 0);
    return await ackPromise;
  } catch (error) {
    const waiter = motionAckWaiters.get(commandId);
    if (waiter) {
      window.clearTimeout(waiter.timeoutId);
      motionAckWaiters.delete(commandId);
    }
    // The promise may have rejected first; mark it handled before propagating.
    void ackPromise.catch(() => {});
    throw error;
  }
}

export async function queryMotionState(): Promise<MotionAck> {
  const ack = await sendMotionLine((commandId) => `Q ${commandId}`);
  motionProtocolReady = true;
  emit({ type: 'motion-protocol', ready: true });
  return ack;
}

export function queueGazeVelocity(panDegPerSecond: number, tiltDegPerSecond: number) {
  pendingVelocity = { panDegPerSecond, tiltDegPerSecond };
  if (velocityPump) return;
  velocityPump = (async () => {
    while (pendingVelocity && writer && motionProtocolReady) {
      const velocity = pendingVelocity;
      pendingVelocity = null;
      const pan10 = Math.round(Math.max(-30, Math.min(30, velocity.panDegPerSecond)) * 10);
      const tilt10 = Math.round(Math.max(-30, Math.min(30, velocity.tiltDegPerSecond)) * 10);
      try {
        await sendMotionLine((commandId) => `V ${commandId} ${pan10} ${tilt10}`);
      } catch (error) {
        motionProtocolReady = false;
        pendingVelocity = null;
        emit({ type: 'motion-protocol', ready: false, error: error instanceof Error ? error.message : '속도 명령 오류' });
      }
    }
  })().finally(() => {
    velocityPump = null;
    if (pendingVelocity && writer && motionProtocolReady) queueGazeVelocity(pendingVelocity.panDegPerSecond, pendingVelocity.tiltDegPerSecond);
  });
}

export async function holdGazeMotion(): Promise<boolean> {
  pendingVelocity = null;
  if (!writer || !motionProtocolReady) return false;
  try {
    await sendMotionLine((commandId) => `H ${commandId}`);
    return true;
  } catch (error) {
    motionProtocolReady = false;
    emit({ type: 'motion-protocol', ready: false, error: error instanceof Error ? error.message : '정지 명령 오류' });
    return false;
  }
}

async function openArduinoPort(selected: SerialPortLike): Promise<void> {
  if (isArduinoConnected()) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await selected.open({ baudRate: BAUD_RATE });
    } catch (error) {
      throw describeOpenError(error);
    }

    port = selected;
    recentLines = [];

    if (!port.writable) {
      await disconnectArduino();
      throw new Error('Arduino 쓰기 스트림을 열 수 없습니다');
    }
    writer = port.writable.getWriter();

    startReadLoop();
    attachDisconnectListener();

    // Opening an Uno resets it. Its UTF-8 startup menu is long at 9600 baud,
    // so begin the strict 250ms motion ACK window only after that menu ends.
    await waitForBoardStartup();
    try {
      await queryMotionState();
      await holdGazeMotion();
    } catch {
      motionProtocolReady = false;
      emit({
        type: 'motion-protocol',
        ready: false,
        error: '팬틸트 속도 프로토콜을 확인하지 못했습니다. 최신 Arduino 펌웨어를 업로드해주세요.'
      });
    }
    await enqueueWrite(['m']);
  })();

  try {
    await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}

export async function connectGrantedArduino(): Promise<boolean> {
  const serialApi = serial();
  if (!serialApi) return false;
  if (isArduinoConnected()) return true;
  if (connectionPromise) {
    await connectionPromise;
    return isArduinoConnected();
  }

  const granted = await serialApi.getPorts();
  if (granted.length !== 1) return false;
  await openArduinoPort(granted[0]);
  return true;
}

export async function connectArduino(): Promise<void> {
  const serialApi = serial();
  if (!serialApi) {
    throw new Error('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
  }
  if (isArduinoConnected()) return;
  if (connectionPromise) return connectionPromise;

  let selected: SerialPortLike | null = null;
  try {
    const granted = await serialApi.getPorts();
    if (granted.length === 1) selected = granted[0];
  } catch {
    /* getPorts unavailable - fall back to an explicit port pick */
  }
  if (!selected) selected = await serialApi.requestPort();
  await openArduinoPort(selected);
}

export async function disconnectArduino(): Promise<void> {
  pendingVelocity = null;
  motionProtocolReady = false;
  for (const waiter of motionAckWaiters.values()) {
    window.clearTimeout(waiter.timeoutId);
    waiter.reject(new Error('Arduino 연결이 종료되었습니다'));
  }
  motionAckWaiters.clear();
  detachDisconnectListener();
  await stopReadLoop();

  if (writer) {
    try {
      await writer.close();
    } catch {
      /* ignore */
    }
    try {
      writer.releaseLock();
    } catch {
      /* ignore */
    }
    writer = null;
  }

  if (port) {
    try {
      await port.close();
    } catch {
      /* ignore */
    }
    port = null;
  }

  writeChain = Promise.resolve();
  resetLevels();
}

type CommandMapping = {
  sequence: string[];
  nextLightLevel?: number;
  nextFanLevel?: number;
  nextServoAngle?: number;
};

export function commandToArduinoSequence(command: string): CommandMapping | null {
  if (command === 'LIGHT_ON' || command === 'LIGHT_OFF' || command === 'LIGHT_UP' || command === 'LIGHT_DOWN') {
    const nextLightLevel =
      command === 'LIGHT_ON' ? 10 :
      command === 'LIGHT_OFF' ? 0 :
      command === 'LIGHT_UP' ? Math.min(10, levels.light + 2) :
      Math.max(0, levels.light - 2);
    return { sequence: ['m', '3', String(nextLightLevel)], nextLightLevel };
  }

  if (command === 'FAN_ON' || command === 'FAN_OFF' || command === 'FAN_LOW' || command === 'FAN_MID' || command === 'FAN_HIGH') {
    const nextFanLevel =
      command === 'FAN_OFF' ? 0 :
      command === 'FAN_LOW' ? 3 :
      command === 'FAN_MID' ? 6 :
      10;
    return { sequence: ['m', '4', String(nextFanLevel)], nextFanLevel };
  }

  if (command === 'CURTAIN_OPEN' || command === 'CURTAIN_CLOSE' || command === 'CURTAIN_STOP' ||
      command === 'WINDOW_OPEN' || command === 'WINDOW_CLOSE' || command === 'WINDOW_STOP') {
    const nextServoAngle =
      command === 'CURTAIN_OPEN' || command === 'WINDOW_OPEN' ? 180 :
      command === 'CURTAIN_CLOSE' || command === 'WINDOW_CLOSE' ? 0 :
      levels.servo;
    return { sequence: ['m', '2', String(nextServoAngle)], nextServoAngle };
  }

  // CAM_LEFT/RIGHT/UP/DOWN은 선택적으로 ":<도수>" 접미사를 받는다(예: 'CAM_LEFT:12') —
  // useGazePanTilt.ts가 시선이 중심에서 벗어난 정도에 비례한 스텝 크기를 실어 보낼 때 씀.
  // 접미사가 없으면 문자 하나만 보내 펌웨어 기본 STEP_SIZE(45도)를 그대로 쓴다 —
  // 기존 CAM_LEFT 등 호출과 100% 하위 호환.
  const camMatch = command.match(/^CAM_(LEFT|RIGHT|UP|DOWN)(?::(\d+))?$/);
  if (camMatch) {
    const [, direction, degrees] = camMatch;
    const char = { LEFT: 'a', RIGHT: 'd', UP: 'w', DOWN: 's' }[direction as 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'];
    return { sequence: ['m', '1', degrees ? `${char} ${degrees}` : char] };
  }
  return null;
}

export async function writeArduinoCommand(command: string): Promise<ArduinoWriteResult> {
  const mapping = commandToArduinoSequence(command);
  if (!mapping) return { ok: true, skipped: true, command };
  if (!writer) return { ok: false, command, error: 'Arduino가 연결되지 않았습니다' };

  const rejection = { message: null as string | null };
  const unsubscribe = subscribeArduino((event) => {
    if (event.type === 'rejected') rejection.message = event.message;
  });

  try {
    await enqueueWrite(mapping.sequence);

    if (typeof mapping.nextLightLevel === 'number') levels.light = mapping.nextLightLevel;
    if (typeof mapping.nextFanLevel === 'number') levels.fan = mapping.nextFanLevel;
    if (typeof mapping.nextServoAngle === 'number') levels.servo = mapping.nextServoAngle;

    // Give the sketch a moment to echo an acknowledgement or a rejection line.
    await sleep(ACK_WAIT_MS);

    if (rejection.message) {
      return { ok: true, command, rejected: true, error: rejection.message };
    }
    return { ok: true, command, ack: recentLines[recentLines.length - 1] };
  } catch (error) {
    return {
      ok: false,
      command,
      error: error instanceof Error ? error.message : 'Arduino 전송 중 오류가 발생했습니다'
    };
  } finally {
    unsubscribe();
  }
}
