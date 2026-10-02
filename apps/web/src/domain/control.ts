import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, ArrowLeftRight, Blinds,
  Check, Clock3, Eye, Fan, Gauge, Lightbulb, Minus, Moon, Move, Plus, Power,
  RotateCcw, Save, Settings, SlidersHorizontal, Square, Sun, Wind, X
} from 'lucide-react';
import type { CommandItem, FullGazeDirection, ScanTarget, SettingsMenu, TargetMeta } from '../types/control';

export const targetMeta: Record<ScanTarget, TargetMeta> = {
  FAN: { name: '선풍기', icon: Fan }, LIGHT: { name: '조명', icon: Lightbulb }, CURTAIN: { name: '커튼', icon: Blinds }
};
const back: CommandItem = { label: '뒤로', description: '이전 설정으로 돌아갑니다', command: 'BACK', icon: ArrowLeft };
const cancel: CommandItem = { label: '취소', description: '선택을 취소합니다', command: 'CANCEL', icon: X };

export const settingsItems: Record<SettingsMenu, CommandItem[]> = {
  ROOT: [
    { label: '선택 속도', description: '항목의 회전 간격', command: 'SETTINGS_SCAN_SPEED', icon: Clock3 },
    { label: '화면', description: '라이트 또는 다크 모드', command: 'SETTINGS_THEME', icon: Sun },
    { label: '시선 개인화', description: '시선 학습과 개인 모델', command: 'SETTINGS_PERSONALIZATION', icon: Eye },
    { label: '설치 점검', description: '카메라 이동과 방향', command: 'SETTINGS_MOTOR', icon: SlidersHorizontal },
    { label: '닫기', description: '설정을 닫습니다', command: 'SETTINGS_CLOSE', icon: X }
  ],
  SCAN_SPEED: [...[1, 2, 3, 4, 5].map((seconds) => ({ label: `${seconds}초`, description: `항목당 ${seconds}초`, command: `SCAN_SPEED_${seconds * 1000}`, icon: Clock3 })), back],
  THEME: [
    { label: '라이트', description: '라이트 모드', command: 'THEME_LIGHT', icon: Sun },
    { label: '다크', description: '다크 모드', command: 'THEME_DARK', icon: Moon }, back
  ],
  LEARNING: [
    { label: '학습 전환', description: '온라인 학습 시작 또는 일시정지', command: 'SETTINGS_LEARNING', icon: Eye },
    { label: '모델 저장', description: '개인화 모델 저장', command: 'SETTINGS_SAVE_MODEL', icon: Save },
    { label: '초기화', description: '기본 시선 모델로 복원', command: 'SETTINGS_RESET_MODEL', icon: RotateCcw }, back
  ],
  MOTOR: [
    { label: '카메라 이동', description: '각 방향으로 3도 이동', command: 'SETTINGS_MOTOR_MOVE', icon: Move },
    { label: '방향 반전', description: '좌우 또는 상하 반전', command: 'SETTINGS_MOTOR_DIRECTION', icon: ArrowLeftRight },
    { label: '점검 완료', description: '모터 방향 점검 완료', command: 'MOTOR_SETUP_DONE', icon: Check }, back
  ],
  MOTOR_MOVE: [
    { label: '왼쪽 3°', description: '왼쪽 3도 이동', command: 'MOTOR_LEFT', icon: ArrowLeft },
    { label: '오른쪽 3°', description: '오른쪽 3도 이동', command: 'MOTOR_RIGHT', icon: ArrowRight },
    { label: '위 3°', description: '위쪽 3도 이동', command: 'MOTOR_UP', icon: ArrowUp },
    { label: '아래 3°', description: '아래쪽 3도 이동', command: 'MOTOR_DOWN', icon: ArrowDown }, back
  ],
  MOTOR_DIRECTION: [
    { label: '좌우 반전', description: 'Pan 방향 반전', command: 'MOTOR_FLIP_PAN', icon: ArrowLeftRight },
    { label: '상하 반전', description: 'Tilt 방향 반전', command: 'MOTOR_FLIP_TILT', icon: ArrowUpDown }, back
  ]
};

export const settingsMeta: Record<SettingsMenu, TargetMeta> = {
  ROOT: { name: '설정', icon: Settings }, SCAN_SPEED: { name: '선택 속도', icon: Clock3 },
  THEME: { name: '화면', icon: Sun }, LEARNING: { name: '시선 개인화', icon: Eye },
  MOTOR: { name: '설치 점검', icon: SlidersHorizontal }, MOTOR_MOVE: { name: '카메라 이동', icon: Move }, MOTOR_DIRECTION: { name: '방향 반전', icon: ArrowLeftRight }
};

export function parentSettingsMenu(menu: SettingsMenu): SettingsMenu {
  return menu === 'MOTOR_MOVE' || menu === 'MOTOR_DIRECTION' ? 'MOTOR' : 'ROOT';
}

export const scanItems: Record<ScanTarget, CommandItem[]> = {
  FAN: [
    { label: '켜기', description: '선풍기 켜기', command: 'FAN_ON', icon: Power },
    { label: '끄기', description: '선풍기 끄기', command: 'FAN_OFF', icon: Power },
    { label: '약풍', description: '선풍기 약풍', command: 'FAN_LOW', icon: Wind },
    { label: '중풍', description: '선풍기 중풍', command: 'FAN_MID', icon: Wind },
    { label: '강풍', description: '선풍기 강풍', command: 'FAN_HIGH', icon: Gauge }, cancel
  ],
  LIGHT: [
    { label: '켜기', description: '조명 켜기', command: 'LIGHT_ON', icon: Power },
    { label: '끄기', description: '조명 끄기', command: 'LIGHT_OFF', icon: Power },
    { label: '밝게', description: '조명 밝게', command: 'LIGHT_UP', icon: Plus },
    { label: '어둡게', description: '조명 어둡게', command: 'LIGHT_DOWN', icon: Minus }, cancel
  ],
  CURTAIN: [
    { label: '닫기', description: '커튼 닫기', command: 'CURTAIN_OPEN', icon: ArrowLeftRight },
    { label: '열기', description: '커튼 열기', command: 'CURTAIN_CLOSE', icon: Blinds },
    { label: '멈춤', description: '커튼 멈춤', command: 'CURTAIN_STOP', icon: Square }, cancel
  ]
};
export const directionLabel: Record<FullGazeDirection, string> = { CENTER: '정면', LEFT: '왼쪽', RIGHT: '오른쪽', UP: '위', DOWN: '아래' };
export function arduinoStatusText(status: string) {
  if (status === 'UNSUPPORTED') return '지원하지 않는 브라우저';
  if (status === 'CONNECTING') return '장치 연결 중';
  if (status === 'RECONNECTING') return '장치 재연결 중';
  if (status === 'CONNECTED') return '장치 연결됨';
  if (status === 'ERROR') return '장치 연결 오류';
  return '장치 미연결';
}
