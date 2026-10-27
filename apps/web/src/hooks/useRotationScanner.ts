import { useLayoutEffect, useRef, useState } from 'react';
import type { InteractionMode } from '../types/control';

export const ROTATION_TRANSITION_MS = 240;

export function useRotationScanner(
  interactionMode: InteractionMode | 'IDLE' | 'OBJECT_SCAN' | 'REQUEST_SCAN' | 'ENTERING' | 'SPEAKING',
  isPaused: boolean,
  scanIntervalMs: number,
  scanListLength: number,
  menuKey: string
) {
  const [rotationStep, setRotationStep] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const rotationStepRef = useRef(0);
  const isTransitioningRef = useRef(false);
  const transitionTimerRef = useRef(0);
  const remainingRef = useRef(scanIntervalMs);

  useLayoutEffect(() => {
    rotationStepRef.current = 0;
    setRotationStep(0);
    isTransitioningRef.current = false;
    setIsTransitioning(false);
    window.clearTimeout(transitionTimerRef.current);
    remainingRef.current = scanIntervalMs;
  }, [interactionMode, scanListLength, menuKey, scanIntervalMs]);

  useLayoutEffect(() => {
    if (isPaused || ['IDLE', 'EXPLORE', 'ENTERING', 'SPEAKING'].includes(interactionMode)) return;

    let deadline = performance.now() + remainingRef.current;
    let timerId = 0;
    const advance = () => {
      // Keep full revolutions for the animation; selection uses modulo only.
      rotationStepRef.current += 1;
      setRotationStep(rotationStepRef.current);
      isTransitioningRef.current = true;
      setIsTransitioning(true);
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = window.setTimeout(() => {
        isTransitioningRef.current = false;
        setIsTransitioning(false);
      }, ROTATION_TRANSITION_MS);
      remainingRef.current = scanIntervalMs;
      deadline = performance.now() + scanIntervalMs;
      timerId = window.setTimeout(advance, scanIntervalMs);
    };
    timerId = window.setTimeout(advance, remainingRef.current);

    return () => {
      window.clearTimeout(timerId);
      remainingRef.current = Math.max(0, deadline - performance.now());
    };
  }, [interactionMode, isPaused, scanIntervalMs, scanListLength, menuKey]);

  useLayoutEffect(() => () => window.clearTimeout(transitionTimerRef.current), []);

  return { rotationStep, rotationStepRef, isTransitioning, isTransitioningRef };
}
