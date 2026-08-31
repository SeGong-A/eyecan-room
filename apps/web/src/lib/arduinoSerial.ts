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
  | { type: 'disconnected'; reason: string };

type ArduinoListener = (event: ArduinoEvent) => void;

const BAUD_RATE = 9600;
const WRITE_DELAY_MS = 90;
const ACK_WAIT_MS = 260;
const MAX_RECENT_LINES = 40;

let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let readLoop: Promise<void> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();
let disconnectListenerAttached = false;
let recentLines: string[] = [];

const levels: ArduinoLevels = { light: 0, fan: 0, pan: 90, tilt: 90, servo: 90 };
const listeners = new Set<ArduinoListener>();

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function enqueueWrite(lines: string[]): Promise<void> {
  const run = async () => {
    if (!writer) throw new Error('Arduino가 연결되지 않았습니다');
    const encoder = new TextEncoder();
    for (const line of lines) {
      await writer.write(encoder.encode(`${line}\n`));
      await sleep(WRITE_DELAY_MS);
    }
  };
  const result = writeChain.then(run, run);
  writeChain = result.catch(() => {});
  return result;
}

export async function connectArduino(): Promise<void> {
  const serialApi = serial();
  if (!serialApi) {
    throw new Error('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
  }

  let selected: SerialPortLike | null = null;
  try {
    const granted = await serialApi.getPorts();
    if (granted.length === 1) selected = granted[0];
  } catch {
    /* getPorts unavailable — fall back to an explicit port pick */
  }
  if (!selected) {
    selected = await serialApi.requestPort();
  }

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

  // Ask the sketch to reprint its menu so we can seed cached levels from the echo
  // instead of assuming a freshly reset 0 / 0 / 90 state.
  try {
    await enqueueWrite(['m']);
  } catch {
    /* non-fatal: the connection is still usable without the initial echo */
  }
}

export async function disconnectArduino(): Promise<void> {
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

  if (command === 'CAM_LEFT') return { sequence: ['m', '1', 'a'] };
  if (command === 'CAM_RIGHT') return { sequence: ['m', '1', 'd'] };
  if (command === 'CAM_UP') return { sequence: ['m', '1', 'w'] };
  if (command === 'CAM_DOWN') return { sequence: ['m', '1', 's'] };
  if (command === 'CAM_STOP') return { sequence: ['m', '1', 'c'] };

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
