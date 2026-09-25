import { create } from 'zustand';
import type {
  ArduinoLevels,
  ArduinoStatus,
  DevicePositions,
  FullGazeDirection,
  InteractionMode,
  ScanTarget,
  SettingsMenu,
  ThemeMode
} from '../types/control';
import type { IpadStatus } from '../types/control';

export type {
  ArduinoLevels,
  ArduinoStatus,
  FullGazeDirection,
  GazeDirection,
  InteractionMode,
  ScanTarget,
  SettingsMenu,
  ThemeMode
} from '../types/control';

const MAX_ARDUINO_LOG_LINES = 8;
const initialArduinoLevels: ArduinoLevels = { light: 0, fan: 0, pan: 90, tilt: 90, servo: 90 };

const storedScanInterval = Number(window.localStorage.getItem('eyecan.scanIntervalMs'));
const initialScanIntervalMs = Number.isFinite(storedScanInterval) && storedScanInterval >= 1000 && storedScanInterval <= 5000
  ? storedScanInterval
  : 2000;
const storedThemeMode = window.localStorage.getItem('eyecan.themeMode');
const initialThemeMode: ThemeMode = storedThemeMode === 'dark' ? 'dark' : 'light';
const storedPositions = window.localStorage.getItem('eyecan.devicePositions');
const initialDevicePositions: DevicePositions = storedPositions ? JSON.parse(storedPositions) : {};

export type AppState = {
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
  gazeOmega: { x: number; y: number };
  lastCommand: string;
  visionStatus: 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';
  visionError: string | null;
  faceDetected: boolean;
  eyeAspectRatio: number;
  gazeReady: boolean;
  learningEnabled: boolean;
  learningUpdateCount: number;
  emergencyActive: boolean;
  emergencySequence: number;
  arduinoStatus: ArduinoStatus;
  arduinoError: string | null;
  lastArduinoCommand: string;
  arduinoLevels: ArduinoLevels;
  arduinoLog: string[];
  hasArduinoAngle: boolean;
  devicePositions: DevicePositions;
  activeAngleTarget: ScanTarget | null;
  ipadStatus: IpadStatus;
  ipadError: string | null;
  ipadBleConnected: boolean;
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
  setArduinoStatus: (value: ArduinoStatus) => void;
  setArduinoError: (value: string | null) => void;
  setLastArduinoCommand: (value: string) => void;
  setArduinoLevels: (value: Partial<ArduinoLevels>) => void;
  pushArduinoLogLine: (line: string) => void;
  registerDevicePosition: (target: ScanTarget, position?: { pan: number; tilt: number }) => void;
  setActiveAngleTarget: (target: ScanTarget | null) => void;
  setIpadStatus: (status: IpadStatus) => void;
  setIpadError: (error: string | null) => void;
  setIpadBleConnected: (connected: boolean) => void;
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
    gaze_omega_x: number;
    gaze_omega_y: number;
    last_command: string;
    vision_status: AppState['visionStatus'];
    vision_error: string | null;
    face_detected: boolean;
    eye_aspect_ratio: number;
    gaze_ready: boolean;
    learning_enabled: boolean;
    learning_update_count: number;
    emergency_active: boolean;
    emergency_sequence: number;
  }>) => void;
};

export const useAppStore = create<AppState>((set) => ({
  gazeDirection: 'CENTER',
  selectedTarget: 'IPAD',
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
  gazeOmega: { x: 0, y: 0 },
  lastCommand: 'NONE',
  visionStatus: 'STOPPED',
  visionError: null,
  faceDetected: false,
  eyeAspectRatio: 0,
  gazeReady: false,
  learningEnabled: true,
  learningUpdateCount: 0,
  emergencyActive: false,
  emergencySequence: 0,
  arduinoStatus: 'DISCONNECTED',
  arduinoError: null,
  lastArduinoCommand: 'NONE',
  arduinoLevels: initialArduinoLevels,
  arduinoLog: [],
  hasArduinoAngle: false,
  devicePositions: initialDevicePositions,
  activeAngleTarget: null,
  ipadStatus: 'DISCONNECTED',
  ipadError: null,
  ipadBleConnected: false,
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
  setArduinoStatus: (arduinoStatus) => set({ arduinoStatus }),
  setArduinoError: (arduinoError) => set({ arduinoError }),
  setLastArduinoCommand: (lastArduinoCommand) => set({ lastArduinoCommand }),
  setArduinoLevels: (value) =>
    set((state) => ({
      arduinoLevels: { ...state.arduinoLevels, ...value },
      hasArduinoAngle: state.hasArduinoAngle || typeof value.pan === 'number' || typeof value.tilt === 'number'
    })),
  pushArduinoLogLine: (line) =>
    set((state) => ({ arduinoLog: [...state.arduinoLog, line].slice(-MAX_ARDUINO_LOG_LINES) })),
  registerDevicePosition: (target, position) => set((state) => {
    const devicePositions = {
      ...state.devicePositions,
      [target]: position ?? { pan: state.arduinoLevels.pan, tilt: state.arduinoLevels.tilt }
    };
    window.localStorage.setItem('eyecan.devicePositions', JSON.stringify(devicePositions));
    return { devicePositions };
  }),
  setActiveAngleTarget: (activeAngleTarget) => set({ activeAngleTarget }),
  setIpadStatus: (ipadStatus) => set({ ipadStatus }),
  setIpadError: (ipadError) => set({ ipadError }),
  setIpadBleConnected: (ipadBleConnected) => set({ ipadBleConnected }),
  syncFromServer: (payload) =>
    set((state) => {
      const serverInteractionMode = payload.interaction_mode ?? state.interactionMode;
      const interactionMode =
        state.interactionMode !== 'EXPLORE' && serverInteractionMode === 'EXPLORE'
          ? state.interactionMode
          : serverInteractionMode;
      return {
        gazeDirection: payload.gaze_direction ?? state.gazeDirection,
        selectedTarget: payload.selected_target && payload.selected_target in { FAN: 1, LIGHT: 1, IPAD: 1, CURTAIN: 1 }
          ? payload.selected_target
          : state.selectedTarget,
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
        visionError: payload.vision_error !== undefined ? payload.vision_error : state.visionError,
        faceDetected: payload.face_detected ?? state.faceDetected,
        eyeAspectRatio: payload.eye_aspect_ratio ?? state.eyeAspectRatio,
        gazeReady: payload.gaze_ready ?? state.gazeReady,
        learningEnabled: payload.learning_enabled ?? state.learningEnabled,
        learningUpdateCount: payload.learning_update_count ?? state.learningUpdateCount,
        emergencyActive: payload.emergency_active ?? state.emergencyActive,
        emergencySequence: payload.emergency_sequence ?? state.emergencySequence,
        lastGazePoint: {
          x: payload.last_gaze_point_x ?? state.lastGazePoint.x,
          y: payload.last_gaze_point_y ?? state.lastGazePoint.y
        },
        gazeOmega: {
          x: payload.gaze_omega_x ?? state.gazeOmega.x,
          y: payload.gaze_omega_y ?? state.gazeOmega.y
        }
      };
    })
}));
