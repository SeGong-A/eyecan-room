import type { CommandItem, FullGazeDirection, ScanTarget, TargetMeta } from '../types/control';

export const targetMeta: Record<ScanTarget, TargetMeta> = {
  FAN: { name: '선풍기', icon: '✣' },
  LIGHT: { name: '조명', icon: '☀' },
  CURTAIN: { name: '커튼', icon: '▥' },
};

export const settingsRootItems: CommandItem[] = [
  { label: '모터 방향', description: '팬틸트 이동 방향을 점검합니다', command: 'SETTINGS_MOTOR' },
  { label: '로테이션 시간', description: '선택 항목이 넘어가는 속도를 설정합니다', command: 'SETTINGS_SCAN_SPEED' },
  { label: '화면 모드', description: '화면 테마를 선택합니다', command: 'SETTINGS_THEME' },
  { label: '학습 전환', description: '시선 온라인 학습을 켜거나 끕니다', command: 'SETTINGS_LEARNING' },
  { label: '학습 저장', description: '현재 개인화 모델을 저장합니다', command: 'SETTINGS_SAVE_MODEL' },
  { label: '학습 초기화', description: '기본 시선 모델로 되돌립니다', command: 'SETTINGS_RESET_MODEL' },
  { label: '닫기', description: '설정을 닫습니다', command: 'SETTINGS_CLOSE' }
];

export const motorItems: CommandItem[] = [
  { label: '왼쪽 3°', description: '카메라를 왼쪽으로 3도 움직입니다', command: 'MOTOR_LEFT' },
  { label: '오른쪽 3°', description: '카메라를 오른쪽으로 3도 움직입니다', command: 'MOTOR_RIGHT' },
  { label: '위 3°', description: '카메라를 위로 3도 움직입니다', command: 'MOTOR_UP' },
  { label: '아래 3°', description: '카메라를 아래로 3도 움직입니다', command: 'MOTOR_DOWN' },
  { label: '좌우 반전', description: '시선의 좌우 모터 방향을 반대로 설정합니다', command: 'MOTOR_FLIP_PAN' },
  { label: '상하 반전', description: '시선의 상하 모터 방향을 반대로 설정합니다', command: 'MOTOR_FLIP_TILT' },
  { label: '점검 완료', description: '현재 방향으로 자동 시선 이동을 활성화합니다', command: 'MOTOR_SETUP_DONE' },
  { label: '돌아가기', description: '설정으로 돌아갑니다', command: 'BACK' }
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
  CURTAIN: [
    { label: '열기', description: '커튼을 엽니다', command: 'CURTAIN_OPEN' },
    { label: '닫기', description: '커튼을 닫습니다', command: 'CURTAIN_CLOSE' },
    { label: '멈춤', description: '커튼을 멈춥니다', command: 'CURTAIN_STOP' },
    { label: '취소', description: '방 둘러보기로 돌아갑니다', command: 'CANCEL' }
  ]
};

export const directionLabel: Record<FullGazeDirection, string> = {
  CENTER: '정면',
  LEFT: '왼쪽',
  RIGHT: '오른쪽',
  UP: '위',
  DOWN: '아래'
};

export function arduinoStatusText(status: string) {
  if (status === 'UNSUPPORTED') return 'Chrome 또는 Edge에서 Arduino 연결을 사용할 수 있습니다';
  if (status === 'CONNECTING') return 'Arduino 연결 중';
  if (status === 'RECONNECTING') return 'Arduino 재연결 중';
  if (status === 'CONNECTED') return 'Arduino 연결됨';
  if (status === 'ERROR') return 'Arduino 연결 오류';
  return 'Arduino 미연결';
}
