import { useEffect, useMemo, useRef, useState } from 'react';
import { AppToast } from './components/AppToast';
import { DemoControls } from './components/DemoControls';
import { HomeScreen } from './components/HomeScreen';
import { RadialControl } from './components/RadialControl';
import { RoomView } from './components/RoomView';
import { SetupFlow } from './components/SetupFlow';
import {
  calibrationCopy,
  calibrationSteps,
  directionLabel,
  scanItems,
  scanSpeedItems,
  settingsRootItems,
  targetByGazeDirection,
  targetChoiceItems,
  targetMeta,
  themeItems
} from './domain/control';
import { useArduinoController } from './hooks/useArduinoController';
import { useCamera } from './hooks/useCamera';
import { useGazeDemoControls } from './hooks/useGazeDemoControls';
import { useRotationScanner } from './hooks/useRotationScanner';
import { useAppStore } from './store/useAppStore';
import type { CommandItem, CommandLogItem, FullGazeDirection, ScanTarget, SetupStage } from './types/control';
import { clamp, directionFromPoint } from './utils/gaze';

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
  const scanList = useMemo(() => {
    if (store.interactionMode === 'SETTINGS') return settingsRootItems;
    if (store.interactionMode === 'SETTINGS_SUBMENU') {
      return store.settingsMenu === 'SCAN_SPEED' ? scanSpeedItems : themeItems;
    }
    return store.interactionMode === 'TARGET_CHOICE' ? targetChoiceItems : scanItems[store.selectedTarget];
  }, [store.interactionMode, store.selectedTarget, store.settingsMenu]);
  const { connectArduinoFromUi, disconnectArduinoFromUi, sendArduinoCommand } = useArduinoController(store, setToast);
  const { rotationStep, rotationStepRef } = useRotationScanner(
    store.interactionMode,
    store.isPaused,
    store.scanIntervalMs,
    scanList.length
  );
  const lastProcessedBlinkSequenceRef = useRef(0);
  const trackedPointRef = useRef(trackedGazePoint);
  const simulatedGazeDirectionRef = useRef<FullGazeDirection>('CENTER');
  const { postGazeSample, simulateBlink } = useGazeDemoControls({
    sendRequest,
    setTrackedGazePoint,
    simulatedGazeDirectionRef,
    store,
    trackedPointRef
  });

  useEffect(() => { trackedPointRef.current = trackedGazePoint; }, [trackedGazePoint]);

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
    const arduinoResult = await sendArduinoCommand(item.command);
    await postCommand(item.command, targetMeta[store.selectedTarget].name, item.label);
    updateTvMock(item.command);
    const arduinoMessage = arduinoResult.ok
      ? ''
      : ` · ${arduinoResult.error ?? 'Arduino가 연결되지 않았습니다'}`;
    await returnToExplore(`${item.description}${arduinoMessage}`);
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
        <HomeScreen onStart={() => setSetupStage('EYE_CAMERA')} />
      )}

      {setupStage !== 'HOME' && !canShowRoomControl && (
        <SetupFlow
          calibrationIndex={calibrationIndex}
          eyeCamera={eyeCamera}
          expectedCalibrationDirection={expectedCalibrationDirection}
          gazeTrackingReady={gazeTrackingReady}
          isExpectedDirection={isExpectedDirection}
          isEyeCalibrationStep={isEyeCalibrationStep}
          roomCamera={roomCamera}
          setupStage={setupStage}
          store={store}
          onCaptureCalibrationStep={() => void captureCalibrationStep()}
          onConnectEyeCameraAndStartVision={() => void connectEyeCameraAndStartVision()}
          onConnectRoomCameraAndEnter={() => void connectRoomCameraAndEnter()}
          onStartDemoMode={() => void startDemoMode()}
          onToggleSimulator={() => setShowSimulator((value) => !value)}
        />
      )}

      {canShowRoomControl && (
        <RoomView
          gazeCursor={gazeCursor}
          roomCameraReady={roomCameraReady}
          roomVideoRef={roomCamera.videoRef}
          store={store}
          visibleGazeDirection={visibleGazeDirection}
          onConnectArduino={() => void connectArduinoFromUi()}
          onDisconnectArduino={() => void disconnectArduinoFromUi()}
          onOpenSettings={openSettingsRotation}
        >
          {store.interactionMode !== 'EXPLORE' && (
            <RadialControl
              activeScanStep={activeScanStep}
              currentItem={currentItem}
              isSettingsMode={isSettingsMode}
              isTargetChoice={isTargetChoice}
              radialRotation={radialRotation}
              radialStepAngle={radialStepAngle}
              radialTarget={radialTarget}
              scanIntervalMs={store.scanIntervalMs}
              scanList={scanList}
              onSelectCurrent={() => void selectCurrentScanItem()}
            />
          )}
        </RoomView>
      )}

      {showSimulator && canShowRoomControl && (
        <DemoControls
          onGazeSample={(direction) => void postGazeSample(direction)}
          onSelectBlink={() => void simulateSelectBlink()}
          onPauseBlink={() => void simulateBlink(2100)}
        />
      )}

      {showCalibration && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calibration-title"><section className="calibration-modal"><button className="modal-close" type="button" aria-label="닫기" onClick={() => setShowCalibration(false)}>×</button><span className="step-count">{calibrationIndex + 1} / {calibrationSteps.length}</span><div className={`calibration-target target-${calibrationSteps[calibrationIndex].toLowerCase()}`}><span /></div><h1 id="calibration-title">{calibrationCopy[calibrationSteps[calibrationIndex]]}</h1><p>얼굴은 움직이지 말고 눈동자만 움직여주세요.</p><div className="step-dots">{calibrationSteps.map((step, index) => <i className={index <= calibrationIndex ? 'active' : ''} key={step} />)}</div><button className="primary-button" type="button" onClick={() => void captureCalibrationStep()}>{calibrationIndex === calibrationSteps.length - 1 ? '시선 맞춤 완료' : '이 방향 저장'}</button></section></div>}

      {store.isPaused && <div className="pause-screen"><span>Ⅱ</span><h1>잠시 쉬는 중이에요</h1><p>다시 2초 동안 눈을 감으면 시작합니다.</p><button type="button" onClick={() => void simulateBlink(2100)}>화면 눌러 다시 시작</button></div>}
      <AppToast message={toast} />
      {store.interactionMode !== 'EXPLORE' && <div className="sr-only" aria-live="assertive">{currentItem.label} 항목이 선택 대기 중입니다.</div>}
    </main>
  );
}

export default App;
