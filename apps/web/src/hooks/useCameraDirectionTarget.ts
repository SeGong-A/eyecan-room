import { useEffect, useRef } from 'react';
import type { ScanTarget } from '../types/control';

// Keep these values aligned with PAN_HOME_ANGLE and TILT_HOME_ANGLE in the
// integrated Arduino firmware.
export const CAMERA_HOME_PAN = 90;
export const CAMERA_HOME_TILT = 20;
// The firmware clamps tilt to TILT_MIN_ANGLE=10 (to stop the camera drooping
// too far down), which leaves only a 10 degree window above home (20) to
// reach the LIGHT zone. The enter/exit thresholds must fit inside that
// window or LIGHT becomes permanently unreachable.
export const DIRECTION_ENTER_DEGREES = 9;
export const DIRECTION_EXIT_DEGREES = 5;
const HOLD_MS = 500;

export function cameraDirectionTarget(
  pan: number,
  tilt: number,
  threshold = DIRECTION_ENTER_DEGREES
): ScanTarget | null {
  const panOffset = pan - CAMERA_HOME_PAN;
  const tiltOffset = tilt - CAMERA_HOME_TILT;

  // The room camera is mounted upside down and its video is rotated 180deg.
  // On the installed rig a lower servo angle moves the corrected view upward.
  // The upper zone takes precedence so the light is easy to reach diagonally.
  if (tiltOffset <= -threshold) return 'LIGHT';
  if (panOffset <= -threshold) return 'CURTAIN';
  if (panOffset >= threshold) return 'FAN';
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
      const exitTarget = cameraDirectionTarget(pan, tilt, DIRECTION_EXIT_DEGREES);
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
