import { useEffect } from 'react';
import {
  commandToArduinoSequence,
  connectArduino,
  connectGrantedArduino,
  disconnectArduino,
  getArduinoLevels,
  isArduinoConnected,
  isArduinoSerialSupported,
  subscribeArduino,
  writeArduinoCommand
} from '../lib/arduinoSerial';
import type { ArduinoWriteResult } from '../lib/arduinoSerial';
import type { AppState } from '../store/useAppStore';
import type { Notify } from '../types/control';

export function useArduinoController(store: AppState, setToast: Notify) {
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
      if (event.type === 'motion-protocol') {
        store.setMotionProtocolReady(event.ready);
        setArduinoError(event.error ?? null);
        return;
      }
      if (event.type === 'disconnected') {
        setArduinoStatus('DISCONNECTED');
        store.setMotionProtocolReady(false);
        setArduinoError(event.reason);
        setToast(event.reason, 'error');
      }
    });
    return unsubscribe;
  }, [pushArduinoLogLine, setArduinoLevels, setArduinoStatus, setArduinoError, setToast]);

  useEffect(() => {
    const releaseSerialPort = () => {
      if (isArduinoConnected()) void disconnectArduino();
    };
    window.addEventListener('pagehide', releaseSerialPort);
    return () => {
      window.removeEventListener('pagehide', releaseSerialPort);
      releaseSerialPort();
    };
  }, []);

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
      setToast('Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다', 'error');
      return;
    }

    try {
      setArduinoStatus('CONNECTING');
      store.setMotionProtocolReady(false);
      setArduinoError(null);
      await connectArduino();
      setArduinoStatus('CONNECTED');
      setArduinoLevels(getArduinoLevels());
      setToast('Arduino가 연결되었습니다', 'success');
    } catch (error) {
      await disconnectArduino();
      setArduinoStatus('ERROR');
      const message = error instanceof Error ? error.message : 'Arduino 연결에 실패했습니다';
      setArduinoError(message);
      setToast(message, 'error');
    }
  }

  async function autoConnectGrantedArduino() {
    if (!isArduinoSerialSupported() || isArduinoConnected()) {
      if (isArduinoConnected()) {
        setArduinoStatus('CONNECTED');
        setArduinoLevels(getArduinoLevels());
      }
      return isArduinoConnected();
    }

    try {
      setArduinoStatus('CONNECTING');
      store.setMotionProtocolReady(false);
      setArduinoError(null);
      const connected = await connectGrantedArduino();
      if (!connected) {
        setArduinoStatus('DISCONNECTED');
        setArduinoError('최초 1회는 Arduino 연결 버튼에서 포트를 선택해주세요');
        return false;
      }
      setArduinoStatus('CONNECTED');
      setArduinoLevels(getArduinoLevels());
      setToast('Arduino가 자동으로 연결되었습니다', 'success');
      return true;
    } catch (error) {
      await disconnectArduino();
      setArduinoStatus('ERROR');
      const message = error instanceof Error ? error.message : 'Arduino 자동 연결에 실패했습니다';
      setArduinoError(message);
      setToast(message, 'error');
      return false;
    }
  }

  async function disconnectArduinoFromUi() {
    await disconnectArduino();
    store.setMotionProtocolReady(false);
    setArduinoStatus(isArduinoSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED');
    setArduinoError(null);
    setArduinoLevels(getArduinoLevels());
    setToast('Arduino 연결을 해제했습니다');
  }

  return { sendArduinoCommand, connectArduinoFromUi, autoConnectGrantedArduino, disconnectArduinoFromUi };
}
