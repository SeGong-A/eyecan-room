import { create } from 'zustand';

export type GazeDirection = 'CENTER' | 'LEFT' | 'RIGHT';
export type ScanTarget = 'FAN' | 'TV' | 'CURTAIN';

type AppState = {
  gazeDirection: GazeDirection;
  selectedTarget: ScanTarget;
  isCalibrated: boolean;
  scanStep: number;
  connectionState: 'DISCONNECTED' | 'READY' | 'STREAMING';
  setGazeDirection: (direction: GazeDirection) => void;
  setSelectedTarget: (target: ScanTarget) => void;
  setIsCalibrated: (value: boolean) => void;
  setScanStep: (value: number) => void;
  setConnectionState: (value: AppState['connectionState']) => void;
};

export const useAppStore = create<AppState>((set) => ({
  gazeDirection: 'CENTER',
  selectedTarget: 'TV',
  isCalibrated: false,
  scanStep: 0,
  connectionState: 'DISCONNECTED',
  setGazeDirection: (gazeDirection) => set({ gazeDirection }),
  setSelectedTarget: (selectedTarget) => set({ selectedTarget }),
  setIsCalibrated: (isCalibrated) => set({ isCalibrated }),
  setScanStep: (scanStep) => set({ scanStep }),
  setConnectionState: (connectionState) => set({ connectionState })
}));
