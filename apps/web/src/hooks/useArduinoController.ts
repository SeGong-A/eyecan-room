import { useEffect } from 'react';
import {
  commandToArduinoSequence,
  connectArduino,
  disconnectArduino,
  getArduinoLevels,
  isArduinoConnected,
  isArduinoSerialSupported,
  subscribeArduino,
  writeArduinoCommand
} from '../lib/arduinoSerial';
import type { ArduinoWriteResult } from '../lib/arduinoSerial';
import type { AppState } from '../store/useAppStore';

export function useArduinoController(store: AppState, setToast: (message: string) => void) {
  const { setArduinoStatus, setArduinoError, setArduinoLevels, pushArduinoLogLine } = store;

  useEffect(() => {
    setArduinoStatus(isArduinoSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED');
  }, [setArduinoStatus]);

  useEffect(() => {
    const unsubscribe = subscribeArduino((event) => {
      if (event.type === 'line') {
        pushArduinoLogLine(event.line);
        return;
      }
      if (event.type === 'levels') {
        setArduinoLevels(event.levels);
        return;
      }
      if (event.type === 'disconnected') {
        setArduinoStatus('DISCONNECTED');
        setArduinoError(event.reason);
        setToast(event.reason);
      }
    });
    return unsubscribe;
  }, [pushArduinoLogLine, setArduinoLevels, setArduinoStatus, setArduinoError, setToast]);

  async function sendArduinoCommand(command: string): Promise<ArduinoWriteResult> {
    if (!commandToArduinoSequence(command)) {
      store.setLastArduinoCommand(`SKIP:${command}`);
      return { ok: true, skipped: true, command };
    }

    if (!isArduinoSerialSupported()) {
      setArduinoStatus('UNSUPPORTED');
      setArduinoError('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
      return { ok: false, error: 'Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다' };
    }

    if (!isArduinoConnected()) {
      setArduinoStatus('DISCONNECTED');
      setArduinoError('Arduino가 연결되지 않았습니다');
      return { ok: false, error: 'Arduino가 연결되지 않았습니다' };
    }

    const result = await writeArduinoCommand(command);
    store.setLastArduinoCommand(result.skipped ? `SKIP:${command}` : command);
    setArduinoLevels(getArduinoLevels());

    if (result.rejected) {
      setArduinoStatus('CONNECTED');
      setArduinoError(result.error ?? '아두이노가 명령을 거부했습니다');
      return result;
    }

    if (result.ok) {
      setArduinoError(null);
      if (isArduinoConnected()) setArduinoStatus('CONNECTED');
      return result;
    }

    setArduinoStatus(isArduinoConnected() ? 'ERROR' : 'DISCONNECTED');
    setArduinoError(result.error ?? 'Arduino 전송 중 오류가 발생했습니다');
    return result;
  }

  async function connectArduinoFromUi() {
    if (!isArduinoSerialSupported()) {
      setArduinoStatus('UNSUPPORTED');
      setArduinoError('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
      setToast('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
      return;
    }

    try {
      setArduinoStatus('CONNECTING');
      setArduinoError(null);
      await connectArduino();
      setArduinoStatus('CONNECTED');
      setArduinoLevels(getArduinoLevels());
      setToast('Arduino가 연결되었습니다');
    } catch (error) {
      await disconnectArduino();
      setArduinoStatus('ERROR');
      const message = error instanceof Error ? error.message : 'Arduino 연결에 실패했습니다';
      setArduinoError(message);
      setToast(message);
    }
  }

  async function disconnectArduinoFromUi() {
    await disconnectArduino();
    setArduinoStatus(isArduinoSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED');
    setArduinoError(null);
    setArduinoLevels(getArduinoLevels());
    setToast('Arduino 연결을 해제했습니다');
  }

  return { sendArduinoCommand, connectArduinoFromUi, disconnectArduinoFromUi };
}
