import { useEffect, useRef } from 'react';
import type { DevicePositions, ScanTarget } from '../types/control';

const ENTER_TOLERANCE = 15;
const EXIT_TOLERANCE = 20;
const HOLD_MS = 500;

function closestTarget(pan: number, tilt: number, positions: DevicePositions, tolerance: number): ScanTarget | null {
  const candidates = (Object.entries(positions) as [ScanTarget, { pan: number; tilt: number }][]) 
    .filter(([, position]) => Math.abs(pan - position.pan) <= tolerance && Math.abs(tilt - position.tilt) <= tolerance)
    .map(([target, position]) => ({
      target,
      distance: Math.hypot((pan - position.pan) / tolerance, (tilt - position.tilt) / tolerance)
    }))
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return null;
  if (candidates[1] && Math.abs(candidates[0].distance - candidates[1].distance) < 1e-6) return null;
  return candidates[0].target;
}

export function useAngleTarget(
  pan: number,
  tilt: number,
  positions: DevicePositions,
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
      const registered = positions[activeTarget];
      if (registered && Math.abs(pan - registered.pan) <= EXIT_TOLERANCE && Math.abs(tilt - registered.tilt) <= EXIT_TOLERANCE) return;
      onTargetChange(null);
    }
    const candidate = closestTarget(pan, tilt, positions, ENTER_TOLERANCE);
    if (candidate !== candidateRef.current) {
      candidateRef.current = candidate;
      sinceRef.current = performance.now();
      if (!candidate) return;
    }
    if (!candidate) return;
    const remaining = Math.max(0, HOLD_MS - (performance.now() - sinceRef.current));
    const timer = window.setTimeout(() => onTargetChange(candidate), remaining);
    return () => window.clearTimeout(timer);
  }, [activeTarget, enabled, onTargetChange, pan, positions, tilt]);
}
