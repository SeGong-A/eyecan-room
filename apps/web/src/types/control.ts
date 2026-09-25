export type GazeDirection = 'CENTER' | 'LEFT' | 'RIGHT';
export type FullGazeDirection = GazeDirection | 'UP' | 'DOWN';
export type ScanTarget = 'FAN' | 'LIGHT' | 'CURTAIN';
export type InteractionMode = 'EXPLORE' | 'COMMAND' | 'SETTINGS' | 'SETTINGS_SUBMENU';
export type ThemeMode = 'light' | 'dark';
export type SettingsMenu = 'ROOT' | 'SCAN_SPEED' | 'THEME' | 'POSITIONS';
export type SetupStage = 'HOME' | 'EYE_CAMERA' | 'ROOM_CAMERA' | 'ROOM';
export type ArduinoStatus = 'UNSUPPORTED' | 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';
export type ArduinoLevels = {
  light: number;
  fan: number;
  pan: number;
  tilt: number;
  servo: number;
};
export type DevicePosition = { pan: number; tilt: number };
export type DevicePositions = Partial<Record<ScanTarget, DevicePosition>>;

export type CommandItem = { label: string; description: string; command: string };
export type CommandLogItem = {
  id: number;
  target: string;
  label: string;
  command: string;
  status: 'sent' | 'offline';
};

export type TargetMeta = { name: string; icon: string };
