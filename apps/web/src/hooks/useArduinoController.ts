import { useEffect } from 'react';
import {
  commandToArduinoSequence,
  connectArduino,
  disconnectArduino,
  isArduinoConnected,
  isArduinoSerialSupported,
  writeArduinoCommand
} from '../lib/arduinoSerial';
import type { AppState } from '../store/useAppStore';

export function useArduinoController(store: AppState, setToast: (message: string) => void) {
  useEffect(() => {
    store.setArduinoStatus(isArduinoSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED');
  }, [store.setArduinoStatus]);

  async function sendArduinoCommand(command: string) {
    if (!commandToArduinoSequence(command)) {
      store.setLastArduinoCommand(`SKIP:${command}`);
      return { ok: true, skipped: true, command };
    }

    if (!isArduinoSerialSupported()) {
      store.setArduinoStatus('UNSUPPORTED');
      store.setArduinoError('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
      return { ok: false, error: 'Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다' };
    }

    const result = await writeArduinoCommand(command);
    store.setLastArduinoCommand(result.skipped ? `SKIP:${command}` : command);
    if (result.ok) {
      store.setArduinoError(null);
      if (isArduinoConnected()) store.setArduinoStatus('CONNECTED');
      return result;
    }

    store.setArduinoStatus(isArduinoConnected() ? 'ERROR' : 'DISCONNECTED');
    store.setArduinoError(result.error ?? 'Arduino 전송 중 오류가 발생했습니다');
    return result;
  }

  async function connectArduinoFromUi() {
    if (!isArduinoSerialSupported()) {
      store.setArduinoStatus('UNSUPPORTED');
      store.setArduinoError('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
      setToast('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다');
      return;
    }

    try {
      store.setArduinoStatus('CONNECTING');
      store.setArduinoError(null);
      await connectArduino();
      store.setArduinoStatus('CONNECTED');
      setToast('Arduino가 연결되었습니다');
    } catch (error) {
      store.setArduinoStatus('ERROR');
      const message = error instanceof Error ? error.message : 'Arduino 연결에 실패했습니다';
      store.setArduinoError(message);
      setToast(message);
    }
  }

  async function disconnectArduinoFromUi() {
    await disconnectArduino();
    store.setArduinoStatus(isArduinoSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED');
    store.setArduinoError(null);
    setToast('Arduino 연결을 해제했습니다');
  }

  return { sendArduinoCommand, connectArduinoFromUi, disconnectArduinoFromUi };
}
