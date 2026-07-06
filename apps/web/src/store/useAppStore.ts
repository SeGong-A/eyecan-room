import { create } from 'zustand';

export type GazeDirection = 'CENTER' | 'LEFT' | 'RIGHT';
export type ScanTarget = 'FAN' | 'TV' | 'CURTAIN';

type AppState = {
  gazeDirection: GazeDirection;
  selectedTarget: ScanTarget;
  isCalibrated: boolean;
  scanStep: number;
  connectionState: 'DISCONNECTED' | 'READY' | 'STREAMING';
  lastBlinkEvent: 'NONE' | 'SHORT' | 'SELECT' | 'CANCEL';
  lastGazePoint: { x: number; y: number };
  setGazeDirection: (direction: GazeDirection) => void;
  setSelectedTarget: (target: ScanTarget) => void;
  setIsCalibrated: (value: boolean) => void;
  setScanStep: (value: number) => void;
  setConnectionState: (value: AppState['connectionState']) => void;
  syncFromServer: (payload: Partial<{
    gaze_direction: GazeDirection;
    selected_target: ScanTarget;
    scan_step: number;
    connection_state: AppState['connectionState'];
    last_blink_event: AppState['lastBlinkEvent'];
    last_gaze_point_x: number;
    last_gaze_point_y: number;
  }>) => void;
};

export const useAppStore = create<AppState>((set) => ({
  gazeDirection: 'CENTER',
  selectedTarget: 'TV',
  isCalibrated: false,
  scanStep: 0,
  connectionState: 'DISCONNECTED',
  lastBlinkEvent: 'NONE',
  lastGazePoint: { x: 0.5, y: 0.5 },
  setGazeDirection: (gazeDirection) => set({ gazeDirection }),
  setSelectedTarget: (selectedTarget) => set({ selectedTarget }),
  setIsCalibrated: (isCalibrated) => set({ isCalibrated }),
  setScanStep: (scanStep) => set({ scanStep }),
  setConnectionState: (connectionState) => set({ connectionState }),
  syncFromServer: (payload) =>
    set((state) => ({
      gazeDirection: payload.gaze_direction ?? state.gazeDirection,
      selectedTarget: payload.selected_target ?? state.selectedTarget,
      scanStep: payload.scan_step ?? state.scanStep,
      connectionState: payload.connection_state ?? state.connectionState,
      lastBlinkEvent: payload.last_blink_event ?? state.lastBlinkEvent,
      lastGazePoint: {
        x: payload.last_gaze_point_x ?? state.lastGazePoint.x,
        y: payload.last_gaze_point_y ?? state.lastGazePoint.y
      }
    }))
}));
