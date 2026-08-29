import type { MutableRefObject } from 'react';
import { gazeSamples } from '../domain/control';
import type { AppState } from '../store/useAppStore';
import type { FullGazeDirection } from '../types/control';

type GazePoint = { x: number; y: number };

type GazeDemoControlsOptions = {
  sendRequest: (url: string) => Promise<boolean>;
  setTrackedGazePoint: (point: GazePoint) => void;
  simulatedGazeDirectionRef: MutableRefObject<FullGazeDirection>;
  store: AppState;
  trackedPointRef: MutableRefObject<GazePoint>;
};

export function useGazeDemoControls({
  sendRequest,
  setTrackedGazePoint,
  simulatedGazeDirectionRef,
  store,
  trackedPointRef
}: GazeDemoControlsOptions) {
  async function postGazeSample(direction: FullGazeDirection) {
    const sample = gazeSamples[direction];
    await sendRequest(`/events/gaze?x=${sample.x}&y=${sample.y}`);
    simulatedGazeDirectionRef.current = direction;
    trackedPointRef.current = sample;
    setTrackedGazePoint(sample);
    store.setGazeDirection(direction);
  }

  async function simulateBlink(durationMs: number) {
    const now = Date.now();
    await sendRequest(`/events/blink?is_closed=true&now_ms=${now}`);
    await sendRequest(`/events/blink?is_closed=false&now_ms=${now + durationMs}`);
  }

  return { postGazeSample, simulateBlink };
}
