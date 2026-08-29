import { useEffect, useRef, useState } from 'react';
import type { InteractionMode } from '../types/control';

export function useRotationScanner(
  interactionMode: InteractionMode,
  isPaused: boolean,
  scanIntervalMs: number,
  scanListLength: number
) {
  const [rotationStep, setRotationStep] = useState(0);
  const rotationStepRef = useRef(0);

  useEffect(() => {
    rotationStepRef.current = rotationStep;
  }, [rotationStep]);

  useEffect(() => {
    if (isPaused || interactionMode === 'EXPLORE') {
      rotationStepRef.current = 0;
      setRotationStep(0);
      return;
    }

    rotationStepRef.current = 0;
    setRotationStep(0);
    const timerId = window.setInterval(() => {
      setRotationStep((step) => {
        const nextStep = (step + 1) % scanListLength;
        rotationStepRef.current = nextStep;
        return nextStep;
      });
    }, scanIntervalMs);

    return () => window.clearInterval(timerId);
  }, [interactionMode, isPaused, scanIntervalMs, scanListLength]);

  return { rotationStep, rotationStepRef };
}
