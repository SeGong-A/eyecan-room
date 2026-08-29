import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useCamera, type CameraStatus } from './hooks/useCamera';
import {
  useAppStore,
  type FullGazeDirection,
  type ScanTarget
} from './store/useAppStore';

type CommandItem = { label: string; description: string; command: string };
type CommandLogItem = {
  id: number;
  target: string;
  label: string;
  command: string;
  status: 'sent' | 'offline';
};
type SetupStage = 'HOME' | 'EYE_CAMERA' | 'ROOM_CAMERA' | 'ROOM';

const targetMeta: Record<ScanTarget, { name: string; icon: string }> = {
  FAN: { name: '선풍기', icon: '✣' },
  LIGHT: { name: '조명', icon: '☀' },
  TV: { name: 'TV', icon: '▣' },
  CURTAIN: { name: '커튼', icon: '▥' },
  WINDOW: { name: '창문', icon: '▦' }
};

const targetChoiceItems: CommandItem[] = [
  { label: '커튼', description: '커튼을 제어합니다', command: 'TARGET_CURTAIN' },
  { label: '창문', description: '창문을 제어합니다', command: 'TARGET_WINDOW' },
  { label: '돌아가기', description: '방 둘러보기로 돌아갑니다', command: 'BACK' }
];

const settingsRootItems: CommandItem[] = [
  { label: '로테이션 시간', description: '선택 항목이 넘어가는 속도를 설정합니다', command: 'SETTINGS_SCAN_SPEED' },
  { label: '화면 모드', description: '화면 테마를 선택합니다', command: 'SETTINGS_THEME' },
  { label: '닫기', description: '설정을 닫습니다', command: 'SETTINGS_CLOSE' }
];

const scanSpeedItems: CommandItem[] = [1, 2, 3, 4, 5].map((seconds) => ({
  label: `${seconds}초`,
  description: `로테이션 시간을 ${seconds}초로 설정합니다`,
  command: `SCAN_SPEED_${seconds * 1000}`
}));

const themeItems: CommandItem[] = [
  { label: '라이트 모드', description: '라이트 모드로 전환합니다', command: 'THEME_LIGHT' },
  { label: '다크 모드', description: '다크 모드로 전환합니다', command: 'THEME_DARK' }
];

const scanItems: Record<ScanTarget, CommandItem[]> = {
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

const gazeSamples: Record<FullGazeDirection, { x: number; y: number }> = {
  LEFT: { x: 0.28, y: 0.5 }, RIGHT: { x: 0.72, y: 0.5 },
  UP: { x: 0.5, y: 0.28 }, DOWN: { x: 0.5, y: 0.72 }, CENTER: { x: 0.5, y: 0.5 }
};
const calibrationSteps: FullGazeDirection[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];
const calibrationCopy: Record<FullGazeDirection, string> = {
  CENTER: '화면 가운데를 바라보세요', LEFT: '고개는 그대로, 왼쪽을 바라보세요',
  RIGHT: '고개는 그대로, 오른쪽을 바라보세요', UP: '고개는 그대로, 위를 바라보세요',
  DOWN: '고개는 그대로, 아래를 바라보세요'
};
const directionLabel: Record<FullGazeDirection, string> = {
  CENTER: '정면', LEFT: '왼쪽', RIGHT: '오른쪽', UP: '위', DOWN: '아래'
};
const targetByGazeDirection: Partial<Record<FullGazeDirection, ScanTarget>> = {
  LEFT: 'CURTAIN',
  RIGHT: 'FAN',
  UP: 'LIGHT',
  CENTER: 'TV'
};
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function directionFromPoint(point: { x: number; y: number }): FullGazeDirection {
  if (point.y < 0.34) return 'UP';
  if (point.y > 0.68) return 'DOWN';
  if (point.x < 0.36) return 'LEFT';
  if (point.x > 0.64) return 'RIGHT';
  return 'CENTER';
}

function cameraMessage(status: CameraStatus) {
  if (status === 'REQUESTING') return '카메라 연결을 기다리는 중입니다';
  if (status === 'DENIED') return '브라우저 설정에서 카메라 권한을 허용해주세요';
  if (status === 'UNAVAILABLE') return '사용할 수 있는 카메라를 찾지 못했습니다';
  if (status === 'ERROR') return '카메라 연결 중 문제가 발생했습니다';
  return '내장 카메라를 연결하면 눈의 위치를 확인할 수 있어요';
}

function visionMessage(status: string) {
  if (status === 'STARTING') return '시선 추적 엔진을 시작하는 중입니다';
  if (status === 'RUNNING') return '시선 추적 중입니다';
  if (status === 'ERROR') return '시선 추적 엔진에서 오류가 발생했습니다';
  return '아직 시선 추적을 시작하지 않았습니다';
}

function App() {
  const store = useAppStore();
  const eyeCamera = useCamera('user');
  const roomCamera = useCamera('environment');
  const [setupStage, setSetupStage] = useState<SetupStage>('HOME');
  const [calibrationIndex, setCalibrationIndex] = useState(0);
  const [showCalibration, setShowCalibration] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [toast, setToast] = useState('');
  const [tvState, setTvState] = useState({ power: false, channel: 7, volume: 18 });
  const [commandLog, setCommandLog] = useState<CommandLogItem[]>([]);
  const [trackedGazePoint, setTrackedGazePoint] = useState({ x: 0.5, y: 0.5 });
  const [rotationStep, setRotationStep] = useState(0);
  const scanList = useMemo(() => {
    if (store.interactionMode === 'SETTINGS') return settingsRootItems;
    if (store.interactionMode === 'SETTINGS_SUBMENU') {
      return store.settingsMenu === 'SCAN_SPEED' ? scanSpeedItems : themeItems;
    }
    return store.interactionMode === 'TARGET_CHOICE' ? targetChoiceItems : scanItems[store.selectedTarget];
  }, [store.interactionMode, store.selectedTarget, store.settingsMenu]);
  const lastProcessedBlinkSequenceRef = useRef(0);
  const trackedPointRef = useRef(trackedGazePoint);
  const simulatedGazeDirectionRef = useRef<FullGazeDirection>('CENTER');
  const rotationStepRef = useRef(0);

  useEffect(() => { trackedPointRef.current = trackedGazePoint; }, [trackedGazePoint]);
  useEffect(() => { rotationStepRef.current = rotationStep; }, [rotationStep]);

  useEffect(() => {
    document.documentElement.dataset.theme = store.themeMode;
  }, [store.themeMode]);

  useEffect(() => {
    if (setupStage === 'ROOM_CAMERA' && roomCamera.status === 'READY') {
      setSetupStage('ROOM');
      setToast('외장 카메라가 연결되었습니다');
    }
  }, [roomCamera.status, setupStage]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/state`);
    socket.addEventListener('open', () => store.setConnectionState('STREAMING'));
    socket.addEventListener('message', (event) => {
      try {
        store.syncFromServer(JSON.parse(event.data));
      } catch {
        setToast('상태 데이터를 읽지 못했습니다');
      }
    });
    socket.addEventListener('close', () => store.setConnectionState('DISCONNECTED'));
    socket.addEventListener('error', () => store.setConnectionState('DISCONNECTED'));
    return () => socket.close();
  }, [store.setConnectionState, store.syncFromServer]);

  useEffect(() => {
    if (showSimulator) return;
    if (eyeCamera.status !== 'READY') return;

    const video = eyeCamera.videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    const width = 120;
    const height = 90;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    let frameId = 0;
    let lastSampleAt = 0;

    const sampleFrame = (now: number) => {
      if (now - lastSampleAt >= 90 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        lastSampleAt = now;
        context.drawImage(video, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height).data;
        let weightTotal = 0;
        let weightedX = 0;
        let weightedY = 0;

        const cropLeft = 26;
        const cropRight = 94;
        const cropTop = 18;
        const cropBottom = 56;

        for (let y = cropTop; y < cropBottom; y += 1) {
          for (let x = cropLeft; x < cropRight; x += 1) {
            const index = (y * width + x) * 4;
            const red = image[index];
            const green = image[index + 1];
            const blue = image[index + 2];
            const luma = red * 0.299 + green * 0.587 + blue * 0.114;
            const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
            if (luma < 72 && chroma < 70) {
              const weight = 76 - luma;
              weightTotal += weight;
              weightedX += x * weight;
              weightedY += y * weight;
            }
          }
        }

        if (weightTotal > 120) {
          const rawX = weightedX / weightTotal;
          const rawY = weightedY / weightTotal;
          const normalizedX = clamp((rawX - cropLeft) / (cropRight - cropLeft), 0, 1);
          const normalizedY = clamp((rawY - cropTop) / (cropBottom - cropTop), 0, 1);
          const nextPoint = {
            x: clamp(0.5 + (normalizedX - 0.5) * 1.35, 0.08, 0.92),
            y: clamp(0.5 + (normalizedY - 0.5) * 1.55, 0.1, 0.9)
          };
          const current = trackedPointRef.current;
          const smoothedPoint = {
            x: current.x * 0.72 + nextPoint.x * 0.28,
            y: current.y * 0.72 + nextPoint.y * 0.28
          };
          trackedPointRef.current = smoothedPoint;
          setTrackedGazePoint(smoothedPoint);
          store.setGazeDirection(directionFromPoint(smoothedPoint));
        }
      }

      frameId = window.requestAnimationFrame(sampleFrame);
    };

    frameId = window.requestAnimationFrame(sampleFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [eyeCamera.status, showSimulator, store.setGazeDirection]);

  useEffect(() => {
    if (store.isPaused || store.interactionMode === 'EXPLORE') {
      rotationStepRef.current = 0;
      setRotationStep(0);
      return;
    }

    rotationStepRef.current = 0;
    setRotationStep(0);
    const timerId = window.setInterval(() => {
      setRotationStep((step) => {
        const nextStep = (step + 1) % scanList.length;
        rotationStepRef.current = nextStep;
        return nextStep;
      });
    }, store.scanIntervalMs);
    return () => window.clearInterval(timerId);
  }, [store.interactionMode, store.isPaused, store.scanIntervalMs, scanList.length]);

  useEffect(() => {
    if (!store.blinkSequence || store.blinkSequence === lastProcessedBlinkSequenceRef.current) return;
    lastProcessedBlinkSequenceRef.current = store.blinkSequence;
    if (store.lastBlinkEvent === 'CANCEL') {
      void returnToExplore('방 화면으로 돌아갑니다');
      void postCommand('CAM_STOP', '룸 카메라', '정지');
      return;
    }
    if (store.lastBlinkEvent !== 'SELECT' || store.isPaused) return;
    void selectCurrentScanItem();
  }, [store.blinkSequence]);

  async function selectCurrentScanItem() {
    if (store.isPaused) return;

    if (store.interactionMode === 'EXPLORE') {
      await openRotationUiForDirection(showSimulator ? simulatedGazeDirectionRef.current : store.gazeDirection);
      return;
    }

    const item = scanList[rotationStepRef.current % scanList.length];
    if (!item || item.command === 'CANCEL' || item.command === 'BACK') {
      await returnToExplore('선택을 취소합니다');
      return;
    }
    if (store.interactionMode === 'SETTINGS' || store.interactionMode === 'SETTINGS_SUBMENU') {
      await selectSettingsItem(item);
      return;
    }
    if (store.interactionMode === 'TARGET_CHOICE') {
      const selectedTarget: ScanTarget = item.command === 'TARGET_WINDOW' ? 'WINDOW' : 'CURTAIN';
      store.setSelectedTarget(selectedTarget);
      store.setInteractionMode('COMMAND');
      await chooseSharedTarget(selectedTarget);
      return;
    }
    await postCommand(item.command, targetMeta[store.selectedTarget].name, item.label);
    updateTvMock(item.command);
    await returnToExplore(item.description);
  }

  async function selectSettingsItem(item: CommandItem) {
    if (item.command === 'SETTINGS_CLOSE') {
      await returnToExplore('설정을 닫습니다');
      return;
    }
    if (item.command === 'SETTINGS_SCAN_SPEED') {
      store.setSettingsMenu('SCAN_SPEED');
      store.setInteractionMode('SETTINGS_SUBMENU');
      return;
    }
    if (item.command === 'SETTINGS_THEME') {
      store.setSettingsMenu('THEME');
      store.setInteractionMode('SETTINGS_SUBMENU');
      return;
    }
    if (item.command.startsWith('SCAN_SPEED_')) {
      const intervalMs = Number(item.command.replace('SCAN_SPEED_', ''));
      store.setScanIntervalMs(intervalMs);
      await sendRequest(`/state/scan-speed?scan_interval_ms=${intervalMs}`);
      await returnToExplore(`로테이션 시간을 ${intervalMs / 1000}초로 설정합니다`);
      return;
    }
    if (item.command === 'THEME_LIGHT' || item.command === 'THEME_DARK') {
      const themeMode = item.command === 'THEME_DARK' ? 'dark' : 'light';
      store.setThemeMode(themeMode);
      await returnToExplore(themeMode === 'dark' ? '다크 모드로 전환합니다' : '라이트 모드로 전환합니다');
    }
  }

  async function returnToExplore(message?: string) {
    store.setInteractionMode('EXPLORE');
    store.setSettingsMenu('ROOT');
    store.setScanStep(0);
    await sendRequest('/state/mode?mode=EXPLORE');
    if (message) setToast(message);
  }

  useEffect(() => {
    if (!toast) return;
    const timerId = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timerId);
  }, [toast]);

  useEffect(() => {
    void sendRequest(`/state/scan-speed?scan_interval_ms=${store.scanIntervalMs}`);
  }, []);

  async function sendRequest(url: string) {
    try {
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return true;
    } catch {
      store.setConnectionState('DISCONNECTED');
      setToast('API 연결 없이 프론트 데모 모드로 진행 중입니다');
      return false;
    }
  }
  async function postCommand(command: string, targetName = '시스템', label = command) {
    const didSend = await sendRequest(`/events/command?command=${encodeURIComponent(command)}`);
    const status: CommandLogItem['status'] = didSend ? 'sent' : 'offline';
    setCommandLog((items) => [
      {
        id: Date.now(),
        target: targetName,
        label,
        command,
        status
      },
      ...items
    ].slice(0, 6));
  }
  async function postGazeSample(direction: FullGazeDirection) {
    const sample = gazeSamples[direction];
    await sendRequest(`/events/gaze?x=${sample.x}&y=${sample.y}`);
    simulatedGazeDirectionRef.current = direction;
    trackedPointRef.current = sample;
    setTrackedGazePoint(sample);
    store.setGazeDirection(direction);
  }
  async function connectEyeCameraAndStartVision() {
    const didStartVision = await sendRequest('/vision/start?camera_index=0');
    if (didStartVision) {
      setShowSimulator(false);
      setToast('실제 시선 추적을 시작했습니다');
      return;
    }

    await eyeCamera.connect();
    setShowSimulator(true);
    setToast('백엔드 없이 프론트 간이 추적으로 진행합니다');
  }
  async function connectRoomCameraAndEnter() {
    await roomCamera.connect();
  }
  async function selectTarget(target: ScanTarget) {
    store.setSelectedTarget(target);
    await sendRequest(`/state/target?target=${target}`);
  }
  async function chooseSharedTarget(target: ScanTarget) {
    await sendRequest(`/state/target?target=${target}`);
    await sendRequest('/state/mode?mode=COMMAND');
  }
  async function openRotationUiForDirection(direction: FullGazeDirection) {
    const gazeTarget = targetByGazeDirection[direction];
    if (!gazeTarget) {
      setToast('아래 방향은 선택 대상이 없습니다');
      store.setInteractionMode('EXPLORE');
      return;
    }

    store.setSelectedTarget(gazeTarget);
    store.setInteractionMode('COMMAND');
    store.setScanStep(0);
    await chooseSharedTarget(gazeTarget);
    store.setInteractionMode('COMMAND');
    setToast(`${targetMeta[gazeTarget].name} 로테이션 UI를 열었습니다`);
  }
  async function simulateSelectBlink() {
    if (store.interactionMode === 'EXPLORE') {
      const direction = simulatedGazeDirectionRef.current;
      await postGazeSample(direction);
      await openRotationUiForDirection(direction);
      return;
    }

    await selectCurrentScanItem();
  }
  async function simulateBlink(durationMs: number) {
    const now = Date.now();
    await sendRequest(`/events/blink?is_closed=true&now_ms=${now}`);
    await sendRequest(`/events/blink?is_closed=false&now_ms=${now + durationMs}`);
  }
  async function captureCalibrationStep() {
    const expectedDirection = calibrationSteps[calibrationIndex];
    await postGazeSample(expectedDirection);
    if (calibrationIndex < calibrationSteps.length - 1) {
      setCalibrationIndex((index) => index + 1);
      setToast(`${directionLabel[expectedDirection]} OK`);
    }
    else {
      store.setIsCalibrated(true);
      store.setIsPaused(false);
      store.setInteractionMode('EXPLORE');
      store.setScanStep(0);
      setShowSimulator(true);
      await sendRequest('/state/calibration?is_calibrated=true');
      await sendRequest('/state/mode?mode=EXPLORE');
      setShowCalibration(false);
      setCalibrationIndex(0);
      setSetupStage('ROOM_CAMERA');
      setToast('눈동자 인식을 완료했습니다');
    }
  }
  async function startDemoMode() {
    store.setIsCalibrated(true);
    store.setIsPaused(false);
    setShowSimulator(true);
    setSetupStage('ROOM');
    await sendRequest('/state/calibration?is_calibrated=true');
    setToast('카메라 없이 프론트 데모를 시작합니다');
  }
  function openSettingsRotation() {
    if (store.interactionMode !== 'EXPLORE') return;
    store.setSettingsMenu('ROOT');
    store.setInteractionMode('SETTINGS');
  }
  function updateTvMock(command: string) {
    setTvState((current) => {
      if (command === 'TV_POWER') return { ...current, power: !current.power };
      if (command === 'TV_CH_UP') return { ...current, channel: current.channel + 1 };
      if (command === 'TV_CH_DOWN') return { ...current, channel: Math.max(1, current.channel - 1) };
      if (command === 'TV_VOL_UP') return { ...current, volume: Math.min(100, current.volume + 5) };
      if (command === 'TV_VOL_DOWN') return { ...current, volume: Math.max(0, current.volume - 5) };
      return current;
    });
  }

  const rawScanStep = store.interactionMode === 'EXPLORE' ? store.scanStep : rotationStep;
  const activeScanStep = rawScanStep % scanList.length;
  const currentItem = scanList[activeScanStep];
  const radialStepAngle = 360 / scanList.length;
  const radialRotation = -activeScanStep * radialStepAngle;
  const isTargetChoice = store.interactionMode === 'TARGET_CHOICE';
  const isSettingsMode = store.interactionMode === 'SETTINGS' || store.interactionMode === 'SETTINGS_SUBMENU';
  const radialTarget = isSettingsMode
    ? { name: store.settingsMenu === 'SCAN_SPEED' ? '로테이션 시간' : store.settingsMenu === 'THEME' ? '화면 모드' : '설정', icon: '⚙' }
    : isTargetChoice
    ? { name: '커튼 · 창문', icon: '▥' }
    : targetMeta[store.selectedTarget];
  const cameraReady = eyeCamera.status === 'READY';
  const roomCameraReady = roomCamera.status === 'READY';
  const gazeTrackingReady = cameraReady || store.visionStatus === 'STARTING' || store.visionStatus === 'RUNNING';
  const canShowRoomControl = setupStage === 'ROOM';
  const backendGazePoint = {
    x: clamp(0.5 + (store.lastGazePoint.x - 0.5) * 2.4, 0.08, 0.92),
    y: clamp(0.5 + (store.lastGazePoint.y - 0.5) * 2.4, 0.1, 0.9)
  };
  const activeGazePoint = showSimulator ? trackedGazePoint : store.visionStatus === 'RUNNING' ? backendGazePoint : trackedGazePoint;
  const visibleGazeDirection = showSimulator ? directionFromPoint(activeGazePoint) : store.gazeDirection;
  const gazeCursor = {
    x: `${activeGazePoint.x * 100}%`,
    y: `${activeGazePoint.y * 100}%`
  };
  const isEyeCalibrationStep = setupStage === 'EYE_CAMERA' && gazeTrackingReady;
  const expectedCalibrationDirection = calibrationSteps[calibrationIndex];
  const isExpectedDirection = store.gazeDirection === expectedCalibrationDirection;

  return (
    <main className={store.isPaused ? `app app-paused theme-${store.themeMode}` : `app theme-${store.themeMode}`}>
      {setupStage === 'HOME' && (
        <section className="home-screen" id="main-view">
          <div className="home-logo">
            <span className="home-brand-mark"><i /><i /></span>
            <h1>EyeCan Room</h1>
            <p>눈동자 인식으로 방 안의 기기를 선택하고 제어합니다.</p>
            <button className="primary-button home-start-button" type="button" onClick={() => setSetupStage('EYE_CAMERA')}>시작하기</button>
          </div>
        </section>
      )}

      {setupStage !== 'HOME' && !canShowRoomControl && (
        <>
          <header className="app-header">
            <a className="brand" href="#main-view" aria-label="EyeCan Room 홈">
              <span className="brand-mark"><i /><i /></span>
              <span>EyeCan <strong>Room</strong></span>
            </a>
            <div className="header-status" aria-live="polite">
              <span className={`status-dot ${gazeTrackingReady ? 'online' : ''}`} />
              {setupStage === 'EYE_CAMERA' && !isEyeCalibrationStep && '내장 카메라 연결 필요'}
              {isEyeCalibrationStep && '사용자 눈동자 인식 중'}
              {setupStage === 'ROOM_CAMERA' && '외장 카메라 연결 필요'}
            </div>
            <div className="header-actions">
              <button className="text-button" type="button" onClick={() => setShowSimulator((value) => !value)}>테스트 도구</button>
            </div>
          </header>

          <section className={isEyeCalibrationStep ? 'setup-screen setup-screen-compact' : 'setup-screen'} id="main-view">
            <div className="setup-copy">
              <small>
                {setupStage === 'EYE_CAMERA' && 'STEP 1 · 사용자 눈동자 인식'}
                {setupStage === 'ROOM_CAMERA' && 'STEP 2 · 외장 카메라 연결'}
              </small>
              <h1>
                {setupStage === 'EYE_CAMERA' && !isEyeCalibrationStep && '눈동자 인식을 시작합니다'}
                {isEyeCalibrationStep && '시선 방향 확인'}
                {setupStage === 'ROOM_CAMERA' && '외장 카메라를 연결합니다'}
              </h1>
              <p>
                {setupStage === 'EYE_CAMERA' && !isEyeCalibrationStep && '내장 카메라로 눈과 얼굴 위치를 확인하고 문제가 생기면 원인을 바로 표시합니다.'}
                {isEyeCalibrationStep && '정면, 왼쪽, 오른쪽, 위, 아래를 차례로 저장해주세요.'}
                {setupStage === 'ROOM_CAMERA' && '외장 카메라가 연결되면 방 화면으로 바로 이동합니다.'}
              </p>
            </div>

            <div className="setup-panel">
              <video className="camera-hidden-feed" ref={eyeCamera.videoRef} muted playsInline aria-label="내장 카메라 눈동자 인식 스트림" />
              <video className="camera-hidden-feed" ref={roomCamera.videoRef} muted playsInline aria-label="외장 룸 카메라 스트림" />

              {setupStage === 'EYE_CAMERA' && !isEyeCalibrationStep && (
                <div className="start-card">
                  <div className="start-orbit" aria-hidden="true"><i /><i /><i /></div>
                  <span className={`setup-state-dot ${gazeTrackingReady ? 'ready' : ''}`} />
                  <strong>{gazeTrackingReady ? '시선 추적이 준비되었습니다' : '시선 추적을 시작해주세요'}</strong>
                  <p>{cameraMessage(eyeCamera.status)}</p>
                  <div className="setup-actions">
                    <button className="primary-button" type="button" disabled={eyeCamera.status === 'REQUESTING'} onClick={() => void connectEyeCameraAndStartVision()}>
                      {eyeCamera.status === 'REQUESTING' ? '연결 중' : '시작하기'}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void startDemoMode()}>프론트 데모</button>
                  </div>
                </div>
              )}

              {isEyeCalibrationStep && (
                <div className="gaze-check-card">
                  <div className="gaze-guide-stage" aria-label={`${directionLabel[calibrationSteps[calibrationIndex]]} 시선 유도 화면`}>
                    <span className="guide-cross guide-cross-top" />
                    <span className="guide-cross guide-cross-right" />
                    <span className="guide-cross guide-cross-bottom" />
                    <span className="guide-cross guide-cross-left" />
                    <span className={`guide-target target-${calibrationSteps[calibrationIndex].toLowerCase()}`} />
                    <em>{directionLabel[calibrationSteps[calibrationIndex]]}</em>
                  </div>
                  <strong>{calibrationCopy[calibrationSteps[calibrationIndex]]}</strong>
                  <small>{calibrationIndex + 1} / {calibrationSteps.length}</small>
                  <div className={isExpectedDirection ? 'gaze-detection-status ok' : 'gaze-detection-status'}>
                    <span>{store.faceDetected ? '얼굴 인식됨' : '얼굴 대기 중'}</span>
                    <strong>현재 시선: {directionLabel[store.gazeDirection]}</strong>
                    <em>{visionMessage(store.visionStatus)}</em>
                  </div>
                  {store.visionError && <div className="camera-error compact" role="alert"><strong>시선 추적 오류</strong><p>{store.visionError}</p></div>}
                  <div className="step-dots">{calibrationSteps.map((step, index) => <i className={index <= calibrationIndex ? 'active' : ''} key={step} />)}</div>
                  <p className="dev-skip-note">개발 확인용 · 실제 인식 없이 다음 단계로 진행</p>
                  <button className="primary-button dev-ok-button" type="button" onClick={() => void captureCalibrationStep()}>
                    {calibrationIndex === calibrationSteps.length - 1 ? 'OK - 시선 인식 완료' : `OK - ${directionLabel[calibrationSteps[calibrationIndex]]} 통과`}
                  </button>
                </div>
              )}

              {setupStage === 'ROOM_CAMERA' && (
                <div className="setup-actions">
                  {roomCamera.devices.length > 1 && (
                    <select aria-label="외장 카메라 선택" value={roomCamera.selectedDeviceId} onChange={(event) => void roomCamera.connect(event.target.value)}>
                      {roomCamera.devices.map((device) => <option value={device.deviceId} key={device.deviceId}>{device.label}</option>)}
                    </select>
                  )}
                  <button className="primary-button" type="button" disabled={roomCamera.status === 'REQUESTING'} onClick={() => void connectRoomCameraAndEnter()}>
                    {roomCamera.status === 'REQUESTING' ? '외장 카메라 연결 중' : '외장 카메라 연결하기'}
                  </button>
                </div>
              )}

              {(eyeCamera.error || roomCamera.error) && (
                <div className="camera-error" role="alert">
                  <strong>카메라 연결 오류</strong>
                  <span>{setupStage === 'ROOM_CAMERA' ? roomCamera.error?.name : eyeCamera.error?.name}</span>
                  <p>{setupStage === 'ROOM_CAMERA' ? roomCamera.error?.message : eyeCamera.error?.message}</p>
                </div>
              )}
            </div>

          </section>
        </>
      )}

      {canShowRoomControl && (
        <section className="room-fullscreen" id="main-view">
          {roomCameraReady ? (
            <video className="room-video" ref={roomCamera.videoRef} muted playsInline aria-label="외장 룸 카메라 화면" />
          ) : (
            <div className="room-empty-feed" role="img" aria-label="외장 카메라 연결 대기 화면" />
          )}

          <div className="mini-brand" aria-label="EyeCan Room">
            <span className="brand-mark"><i /><i /></span>
            <strong>EyeCan Room</strong>
          </div>
          <button className="room-settings-button" type="button" aria-label="설정" onClick={openSettingsRotation}>⚙</button>

          <div className={`gaze-pill gaze-${visibleGazeDirection.toLowerCase()}`}>
            <span>●</span> 시선 · {directionLabel[visibleGazeDirection]}
          </div>
          <div className="gaze-cursor" style={{ '--gaze-x': gazeCursor.x, '--gaze-y': gazeCursor.y } as CSSProperties} aria-hidden="true"><i /></div>

          {store.interactionMode !== 'EXPLORE' && (
            <section className="radial-overlay" aria-live="polite">
              <header className="radial-heading">
                <small>{isTargetChoice ? '제어 대상 선택' : `${radialTarget.name} 제어`}</small>
                <h1>{isTargetChoice ? '무엇을 제어할까요?' : '명령이 돌아가며 선택됩니다'}</h1>
                <p>{isTargetChoice ? '커튼과 창문 중 원하는 대상을 먼저 선택하세요.' : '원하는 명령이 위에 오면 길게 눈을 감으세요.'}</p>
              </header>
              <div className="radial-selector">
                <div className="selection-marker"><span>선택 위치</span><i /></div>
                <div className="command-wheel" style={{ '--wheel-rotation': `${radialRotation}deg` } as CSSProperties}>
                  {scanList.map((item, index) => {
                    const angle = index * radialStepAngle;
                    const counterRotation = -(radialRotation + angle);
                    return (
                      <div className={index === activeScanStep ? 'radial-command active' : 'radial-command'} key={item.command} style={{ '--item-angle': `${angle}deg`, '--counter-rotation': `${counterRotation}deg` } as CSSProperties}>
                        <strong>{item.label}</strong>
                        <span>{item.description}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="radial-center">
                  <span>{radialTarget.icon}</span>
                  <strong>{radialTarget.name}</strong>
                  <small>{currentItem.label} 선택 대기</small>
                </div>
                <svg className="radial-timer" viewBox="0 0 120 120" aria-hidden="true">
                  <circle cx="60" cy="60" r="56" />
                  <circle key={activeScanStep} className="timer-progress" cx="60" cy="60" r="56" style={{ animationDuration: `${store.scanIntervalMs}ms` }} />
                </svg>
              </div>
              <div className="radial-current">
                <span className="blink-symbol">◉</span>
                <div><small>{isSettingsMode ? '현재 설정' : isTargetChoice ? '현재 대상' : '현재 명령'}</small><strong>{currentItem.label}</strong></div>
                <button className="blink-select-button" type="button" onClick={() => void selectCurrentScanItem()}>길게 눈감아 선택</button>
              </div>
            </section>
          )}

        </section>
      )}

      {showSimulator && canShowRoomControl && <section className="demo-notice" aria-label="데모 안내"><strong>포인터 테스트</strong><small>방향 버튼으로 시선 포인터를 움직이고 깜빡임으로 로테이션 UI를 확인합니다</small></section>}
      {showSimulator && canShowRoomControl && <section className="simulator" aria-label="개발용 입력 시뮬레이터"><div className="simulator-buttons">{calibrationSteps.map((direction) => <button type="button" key={direction} onClick={() => void postGazeSample(direction)}>{directionLabel[direction]}</button>)}<button type="button" onClick={() => void simulateSelectBlink()}>깜빡임 선택</button><button type="button" onClick={() => void simulateBlink(2100)}>일시정지</button></div></section>}

      {showCalibration && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calibration-title"><section className="calibration-modal"><button className="modal-close" type="button" aria-label="닫기" onClick={() => setShowCalibration(false)}>×</button><span className="step-count">{calibrationIndex + 1} / {calibrationSteps.length}</span><div className={`calibration-target target-${calibrationSteps[calibrationIndex].toLowerCase()}`}><span /></div><h1 id="calibration-title">{calibrationCopy[calibrationSteps[calibrationIndex]]}</h1><p>얼굴은 움직이지 말고 눈동자만 움직여주세요.</p><div className="step-dots">{calibrationSteps.map((step, index) => <i className={index <= calibrationIndex ? 'active' : ''} key={step} />)}</div><button className="primary-button" type="button" onClick={() => void captureCalibrationStep()}>{calibrationIndex === calibrationSteps.length - 1 ? '시선 맞춤 완료' : '이 방향 저장'}</button></section></div>}

      {store.isPaused && <div className="pause-screen"><span>Ⅱ</span><h1>잠시 쉬는 중이에요</h1><p>다시 2초 동안 눈을 감으면 시작합니다.</p><button type="button" onClick={() => void simulateBlink(2100)}>화면 눌러 다시 시작</button></div>}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
      {store.interactionMode !== 'EXPLORE' && <div className="sr-only" aria-live="assertive">{currentItem.label} 항목이 선택 대기 중입니다.</div>}
    </main>
  );
}

export default App;
