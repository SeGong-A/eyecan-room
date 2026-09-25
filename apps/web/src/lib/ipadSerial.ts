type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

type SerialApi = { requestPort(): Promise<SerialPortLike> };

let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let commandId = 0;

function api(): SerialApi | undefined {
  return (navigator as Navigator & { serial?: SerialApi }).serial;
}

export function isIpadSerialSupported() {
  return Boolean(api());
}

export async function connectIpadController(onLine: (line: string) => void) {
  const serial = api();
  if (!serial) throw new Error('Chrome 또는 Edge에서 연결할 수 있습니다');
  port = await serial.requestPort();
  await port.open({ baudRate: 115200 });
  if (!port.writable) throw new Error('iPad 제어 장치의 쓰기 스트림을 열 수 없습니다');
  writer = port.writable.getWriter();
  if (port.readable) {
    reader = port.readable.getReader();
    void (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (reader) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          lines.map((line) => line.trim()).filter(Boolean).forEach(onLine);
        }
      } catch {
        onLine('DISCONNECTED');
      }
    })();
  }
}

export async function disconnectIpadController() {
  if (reader) {
    try { await reader.cancel(); } catch { /* closed */ }
    try { reader.releaseLock(); } catch { /* closed */ }
    reader = null;
  }
  if (writer) {
    try { await writer.close(); } catch { /* closed */ }
    try { writer.releaseLock(); } catch { /* closed */ }
    writer = null;
  }
  if (port) {
    try { await port.close(); } catch { /* closed */ }
    port = null;
  }
}

export async function sendIpadVolume(direction: 'UP' | 'DOWN') {
  if (!writer) return { ok: false, message: 'iPad 제어 장치가 연결되지 않았습니다' };
  commandId += 1;
  const command = `VOL_${direction} ${commandId}`;
  await writer.write(new TextEncoder().encode(`${command}\n`));
  return { ok: true, message: direction === 'UP' ? '볼륨 올리기 신호를 보냈습니다' : '볼륨 내리기 신호를 보냈습니다' };
}
