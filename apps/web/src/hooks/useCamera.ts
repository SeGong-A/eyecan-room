import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'IDLE' | 'REQUESTING' | 'READY' | 'DENIED' | 'UNAVAILABLE' | 'ERROR';
type CameraFacingMode = 'user' | 'environment';

type CameraDevice = {
  deviceId: string;
  label: string;
};

const BUILT_IN_CAMERA_PATTERN = /facetime|built-in|continuity|iphone|아이폰/i;
const EXTERNAL_CAMERA_STORAGE_KEY = 'eyecan.externalCameraDeviceId';

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useCamera(defaultFacingMode: CameraFacingMode = 'user') {
  // A plain useRef survives only as long as one DOM node does. Setup and room
  // views mount two different <video> elements for the same camera at
  // different times, so we need a callback ref: it fires (and re-attaches the
  // live stream) every time a new element takes over, not just when `status`
  // changes.
  const nodeRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('IDLE');
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [error, setError] = useState<{ name: string; message: string } | null>(null);

  const refreshDevices = useCallback(async (): Promise<CameraDevice[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return [];
    }

    const cameras = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`
      }));
    setDevices(cameras);
    return cameras;
  }, []);

  const disconnect = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (nodeRef.current) {
      nodeRef.current.srcObject = null;
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
    if (nodeRef.current) {
      nodeRef.current.srcObject = null;
    }

    try {
      let targetDeviceId = deviceId;
      if (!targetDeviceId && defaultFacingMode === 'environment') {
        let cameras = await refreshDevices();
        const labelsAreHidden = cameras.length === 0 || cameras.every((camera) => /^Camera \d+$/.test(camera.label));
        if (labelsAreHidden) {
          const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          stopStream(permissionStream);
          cameras = await refreshDevices();
        }

        const storedDeviceId = window.localStorage.getItem(EXTERNAL_CAMERA_STORAGE_KEY);
        const externalCamera = cameras.find((camera) => camera.deviceId === storedDeviceId && !BUILT_IN_CAMERA_PATTERN.test(camera.label))
          ?? cameras.find((camera) => !BUILT_IN_CAMERA_PATTERN.test(camera.label));
        if (!externalCamera) {
          throw new Error('USB 외장 카메라를 찾지 못했습니다. 카메라 연결 상태를 확인해주세요.');
        }
        targetDeviceId = externalCamera.deviceId;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: targetDeviceId
          ? { deviceId: { exact: targetDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: defaultFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;

      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? targetDeviceId ?? '';
      if (defaultFacingMode === 'environment' && activeDeviceId) {
        window.localStorage.setItem(EXTERNAL_CAMERA_STORAGE_KEY, activeDeviceId);
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        streamRef.current = null;
        setStatus('IDLE');
      }, { once: true });
      setSelectedDeviceId(activeDeviceId);
      if (nodeRef.current) {
        nodeRef.current.srcObject = stream;
        await nodeRef.current.play();
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

  // Runs every time a <video> element using this ref mounts (e.g. the
  // SetupFlow preview handing off to the RoomView feed), so the live stream
  // always follows the ref to whichever element is on screen now.
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    nodeRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      void node.play();
    }
  }, []);

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
