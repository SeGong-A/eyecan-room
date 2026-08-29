export type GazeDirection = 'CENTER' | 'LEFT' | 'RIGHT';
export type FullGazeDirection = GazeDirection | 'UP' | 'DOWN';
export type ScanTarget = 'FAN' | 'LIGHT' | 'TV' | 'CURTAIN' | 'WINDOW';
export type InteractionMode = 'EXPLORE' | 'TARGET_CHOICE' | 'COMMAND' | 'SETTINGS' | 'SETTINGS_SUBMENU';
export type ThemeMode = 'light' | 'dark';
export type SettingsMenu = 'ROOT' | 'SCAN_SPEED' | 'THEME';
export type SetupStage = 'HOME' | 'EYE_CAMERA' | 'ROOM_CAMERA' | 'ROOM';
export type ArduinoStatus = 'UNSUPPORTED' | 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export type CommandItem = { label: string; description: string; command: string };
export type CommandLogItem = {
  id: number;
  target: string;
  label: string;
  command: string;
  status: 'sent' | 'offline';
};

export type TargetMeta = { name: string; icon: string };
