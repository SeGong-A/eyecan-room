import type { LucideIcon } from 'lucide-react';

export type GazeDirection = 'CENTER' | 'LEFT' | 'RIGHT';
export type FullGazeDirection = GazeDirection | 'UP' | 'DOWN';
export type ScanTarget = 'FAN' | 'LIGHT' | 'CURTAIN';
export type InteractionMode = 'EXPLORE' | 'COMMAND' | 'SETTINGS' | 'SETTINGS_SUBMENU';
export type ThemeMode = 'light' | 'dark';
export type SettingsMenu = 'ROOT' | 'SCAN_SPEED' | 'THEME' | 'LEARNING' | 'MOTOR' | 'MOTOR_MOVE' | 'MOTOR_DIRECTION';
export type SetupStage = 'HOME' | 'EYE_CAMERA' | 'ROOM_CAMERA' | 'ROOM';
export type ArduinoStatus = 'UNSUPPORTED' | 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';
export type ArduinoLevels = {
  light: number;
  fan: number;
  pan: number;
  tilt: number;
  servo: number;
};
export type CommandItem = { label: string; description: string; command: string; icon: LucideIcon };
export type TargetMeta = { name: string; icon: LucideIcon };
export type ToastTone = 'success' | 'info' | 'error';
export type ToastState = { id: number; tone: ToastTone; message: string };
export type Notify = (message: string, tone?: ToastTone) => void;
