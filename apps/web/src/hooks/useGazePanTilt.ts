import { useEffect, useRef } from 'react';
import { holdGazeMotion, queueGazeVelocity } from '../lib/arduinoSerial';
import type { ArduinoLevels, ArduinoStatus } from '../types/control';

const SEND_INTERVAL_MS = 100;
const SAMPLE_STALE_MS = 250;
const MAX_DEGREES_PER_SECOND = 30;
const WALL_HOLD_MS = 1500;

type GazeMotionInput = {
  omega: { x: number; y: number };
  sampleSequence: number;
  trackingSessionId: string;
  faceDetected: boolean;
  gazeReady: boolean;
  calibrationActive: boolean;
  isBlinking: boolean;
  saccadeBraking: boolean;
  connectionState: 'DISCONNECTED' | 'READY' | 'STREAMING';
  arduinoStatus: ArduinoStatus;
  motionProtocolReady: boolean;
  panSign: 1 | -1;
  tiltSign: 1 | -1;
  levels: ArduinoLevels;
  isPaused: boolean;
  isActive: boolean;
};

function toDegreesPerSecond(omega: number, sign: 1 | -1) {
  const degrees = omega * (180 / Math.PI) * sign;
  return Math.max(-MAX_DEGREES_PER_SECOND, Math.min(MAX_DEGREES_PER_SECOND, degrees));
}

export function useGazePanTilt(input: GazeMotionInput) {
  const inputRef = useRef(input);
  const lastSequenceRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const sessionRef = useRef('');
  const holdingRef = useRef(true);
  const wallSinceRef = useRef(0);
  const recenterRequestedRef = useRef(false);
  const enabledRef = useRef(false);
  const resumeAfterSequenceRef = useRef(input.sampleSequence);

  useEffect(() => {
    inputRef.current = input;
    const enabled = input.isActive && !input.isPaused;
    if (enabled && !enabledRef.current) {
      // Never replay a sample that arrived while a menu or emergency overlay was open.
      resumeAfterSequenceRef.current = input.sampleSequence;
    }
    enabledRef.current = enabled;
    if (input.trackingSessionId !== sessionRef.current) {
      sessionRef.current = input.trackingSessionId;
      lastSequenceRef.current = input.sampleSequence;
      resumeAfterSequenceRef.current = input.sampleSequence;
      lastSampleAtRef.current = performance.now();
      holdingRef.current = true;
      wallSinceRef.current = 0;
      recenterRequestedRef.current = false;
      return;
    }
    if (input.sampleSequence !== lastSequenceRef.current) {
      lastSequenceRef.current = input.sampleSequence;
      lastSampleAtRef.current = performance.now();
    }
  }, [input]);

  useEffect(() => {
    const hold = () => {
      if (!holdingRef.current) void holdGazeMotion();
      holdingRef.current = true;
      wallSinceRef.current = 0;
    };

    const onVisibilityChange = () => {
      if (document.hidden) hold();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const timerId = window.setInterval(() => {
      const current = inputRef.current;
      const validSample = performance.now() - lastSampleAtRef.current <= SAMPLE_STALE_MS;
      const canMove =
        current.isActive &&
        !current.isPaused &&
        current.connectionState === 'STREAMING' &&
        current.arduinoStatus === 'CONNECTED' &&
        current.motionProtocolReady &&
        current.faceDetected &&
        current.gazeReady &&
        current.sampleSequence > resumeAfterSequenceRef.current &&
        !current.calibrationActive &&
        !current.isBlinking &&
        !current.saccadeBraking &&
        validSample &&
        !document.hidden;

      if (!canMove) {
        hold();
        return;
      }

      const panVelocity = toDegreesPerSecond(current.omega.x, current.panSign);
      const tiltVelocity = toDegreesPerSecond(current.omega.y, current.tiltSign);
      if (Math.abs(panVelocity) < 0.1 && Math.abs(tiltVelocity) < 0.1) {
        hold();
        return;
      }

      const atPanWall = (current.levels.pan <= 0.5 && panVelocity < 0) || (current.levels.pan >= 179.5 && panVelocity > 0);
      const atTiltWall = (current.levels.tilt <= 0.5 && tiltVelocity < 0) || (current.levels.tilt >= 179.5 && tiltVelocity > 0);
      if (atPanWall || atTiltWall) {
        if (!holdingRef.current) void holdGazeMotion();
        holdingRef.current = true;
        if (!wallSinceRef.current) wallSinceRef.current = performance.now();
        if (!recenterRequestedRef.current && performance.now() - wallSinceRef.current >= WALL_HOLD_MS) {
          recenterRequestedRef.current = true;
          void fetch('/vision/recenter', { method: 'POST' });
        }
        return;
      }

      wallSinceRef.current = 0;
      recenterRequestedRef.current = false;
      holdingRef.current = false;
      queueGazeVelocity(panVelocity, tiltVelocity);
    }, SEND_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void holdGazeMotion();
    };
  }, []);
}
