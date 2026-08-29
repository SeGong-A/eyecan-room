export type ArduinoStatus = 'UNSUPPORTED' | 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable: WritableStream<Uint8Array> | null;
};

type NavigatorWithSerial = Navigator & {
  serial?: {
    requestPort: () => Promise<SerialPortLike>;
    getPorts: () => Promise<SerialPortLike[]>;
  };
};

export type ArduinoWriteResult = {
  ok: boolean;
  skipped?: boolean;
  command?: string;
  error?: string;
};

const BAUD_RATE = 9600;
const WRITE_DELAY_MS = 80;

let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let lightLevel = 0;
let fanLevel = 0;
let servoAngle = 90;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function serial(): NavigatorWithSerial['serial'] {
  return (navigator as NavigatorWithSerial).serial;
}

export function isArduinoSerialSupported() {
  return Boolean(serial());
}

export function getInitialArduinoStatus(): ArduinoStatus {
  return isArduinoSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED';
}

export async function connectArduino() {
  const serialApi = serial();
  if (!serialApi) {
    throw new Error('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
  }

  port = await serialApi.requestPort();
  await port.open({ baudRate: BAUD_RATE });

  if (!port.writable) {
    throw new Error('Arduino serial writer를 열 수 없습니다');
  }

  writer = port.writable.getWriter();
}

export async function disconnectArduino() {
  try {
    writer?.releaseLock();
    writer = null;
    await port?.close();
  } finally {
    port = null;
  }
}

export function isArduinoConnected() {
  return Boolean(port && writer);
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
      command === 'LIGHT_UP' ? Math.min(10, lightLevel + 2) :
      Math.max(0, lightLevel - 2);
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
      servoAngle;
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

  const encoder = new TextEncoder();
  try {
    for (const line of mapping.sequence) {
      await writer.write(encoder.encode(`${line}\n`));
      await sleep(WRITE_DELAY_MS);
    }
    if (typeof mapping.nextLightLevel === 'number') lightLevel = mapping.nextLightLevel;
    if (typeof mapping.nextFanLevel === 'number') fanLevel = mapping.nextFanLevel;
    if (typeof mapping.nextServoAngle === 'number') servoAngle = mapping.nextServoAngle;
    return { ok: true, command };
  } catch (error) {
    return {
      ok: false,
      command,
      error: error instanceof Error ? error.message : 'Arduino 전송 중 오류가 발생했습니다'
    };
  }
}
