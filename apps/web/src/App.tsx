import { useEffect, useMemo, useRef, useState } from 'react';
import { AppToast } from './components/AppToast';
import { CaregiverSettings } from './components/CaregiverSettings';
import { EmergencyAlert } from './components/EmergencyAlert';
import { HomeScreen } from './components/HomeScreen';
import { RadialControl } from './components/RadialControl';
import { RoomView } from './components/RoomView';
import { SetupFlow } from './components/SetupFlow';
import { ObjectDetectionOverlay } from './components/ObjectDetectionOverlay';
import { useObjectDetection } from './hooks/useObjectDetection';
import { useSpeech } from './hooks/useSpeech';
import { useAacController } from './hooks/useAacController';
import { contextItems, contextMeta } from './domain/aac';
import { parentSettingsMenu, scanItems, settingsItems, settingsMeta, targetMeta } from './domain/control';
import { useCameraDirectionTarget } from './hooks/useCameraDirectionTarget';
import { useArduinoController } from './hooks/useArduinoController';
import { useCamera } from './hooks/useCamera';
import { useGazePanTilt } from './hooks/useGazePanTilt';
import { useRotationScanner } from './hooks/useRotationScanner';
import { useToast } from './hooks/useToast';
import { useFullscreenShortcut } from './hooks/useFullscreenShortcut';
import { holdGazeMotion } from './lib/arduinoSerial';
import { openTVDisplayWindow } from './lib/tvDisplayWindow';
import { useAppStore } from './store/useAppStore';
import type { CommandItem, SettingsMenu, SetupStage, ToastTone } from './types/control';
import type { ScanTarget } from './types/control';
import type { AacObjectType } from './types/aac';

const SUCCESS_FEEDBACK_MS = 1000;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function App() {
  useFullscreenShortcut();
  const store = useAppStore();
  const roomCamera = useCamera('environment');
  const [setupStage, setSetupStage] = useState<SetupStage>('HOME');
  const { toast, notify, dismiss } = useToast();
  const [selecting, setSelecting] = useState(false);
  const [caregiverOpen, setCaregiverOpen] = useState(false);
  const [contextChoice, setContextChoice] = useState<{ target: ScanTarget; objects: AacObjectType[] } | null>(null);
  const selectionLock = useRef(false);
  const blinkSnapshotRef = useRef<CommandItem | null>(null);
  const roomActive = setupStage === 'ROOM';
  const roomVideoVisible = useRef(false);
  roomVideoVisible.current = roomActive && roomCamera.status === 'READY' && !store.emergencyActive;
  const reportRoomVideo = useRef<() => void>(() => {});
  const detector = useObjectDetection(roomActive && roomCamera.status === 'READY', roomCamera.getVideoElement);
  const speech = useSpeech();
  const aac = useAacController({ store, enabled: roomActive && !caregiverOpen, cameraReady: roomCamera.status === 'READY', getCandidates: detector.getCandidates, speech, notify });
  const isSettings = store.interactionMode === 'SETTINGS' || store.interactionMode === 'SETTINGS_SUBMENU';
  const menuKey = aac.active ? `AAC:${aac.generation}` : contextChoice ? `CONTEXT:${contextChoice.target}:${contextChoice.objects.join(',')}` : isSettings ? store.settingsMenu : store.selectedTarget;
  const deviceScanList = useMemo(() => {
    if (isSettings) return settingsItems[store.settingsMenu];
    return scanItems[store.selectedTarget];
  }, [isSettings, store.selectedTarget, store.settingsMenu]);
  const contextScanList = useMemo(() => contextChoice ? contextItems(contextChoice.target, contextChoice.objects) : [], [contextChoice]);
  const scanList = aac.active ? aac.list : contextChoice ? contextScanList : deviceScanList;
  const { connectArduinoFromUi, autoConnectGrantedArduino, disconnectArduinoFromUi, sendArduinoCommand } = useArduinoController(store, notify);
  const { rotationStep, rotationStepRef, isTransitioning, isTransitioningRef } = useRotationScanner(
    aac.active ? aac.phase : store.interactionMode,
    store.isPaused || store.emergencyActive || store.isBlinking || selecting || (aac.active && !aac.inputReady),
    store.scanIntervalMs,
    scanList.length,
    menuKey
  );

  useCameraDirectionTarget(store.arduinoLevels.pan, store.arduinoLevels.tilt,
    roomActive && !caregiverOpen && store.arduinoStatus === 'CONNECTED' && store.motionProtocolReady && store.hasArduinoAngle,
    store.activeAngleTarget, store.setActiveAngleTarget);
  useGazePanTilt({
    omega: store.gazeOmega, sampleSequence: store.sampleSequence, trackingSessionId: store.trackingSessionId,
    faceDetected: store.faceDetected, gazeReady: store.gazeReady, calibrationActive: store.calibrationActive,
    isBlinking: store.isBlinking, saccadeBraking: store.saccadeBraking, connectionState: store.connectionState,
    arduinoStatus: store.arduinoStatus, motionProtocolReady: store.motionProtocolReady,
    panSign: store.motorPanSign, tiltSign: store.motorTiltSign, levels: store.arduinoLevels,
    isPaused: aac.active || caregiverOpen || store.isPaused || store.emergencyActive || store.interactionMode !== 'EXPLORE', isActive: roomActive
  });

  const lastBlinkRef = useRef('');
  const prevLearningCountRef = useRef(store.learningUpdateCount);
  useEffect(() => {
    document.documentElement.dataset.theme = store.themeMode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', store.themeMode === 'dark' ? '#111B27' : '#F5F7F9');
  }, [store.themeMode]);
  useEffect(() => {
    if (setupStage === 'ROOM_CAMERA' && roomCamera.status === 'READY') {
      setSetupStage('ROOM');
      notify('외장 카메라가 연결되었습니다', 'success');
    }
  }, [roomCamera.status, setupStage, notify]);
  useEffect(() => {
    if (roomActive) void autoConnectGrantedArduino();
  }, [roomActive]);
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryId = 0;
    let disposed = false;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const publishVisibility = (forceHidden = false) => {
      const video = roomCamera.getVideoElement();
      const visible = !forceHidden && roomVideoVisible.current && !document.hidden && !!video &&
        video.readyState >= 2 && !video.paused && !video.ended && video.videoWidth > 0;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'room_video_visibility', visible }));
    };
    const report = () => publishVisibility();
    const hide = () => publishVisibility(true);
    reportRoomVideo.current = report;
    const presenceTimer = window.setInterval(report, 1000);
    document.addEventListener('visibilitychange', report);
    window.addEventListener('pagehide', hide);
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${protocol}://${window.location.host}/ws/state`);
      socket.addEventListener('open', () => { store.setConnectionState('STREAMING'); report(); });
      socket.addEventListener('message', (event) => {
        try { store.syncFromServer(JSON.parse(event.data)); }
        catch { notify('상태 데이터를 읽지 못했습니다', 'error'); }
      });
      socket.addEventListener('close', () => {
        store.setConnectionState('DISCONNECTED');
        if (!disposed) retryId = window.setTimeout(connect, 1000);
      });
      socket.addEventListener('error', () => store.setConnectionState('DISCONNECTED'));
    };
    connect();
    return () => {
      hide(); disposed = true; window.clearTimeout(retryId); window.clearInterval(presenceTimer);
      document.removeEventListener('visibilitychange', report); window.removeEventListener('pagehide', hide);
      reportRoomVideo.current = () => {}; socket?.close();
    };
  }, [store.setConnectionState, store.syncFromServer, notify]);
  useEffect(() => { reportRoomVideo.current(); }, [roomActive, roomCamera.status, store.emergencyActive]);
  useEffect(() => {
    if (store.emergencyActive) setContextChoice(null);
  }, [store.emergencyActive]);
  useEffect(() => {
    // learningUpdateCount는 서버가 PPO 한 스텝을 학습할 때마다(90개 경험이 쌓일 때마다)
    // 증가해서 스냅샷으로 내려온다 — 증가분을 직접 감지해서 매 업데이트마다 토스트로 알린다.
    if (roomVideoVisible.current && store.learningActive && store.learningUpdateCount > prevLearningCountRef.current) {
      notify(`개인화 학습 업데이트 완료 (${store.learningUpdateCount}번째)`, 'success');
    }
    prevLearningCountRef.current = store.learningUpdateCount;
  }, [store.learningUpdateCount, notify]);
  const wasBlinking = useRef(false);
  useEffect(() => {
    const started = store.isBlinking && !wasBlinking.current;
    wasBlinking.current = store.isBlinking;
    if (!roomActive || !started) return;
    const item = isTransitioningRef.current ? null : scanList[rotationStepRef.current % scanList.length] ?? null;
    aac.onEyeClose(aac.scanning ? item : null, isTransitioningRef.current);
    blinkSnapshotRef.current = store.interactionMode === 'EXPLORE' ? null : item;
  }, [roomActive, store.isBlinking]);
  useEffect(() => {
    const blinkId = `${store.trackingSessionId}:${store.blinkSequence}`;
    if (!store.blinkSequence || blinkId === lastBlinkRef.current || store.emergencyActive) return;
    lastBlinkRef.current = blinkId;
    if (!roomActive || caregiverOpen) return;
    if (aac.handleBlink(`${store.trackingSessionId}:${store.blinkSequence}`, store.lastBlinkEvent)) {
      blinkSnapshotRef.current = null;
      return;
    }
    if (store.lastBlinkEvent === 'CANCEL') {
      if (store.interactionMode !== 'EXPLORE') void returnToExplore('방 화면으로 돌아갑니다');
      blinkSnapshotRef.current = null;
      return;
    }
    if (store.lastBlinkEvent === 'SELECT' && !store.isPaused) {
      if (store.interactionMode === 'EXPLORE') void selectCurrentItem();
      else if (blinkSnapshotRef.current) void selectCurrentItem(blinkSnapshotRef.current);
      else notify('항목 이동이 끝난 뒤 다시 선택해주세요', 'info');
    }
    blinkSnapshotRef.current = null;
  }, [caregiverOpen, store.blinkSequence, store.emergencyActive]);

  async function request(url: string, reportError = true) {
    try {
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok && reportError) notify('요청을 처리하지 못했습니다. 다시 시도해주세요.', 'error');
      return response.ok;
    } catch {
      store.setConnectionState('DISCONNECTED');
      if (reportError) notify('시선 서버에 연결하지 못했습니다', 'error');
      return false;
    }
  }
  async function returnToExplore(message?: string, tone: ToastTone = 'info') {
    setContextChoice(null);
    store.setInteractionMode('EXPLORE');
    store.setSettingsMenu('ROOT');
    store.setScanStep(0);
    await request('/state/mode?mode=EXPLORE', !message);
    if (message) notify(message, tone);
  }
  async function openCurrentTarget() {
    const target = store.activeAngleTarget;
    if (!target) { notify('현재 카메라 방향에는 선택할 기기가 없습니다'); return; }
    if (!await holdGazeMotion()) { notify('카메라 정지 응답을 확인하지 못했습니다', 'error'); return; }
    if (useAppStore.getState().emergencyActive) return;
    const objects = detector.getCandidates();
    store.setSelectedTarget(target);
    store.setInteractionMode('COMMAND');
    await request(`/state/target?target=${target}`);
    await request('/state/mode?mode=COMMAND');
    if (objects.length) setContextChoice({ target, objects: [...objects] });
  }
  async function openCaregiverSettings() {
    if (aac.active || store.interactionMode !== 'EXPLORE' || selectionLock.current || store.emergencyActive) return;
    if (store.arduinoStatus === 'CONNECTED' && store.motionProtocolReady) {
      if (!await holdGazeMotion()) { notify('카메라 정지 응답을 확인하지 못했습니다', 'error'); return; }
    }
    if (useAppStore.getState().emergencyActive) return;
    setCaregiverOpen(true);
  }
  function openSettings(menu: SettingsMenu = 'ROOT') {
    setCaregiverOpen(false);
    store.setSettingsMenu(menu);
    store.setInteractionMode(menu === 'ROOT' ? 'SETTINGS' : 'SETTINGS_SUBMENU');
  }
  function openSettingsMenu(menu: SettingsMenu) {
    store.setSettingsMenu(menu);
    store.setInteractionMode(menu === 'ROOT' ? 'SETTINGS' : 'SETTINGS_SUBMENU');
  }
  async function selectCurrentItem(snapshot?: CommandItem) {
    if (aac.active) {
      const item = snapshot ?? scanList[rotationStepRef.current % scanList.length];
      if (item && !isTransitioningRef.current) await aac.select(item);
      return;
    }
    if (selectionLock.current || store.emergencyActive || store.isPaused) return;
    selectionLock.current = true;
    setSelecting(true);
    try {
      if (store.interactionMode === 'EXPLORE') { await openCurrentTarget(); return; }
      const item = snapshot ?? scanList[rotationStepRef.current % scanList.length];
      if (!item || item.command === 'CANCEL') { await returnToExplore('선택을 취소했습니다'); return; }
      if (contextChoice) {
        if (item.command === 'CONTEXT_BACK') { await returnToExplore('방 화면으로 돌아갑니다'); return; }
        if (item.command === `CONTEXT_DEVICE_${contextChoice.target}`) {
          setContextChoice(null);
          store.setScanStep(0);
          return;
        }
        const object = contextChoice.objects.find(type => item.command === `CONTEXT_OBJECT_${type}`);
        if (object) {
          if (!aac.openObjectRequest(object, contextChoice.objects)) {
            notify('시선 및 장치 연결 상태를 다시 확인해주세요', 'error');
            return;
          }
          setContextChoice(null);
          store.setInteractionMode('EXPLORE');
          store.setScanStep(0);
          await request('/state/mode?mode=EXPLORE', false);
        }
        return;
      }
      if (isSettings) { await selectSetting(item); return; }
      if (item.command === 'BACK') {
        await returnToExplore('방 화면으로 돌아갑니다');
        return;
      }
      if (item.command.startsWith('TV_')) { await executeTVCommand(item); return; }
      const result = await sendArduinoCommand(item.command);
      const delivered = result.ok && !result.rejected;
      if (!delivered) {
        notify(result.error ?? '기기에 명령을 전달하지 못했습니다', 'error');
        return;
      }
      const logged = await request(`/events/command?command=${encodeURIComponent(item.command)}`, false);
      notify(`${item.description} 명령을 접수했습니다${logged ? '' : ' · 서버 기록 연결 실패'}`, logged ? 'success' : 'info');
      await wait(SUCCESS_FEEDBACK_MS);
      dismiss();
      await returnToExplore();
    } finally { selectionLock.current = false; setSelecting(false); }
  }
  async function executeTVCommand(item: CommandItem) {
    const commandMap: Record<string, string> = {
      TV_POWER: 'POWER_TOGGLE', TV_CHANNEL_PREV: 'CHANNEL_PREV', TV_CHANNEL_NEXT: 'CHANNEL_NEXT'
    };
    try {
      const response = await fetch(`/tv/command?command=${commandMap[item.command]}`, { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) {
        notify(payload.detail ?? 'TV 명령을 처리하지 못했습니다', 'error');
        return;
      }
      notify(`${item.description} 명령을 접수했습니다`, 'success');
      await wait(SUCCESS_FEEDBACK_MS);
      dismiss();
      await returnToExplore();
    } catch {
      notify('TV 제어 서버에 연결하지 못했습니다', 'error');
    }
  }
  async function setLearningEnabled(enabled: boolean, selectionAlreadyLocked = false) {
    if (selectionLock.current && !selectionAlreadyLocked) return false;
    if (!selectionAlreadyLocked) {
      selectionLock.current = true;
      setSelecting(true);
    }
    try {
      const response = await fetch(`/vision/learning?enabled=${enabled}`, { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as Parameters<typeof store.syncFromServer>[0] & { detail?: string };
      if (!response.ok) { notify(payload.detail ?? '가중치 설정을 적용하지 못했습니다', 'error'); return false; }
      store.syncFromServer(payload);
      notify(`가중치 자동 갱신을 ${enabled ? '켰습니다' : '껐습니다'}`, 'success');
      return true;
    } catch {
      notify('시선 서버에 연결하지 못했습니다', 'error');
      return false;
    } finally {
      if (!selectionAlreadyLocked) {
        selectionLock.current = false;
        setSelecting(false);
      }
    }
  }
  async function runCaregiverDeviceCommand(command: string) {
    if (selectionLock.current) return;
    selectionLock.current = true;
    setSelecting(true);
    try {
      const result = await sendArduinoCommand(command);
      notify(result.ok && !result.rejected ? '장치 점검 명령을 접수했습니다' : result.error ?? '장치 명령에 실패했습니다', result.ok && !result.rejected ? 'success' : 'error');
    } finally {
      selectionLock.current = false;
      setSelecting(false);
    }
  }
  async function openTVDisplay() {
    const result = await openTVDisplayWindow();
    notify(result.message, result.ok ? 'info' : 'error');
  }
  async function selectSetting(item: CommandItem) {
    if (item.command === 'SETTINGS_CLOSE') { await returnToExplore('설정을 닫았습니다'); return; }
    if (item.command === 'BACK') { openSettingsMenu(parentSettingsMenu(store.settingsMenu)); return; }
    const submenu: Record<string, SettingsMenu> = {
      SETTINGS_SCAN_SPEED: 'SCAN_SPEED', SETTINGS_THEME: 'THEME', SETTINGS_PERSONALIZATION: 'LEARNING',
      SETTINGS_MOTOR: 'MOTOR', SETTINGS_MOTOR_MOVE: 'MOTOR_MOVE', SETTINGS_MOTOR_DIRECTION: 'MOTOR_DIRECTION'
    };
    if (submenu[item.command]) { openSettingsMenu(submenu[item.command]); return; }
    if (item.command === 'MOTOR_FLIP_PAN' || item.command === 'MOTOR_FLIP_TILT') {
      if (item.command === 'MOTOR_FLIP_PAN') store.setMotorPanSign(store.motorPanSign === 1 ? -1 : 1);
      else store.setMotorTiltSign(store.motorTiltSign === 1 ? -1 : 1);
      notify(`${item.label}을 적용했습니다`, 'success'); return;
    }
    if (item.command === 'MOTOR_SETUP_DONE') {
      store.setMotorSetupComplete(true); await returnToExplore('모터 방향 점검을 완료했습니다', 'success'); return;
    }
    const motorCommands: Record<string, string> = { MOTOR_LEFT: 'CAM_LEFT:3', MOTOR_RIGHT: 'CAM_RIGHT:3', MOTOR_UP: 'CAM_DOWN:3', MOTOR_DOWN: 'CAM_UP:3' };
    if (motorCommands[item.command]) {
      const result = await sendArduinoCommand(motorCommands[item.command]);
      const delivered = result.ok && !result.rejected;
      notify(delivered ? `${item.description} 명령을 전달했습니다` : result.error ?? '모터 점검 명령에 실패했습니다', delivered ? 'success' : 'error'); return;
    }
    if (item.command.startsWith('SCAN_SPEED_')) {
      const interval = Number(item.command.replace('SCAN_SPEED_', ''));
      store.setScanIntervalMs(interval);
      const synced = await request(`/state/scan-speed?scan_interval_ms=${interval}`, false);
      await returnToExplore(`선택 속도를 ${interval / 1000}초로 설정했습니다${synced ? '' : ' · 서버 동기화 대기'}`, synced ? 'success' : 'info'); return;
    }
    if (item.command === 'THEME_LIGHT' || item.command === 'THEME_DARK') {
      store.setThemeMode(item.command === 'THEME_DARK' ? 'dark' : 'light');
      await returnToExplore(`${item.command === 'THEME_DARK' ? '다크' : '라이트'} 모드로 변경했습니다`, 'success'); return;
    }
    if (item.command === 'SETTINGS_LEARNING') {
      const enabled = !store.learningEnabled;
      if (await setLearningEnabled(enabled, true)) await returnToExplore();
      return;
    }
    if (item.command === 'SETTINGS_SAVE_MODEL' && await request('/vision/model/save')) await returnToExplore('개인화 모델 저장을 요청했습니다', 'success');
    if (item.command === 'SETTINGS_RESET_MODEL' && await request('/vision/model/reset')) await returnToExplore('시선 모델 초기화를 요청했습니다', 'success');
  }

  const activeStep = rotationStep % scanList.length;
  const currentItem = scanList[activeStep];
  const radialTarget = aac.active ? aac.meta : contextChoice ? contextMeta : isSettings ? settingsMeta[store.settingsMenu] : targetMeta[store.selectedTarget];
  const settingStatus = isSettings && store.settingsMenu === 'SCAN_SPEED' ? `현재 ${store.scanIntervalMs / 1000}초`
    : isSettings && store.settingsMenu === 'THEME' ? store.themeMode === 'dark' ? '다크 모드' : '라이트 모드'
    : isSettings && store.settingsMenu === 'LEARNING' ? store.learningEnabled ? '자동 갱신 켜짐' : '자동 갱신 꺼짐'
    : store.selectedTarget === 'TV' ? store.tv.power ? `현재 채널 ${store.tv.channel}` : '전원 꺼짐' : undefined;

  return <main className={`app ${roomActive ? 'app--room' : ''}`}>
    {setupStage === 'HOME' && <HomeScreen onStart={() => setSetupStage('EYE_CAMERA')} />}
    {setupStage !== 'HOME' && !roomActive && <SetupFlow roomCamera={roomCamera} setupStage={setupStage} store={store}
      onStartVision={() => void request('/vision/start')} onContinue={() => setSetupStage('ROOM_CAMERA')}
      onConnectRoomCamera={() => { void roomCamera.connect(); void connectArduinoFromUi(); }} />}
    {roomActive && <RoomView aacActive={aac.active} aacReady={aac.directionReady} roomCameraReady={roomCamera.status === 'READY'} roomVideoRef={roomCamera.videoRef} store={store}
      onConnectArduino={() => void connectArduinoFromUi()} onDisconnectArduino={() => void disconnectArduinoFromUi()}
      onReconnectCamera={() => void roomCamera.connect()} onOpenSettings={() => void openCaregiverSettings()}>
      <ObjectDetectionOverlay detector={detector} directionReady={aac.directionReady} hidden={aac.active || caregiverOpen || store.interactionMode !== 'EXPLORE' || store.emergencyActive} />
      {aac.active && <div className="aac-caption" role="status">{!aac.inputReady && aac.scanning ? '시선 및 장치 연결 확인 중 · 선택 일시정지' : aac.phase === 'SPEAKING' ? `${aac.message} · ${speech.status}` : aac.message}</div>}
      {(aac.scanning || (!aac.active && store.interactionMode !== 'EXPLORE')) && !store.emergencyActive && <RadialControl key={`${store.interactionMode}-${menuKey}`}
        activeScanStep={activeStep} rotationStep={rotationStep} currentItem={currentItem} radialTarget={radialTarget}
        scanIntervalMs={store.scanIntervalMs} scanList={scanList} status={aac.active ? undefined : settingStatus}
        paused={store.isPaused || store.isBlinking || (aac.active && !aac.inputReady)} transitioning={isTransitioning} busy={selecting} />}
    </RoomView>}
    {roomActive && <CaregiverSettings open={caregiverOpen} store={store} busy={selecting} onClose={() => setCaregiverOpen(false)}
      onOpenRotationSettings={() => openSettings('ROOT')} onOpenMotorSettings={() => openSettings('MOTOR')}
      onConnectArduino={() => void connectArduinoFromUi()} onDisconnectArduino={() => void disconnectArduinoFromUi()}
      onToggleLearning={(enabled) => void setLearningEnabled(enabled)} onOpenTV={() => void openTVDisplay()}
      onDeviceCommand={(command) => void runCaregiverDeviceCommand(command)}
      speech={speech} detector={detector} onExportAacLogs={aac.exportLogs} />}
    {store.emergencyActive && <EmergencyAlert onClear={() => request('/emergency/clear')} />}
    {!store.emergencyActive && <AppToast toast={toast} onDismiss={dismiss} />}
  </main>;
}

export default App;
