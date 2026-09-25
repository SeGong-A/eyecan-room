import { useLayoutEffect, useRef, useState } from 'react';
import type { InteractionMode } from '../types/control';

export function useRotationScanner(
  interactionMode: InteractionMode,
  isPaused: boolean,
  scanIntervalMs: number,
  scanListLength: number,
  menuKey: string
) {
  const [rotationStep, setRotationStep] = useState(0);
  const rotationStepRef = useRef(0);

  useLayoutEffect(() => {
    if (isPaused || interactionMode === 'EXPLORE') {
      rotationStepRef.current = 0;
      setRotationStep(0);
      return;
    }

    rotationStepRef.current = 0;
    setRotationStep(0);
    const timerId = window.setInterval(() => {
      // Keep full revolutions for the animation; selection uses modulo only.
      rotationStepRef.current += 1;
      setRotationStep(rotationStepRef.current);
    }, scanIntervalMs);

    return () => window.clearInterval(timerId);
  }, [interactionMode, isPaused, scanIntervalMs, scanListLength, menuKey]);

  return { rotationStep, rotationStepRef };
}
