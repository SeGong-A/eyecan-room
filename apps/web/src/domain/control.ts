import type { CommandItem, FullGazeDirection, ScanTarget, TargetMeta } from '../types/control';

export const targetMeta: Record<ScanTarget, TargetMeta> = {
  FAN: { name: '선풍기', icon: '✣' },
  LIGHT: { name: '조명', icon: '☀' },
  TV: { name: 'TV', icon: '▣' },
  CURTAIN: { name: '커튼', icon: '▥' },
  WINDOW: { name: '창문', icon: '▦' }
};

export const targetChoiceItems: CommandItem[] = [
  { label: '커튼', description: '커튼을 제어합니다', command: 'TARGET_CURTAIN' },
  { label: '창문', description: '창문을 제어합니다', command: 'TARGET_WINDOW' },
  { label: '돌아가기', description: '방 둘러보기로 돌아갑니다', command: 'BACK' }
];

export const settingsRootItems: CommandItem[] = [
  { label: '로테이션 시간', description: '선택 항목이 넘어가는 속도를 설정합니다', command: 'SETTINGS_SCAN_SPEED' },
  { label: '화면 모드', description: '화면 테마를 선택합니다', command: 'SETTINGS_THEME' },
  { label: '닫기', description: '설정을 닫습니다', command: 'SETTINGS_CLOSE' }
];

export const scanSpeedItems: CommandItem[] = [1, 2, 3, 4, 5].map((seconds) => ({
  label: `${seconds}초`,
  description: `로테이션 시간을 ${seconds}초로 설정합니다`,
  command: `SCAN_SPEED_${seconds * 1000}`
}));

export const themeItems: CommandItem[] = [
  { label: '라이트 모드', description: '라이트 모드로 전환합니다', command: 'THEME_LIGHT' },
  { label: '다크 모드', description: '다크 모드로 전환합니다', command: 'THEME_DARK' }
];

export const scanItems: Record<ScanTarget, CommandItem[]> = {
  FAN: [
    { label: '켜기', description: '선풍기를 켭니다', command: 'FAN_ON' },
    { label: '끄기', description: '선풍기를 끕니다', command: 'FAN_OFF' },
    { label: '약풍', description: '약한 바람', command: 'FAN_LOW' },
    { label: '중풍', description: '보통 바람', command: 'FAN_MID' },
    { label: '강풍', description: '강한 바람', command: 'FAN_HIGH' },
    { label: '취소', description: '방 둘러보기로 돌아갑니다', command: 'CANCEL' }
  ],
  LIGHT: [
    { label: '켜기', description: '조명을 켭니다', command: 'LIGHT_ON' },
    { label: '끄기', description: '조명을 끕니다', command: 'LIGHT_OFF' },
    { label: '밝게', description: '밝기를 높입니다', command: 'LIGHT_UP' },
    { label: '어둡게', description: '밝기를 낮춥니다', command: 'LIGHT_DOWN' },
    { label: '취소', description: '방 둘러보기로 돌아갑니다', command: 'CANCEL' }
  ],
  TV: [
    { label: '전원', description: 'TV 전원을 전환합니다', command: 'TV_POWER' },
    { label: '채널 +', description: '다음 채널', command: 'TV_CH_UP' },
    { label: '채널 −', description: '이전 채널', command: 'TV_CH_DOWN' },
    { label: '소리 +', description: '볼륨을 높입니다', command: 'TV_VOL_UP' },
    { label: '소리 −', description: '볼륨을 낮춥니다', command: 'TV_VOL_DOWN' },
    { label: '취소', description: '방 둘러보기로 돌아갑니다', command: 'CANCEL' }
  ],
  CURTAIN: [
    { label: '열기', description: '커튼을 엽니다', command: 'CURTAIN_OPEN' },
    { label: '닫기', description: '커튼을 닫습니다', command: 'CURTAIN_CLOSE' },
    { label: '멈춤', description: '커튼을 멈춥니다', command: 'CURTAIN_STOP' },
    { label: '취소', description: '방 둘러보기로 돌아갑니다', command: 'CANCEL' }
  ],
  WINDOW: [
    { label: '열기', description: '창문을 엽니다', command: 'WINDOW_OPEN' },
    { label: '닫기', description: '창문을 닫습니다', command: 'WINDOW_CLOSE' },
    { label: '멈춤', description: '창문을 멈춥니다', command: 'WINDOW_STOP' },
    { label: '취소', description: '방 둘러보기로 돌아갑니다', command: 'CANCEL' }
  ]
};

export const gazeSamples: Record<FullGazeDirection, { x: number; y: number }> = {
  LEFT: { x: 0.28, y: 0.5 },
  RIGHT: { x: 0.72, y: 0.5 },
  UP: { x: 0.5, y: 0.28 },
  DOWN: { x: 0.5, y: 0.72 },
  CENTER: { x: 0.5, y: 0.5 }
};

export const calibrationSteps: FullGazeDirection[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];

export const calibrationCopy: Record<FullGazeDirection, string> = {
  CENTER: '화면 가운데를 바라보세요',
  LEFT: '고개는 그대로, 왼쪽을 바라보세요',
  RIGHT: '고개는 그대로, 오른쪽을 바라보세요',
  UP: '고개는 그대로, 위를 바라보세요',
  DOWN: '고개는 그대로, 아래를 바라보세요'
};

export const directionLabel: Record<FullGazeDirection, string> = {
  CENTER: '정면',
  LEFT: '왼쪽',
  RIGHT: '오른쪽',
  UP: '위',
  DOWN: '아래'
};

export const targetByGazeDirection: Partial<Record<FullGazeDirection, ScanTarget>> = {
  LEFT: 'CURTAIN',
  RIGHT: 'FAN',
  UP: 'LIGHT',
  CENTER: 'TV'
};

export function arduinoStatusText(status: string) {
  if (status === 'UNSUPPORTED') return 'Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다';
  if (status === 'CONNECTING') return 'Arduino 연결 중';
  if (status === 'CONNECTED') return 'Arduino 연결됨';
  if (status === 'ERROR') return 'Arduino 연결 오류';
  return 'Arduino 미연결';
}
