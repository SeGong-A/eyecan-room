import { useEffect, useRef } from 'react';
import type { ScanTarget } from '../types/control';

// Keep these values aligned with PAN_HOME_ANGLE and TILT_HOME_ANGLE in the
// integrated Arduino firmware.
export const CAMERA_HOME_PAN = 152;
export const CAMERA_HOME_TILT = 16;
export const DIRECTION_ENTER_DEGREES = 9;
export const DIRECTION_EXIT_DEGREES = 5;
// Tilt is clamped at 10 degrees in firmware. The measured 16-degree home
// therefore needs a smaller threshold than Pan so the LIGHT zone remains reachable.
export const TILT_ENTER_DEGREES = 6;
export const TILT_EXIT_DEGREES = 4;
export const TV_HOME_PAN_DEGREES = 10;
export const TV_HOME_TILT_DEGREES = 8;
const HOLD_MS = 500;

export function cameraDirectionTarget(
  pan: number,
  tilt: number,
  panThreshold = DIRECTION_ENTER_DEGREES,
  tiltThreshold = TILT_ENTER_DEGREES
): ScanTarget | null {
  const panOffset = pan - CAMERA_HOME_PAN;
  const tiltOffset = tilt - CAMERA_HOME_TILT;

  // The room camera is mounted upside down and its video is rotated 180deg.
  // On the installed rig a lower servo angle moves the corrected view upward.
  // The upper zone takes precedence so expanding TV does not hide LIGHT.
  if (tiltOffset <= -tiltThreshold) return 'LIGHT';
  if (Math.abs(panOffset) <= TV_HOME_PAN_DEGREES && Math.abs(tiltOffset) <= TV_HOME_TILT_DEGREES) return 'TV';
  if (panOffset <= -panThreshold) return 'CURTAIN';
  if (panOffset >= panThreshold) return 'FAN';
  return null;
}

export function useCameraDirectionTarget(
  pan: number,
  tilt: number,
  enabled: boolean,
  activeTarget: ScanTarget | null,
  onTargetChange: (target: ScanTarget | null) => void
) {
  const candidateRef = useRef<ScanTarget | null>(null);
  const sinceRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      candidateRef.current = null;
      onTargetChange(null);
      return;
    }

    if (activeTarget) {
      const exitTarget = cameraDirectionTarget(pan, tilt, DIRECTION_EXIT_DEGREES, TILT_EXIT_DEGREES);
      if (exitTarget === activeTarget) return;
      onTargetChange(null);
    }

    const candidate = cameraDirectionTarget(pan, tilt);
    if (candidate !== candidateRef.current) {
      candidateRef.current = candidate;
      sinceRef.current = performance.now();
    }
    if (!candidate) return;

    const remaining = Math.max(0, HOLD_MS - (performance.now() - sinceRef.current));
    const timer = window.setTimeout(() => onTargetChange(candidate), remaining);
    return () => window.clearTimeout(timer);
  }, [activeTarget, enabled, onTargetChange, pan, tilt]);
}
