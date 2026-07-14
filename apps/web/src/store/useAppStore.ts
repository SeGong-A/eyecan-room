import { create } from 'zustand';

export type GazeDirection = 'CENTER' | 'LEFT' | 'RIGHT';
export type FullGazeDirection = GazeDirection | 'UP' | 'DOWN';
export type ScanTarget = 'FAN' | 'LIGHT' | 'TV' | 'CURTAIN';
export type InteractionMode = 'EXPLORE' | 'COMMAND';

type AppState = {
  gazeDirection: FullGazeDirection;
  selectedTarget: ScanTarget;
  interactionMode: InteractionMode;
  isCalibrated: boolean;
  isPaused: boolean;
  scanIntervalMs: number;
  scanStep: number;
  connectionState: 'DISCONNECTED' | 'READY' | 'STREAMING';
  lastBlinkEvent: 'NONE' | 'SHORT' | 'SELECT' | 'CANCEL';
  blinkSequence: number;
  lastGazePoint: { x: number; y: number };
  lastCommand: string;
  setGazeDirection: (direction: FullGazeDirection) => void;
  setSelectedTarget: (target: ScanTarget) => void;
  setInteractionMode: (mode: InteractionMode) => void;
  setIsCalibrated: (value: boolean) => void;
  setIsPaused: (value: boolean) => void;
  setScanIntervalMs: (value: number) => void;
  setScanStep: (value: number | ((current: number) => number)) => void;
  setConnectionState: (value: AppState['connectionState']) => void;
  syncFromServer: (payload: Partial<{
    gaze_direction: FullGazeDirection;
    selected_target: ScanTarget;
    interaction_mode: InteractionMode;
    is_calibrated: boolean;
    is_paused: boolean;
    scan_interval_ms: number;
    scan_step: number;
    connection_state: AppState['connectionState'];
    last_blink_event: AppState['lastBlinkEvent'];
    blink_sequence: number;
    last_gaze_point_x: number;
    last_gaze_point_y: number;
    last_command: string;
  }>) => void;
};

export const useAppStore = create<AppState>((set) => ({
  gazeDirection: 'CENTER',
  selectedTarget: 'TV',
  interactionMode: 'EXPLORE',
  isCalibrated: false,
  isPaused: false,
  scanIntervalMs: 1200,
  scanStep: 0,
  connectionState: 'DISCONNECTED',
  lastBlinkEvent: 'NONE',
  blinkSequence: 0,
  lastGazePoint: { x: 0.5, y: 0.5 },
  lastCommand: 'NONE',
  setGazeDirection: (gazeDirection) => set({ gazeDirection }),
  setSelectedTarget: (selectedTarget) => set({ selectedTarget }),
  setInteractionMode: (interactionMode) => set({ interactionMode, scanStep: 0 }),
  setIsCalibrated: (isCalibrated) => set({ isCalibrated }),
  setIsPaused: (isPaused) => set({ isPaused }),
  setScanIntervalMs: (scanIntervalMs) => set({ scanIntervalMs }),
  setScanStep: (scanStep) =>
    set((state) => ({
      scanStep: typeof scanStep === 'function' ? scanStep(state.scanStep) : scanStep
    })),
  setConnectionState: (connectionState) => set({ connectionState }),
  syncFromServer: (payload) =>
    set((state) => ({
      gazeDirection: payload.gaze_direction ?? state.gazeDirection,
      selectedTarget: payload.selected_target ?? state.selectedTarget,
      interactionMode: payload.interaction_mode ?? state.interactionMode,
      isCalibrated: payload.is_calibrated ?? state.isCalibrated,
      isPaused: payload.is_paused ?? state.isPaused,
      scanIntervalMs: payload.scan_interval_ms ?? state.scanIntervalMs,
      scanStep: payload.scan_step ?? state.scanStep,
      connectionState: payload.connection_state ?? state.connectionState,
      lastBlinkEvent: payload.last_blink_event ?? state.lastBlinkEvent,
      blinkSequence: payload.blink_sequence ?? state.blinkSequence,
      lastCommand: payload.last_command ?? state.lastCommand,
      lastGazePoint: {
        x: payload.last_gaze_point_x ?? state.lastGazePoint.x,
        y: payload.last_gaze_point_y ?? state.lastGazePoint.y
      }
    }))
}));
