import { create } from 'zustand';

export type GazeDirection = 'CENTER' | 'LEFT' | 'RIGHT';
export type FullGazeDirection = GazeDirection | 'UP' | 'DOWN';
export type ScanTarget = 'FAN' | 'LIGHT' | 'TV' | 'CURTAIN' | 'WINDOW';
export type InteractionMode = 'EXPLORE' | 'TARGET_CHOICE' | 'COMMAND' | 'SETTINGS' | 'SETTINGS_SUBMENU';
export type ThemeMode = 'light' | 'dark';
export type SettingsMenu = 'ROOT' | 'SCAN_SPEED' | 'THEME';

const storedScanInterval = Number(window.localStorage.getItem('eyecan.scanIntervalMs'));
const initialScanIntervalMs = Number.isFinite(storedScanInterval) && storedScanInterval >= 1000 && storedScanInterval <= 5000
  ? storedScanInterval
  : 2000;
const storedThemeMode = window.localStorage.getItem('eyecan.themeMode');
const initialThemeMode: ThemeMode = storedThemeMode === 'dark' ? 'dark' : 'light';

type AppState = {
  gazeDirection: FullGazeDirection;
  selectedTarget: ScanTarget;
  interactionMode: InteractionMode;
  isCalibrated: boolean;
  isPaused: boolean;
  scanIntervalMs: number;
  themeMode: ThemeMode;
  settingsMenu: SettingsMenu;
  scanStep: number;
  connectionState: 'DISCONNECTED' | 'READY' | 'STREAMING';
  lastBlinkEvent: 'NONE' | 'SHORT' | 'SELECT' | 'CANCEL';
  blinkSequence: number;
  lastGazePoint: { x: number; y: number };
  lastCommand: string;
  visionStatus: 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';
  visionError: string | null;
  faceDetected: boolean;
  eyeAspectRatio: number;
  setGazeDirection: (direction: FullGazeDirection) => void;
  setSelectedTarget: (target: ScanTarget) => void;
  setInteractionMode: (mode: InteractionMode) => void;
  setIsCalibrated: (value: boolean) => void;
  setIsPaused: (value: boolean) => void;
  setScanIntervalMs: (value: number) => void;
  setThemeMode: (value: ThemeMode) => void;
  setSettingsMenu: (value: SettingsMenu) => void;
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
    vision_status: AppState['visionStatus'];
    vision_error: string | null;
    face_detected: boolean;
    eye_aspect_ratio: number;
  }>) => void;
};

export const useAppStore = create<AppState>((set) => ({
  gazeDirection: 'CENTER',
  selectedTarget: 'TV',
  interactionMode: 'EXPLORE',
  isCalibrated: false,
  isPaused: false,
  scanIntervalMs: initialScanIntervalMs,
  themeMode: initialThemeMode,
  settingsMenu: 'ROOT',
  scanStep: 0,
  connectionState: 'DISCONNECTED',
  lastBlinkEvent: 'NONE',
  blinkSequence: 0,
  lastGazePoint: { x: 0.5, y: 0.5 },
  lastCommand: 'NONE',
  visionStatus: 'STOPPED',
  visionError: null,
  faceDetected: false,
  eyeAspectRatio: 0,
  setGazeDirection: (gazeDirection) => set({ gazeDirection }),
  setSelectedTarget: (selectedTarget) => set({ selectedTarget }),
  setInteractionMode: (interactionMode) => set({ interactionMode, scanStep: 0 }),
  setIsCalibrated: (isCalibrated) => set({ isCalibrated }),
  setIsPaused: (isPaused) => set({ isPaused }),
  setScanIntervalMs: (scanIntervalMs) => {
    window.localStorage.setItem('eyecan.scanIntervalMs', String(scanIntervalMs));
    set({ scanIntervalMs });
  },
  setThemeMode: (themeMode) => {
    window.localStorage.setItem('eyecan.themeMode', themeMode);
    set({ themeMode });
  },
  setSettingsMenu: (settingsMenu) => set({ settingsMenu }),
  setScanStep: (scanStep) =>
    set((state) => ({
      scanStep: typeof scanStep === 'function' ? scanStep(state.scanStep) : scanStep
    })),
  setConnectionState: (connectionState) => set({ connectionState }),
  syncFromServer: (payload) =>
    set((state) => {
      const serverInteractionMode = payload.interaction_mode ?? state.interactionMode;
      const interactionMode =
        state.interactionMode !== 'EXPLORE' && serverInteractionMode === 'EXPLORE'
          ? state.interactionMode
          : serverInteractionMode;
      return {
        gazeDirection: payload.gaze_direction ?? state.gazeDirection,
        selectedTarget: payload.selected_target ?? state.selectedTarget,
        interactionMode,
        isCalibrated: payload.is_calibrated ?? state.isCalibrated,
        isPaused: payload.is_paused ?? state.isPaused,
        scanIntervalMs: payload.scan_interval_ms ?? state.scanIntervalMs,
        scanStep: interactionMode === 'EXPLORE' ? payload.scan_step ?? state.scanStep : state.scanStep,
        connectionState: payload.connection_state ?? state.connectionState,
        lastBlinkEvent: payload.last_blink_event ?? state.lastBlinkEvent,
        blinkSequence: payload.blink_sequence ?? state.blinkSequence,
        lastCommand: payload.last_command ?? state.lastCommand,
        visionStatus: payload.vision_status ?? state.visionStatus,
        visionError: payload.vision_error ?? state.visionError,
        faceDetected: payload.face_detected ?? state.faceDetected,
        eyeAspectRatio: payload.eye_aspect_ratio ?? state.eyeAspectRatio,
        lastGazePoint: {
          x: payload.last_gaze_point_x ?? state.lastGazePoint.x,
          y: payload.last_gaze_point_y ?? state.lastGazePoint.y
        }
      };
    })
}));
