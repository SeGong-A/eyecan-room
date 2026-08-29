import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'IDLE' | 'REQUESTING' | 'READY' | 'DENIED' | 'UNAVAILABLE' | 'ERROR';
type CameraFacingMode = 'user' | 'environment';

type CameraDevice = {
  deviceId: string;
  label: string;
};

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useCamera(defaultFacingMode: CameraFacingMode = 'user') {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('IDLE');
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [error, setError] = useState<{ name: string; message: string } | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return;
    }

    const cameras = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`
      }));
    setDevices(cameras);
  }, []);

  const disconnect = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus('IDLE');
    setError(null);
  }, []);

  const connect = useCallback(async (deviceId?: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('UNAVAILABLE');
      setError({ name: 'MediaDevicesUnavailable', message: '이 브라우저에서 카메라 API를 사용할 수 없습니다.' });
      return;
    }

    setStatus('REQUESTING');
    setError(null);
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: defaultFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;

      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? '';
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        streamRef.current = null;
        setStatus('IDLE');
      }, { once: true });
      setSelectedDeviceId(activeDeviceId);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setStatus('READY');
      setError(null);
      await refreshDevices();
    } catch (error) {
      stopStream(streamRef.current);
      streamRef.current = null;
      const errorName = error instanceof DOMException ? error.name : 'UnknownError';
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 카메라 연결 오류입니다.';
      setError({ name: errorName, message: errorMessage });
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        setStatus('DENIED');
      } else if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
        setStatus('UNAVAILABLE');
      } else {
        setStatus('ERROR');
      }
    }
  }, [defaultFacingMode, refreshDevices]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    const handleDeviceChange = () => void refreshDevices();
    mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
      stopStream(streamRef.current);
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (status !== 'READY' || !videoRef.current || !streamRef.current) {
      return;
    }

    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play();
  }, [status]);

  return {
    videoRef,
    status,
    devices,
    selectedDeviceId,
    error,
    connect,
    disconnect
  };
}
