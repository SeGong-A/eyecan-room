import { useEffect, useMemo, useRef, useState } from 'react';
import { AppToast } from './components/AppToast';
import { EmergencyAlert } from './components/EmergencyAlert';
import { HomeScreen } from './components/HomeScreen';
import { RadialControl } from './components/RadialControl';
import { RoomView } from './components/RoomView';
import { SetupFlow } from './components/SetupFlow';
import { parentSettingsMenu, scanItems, settingsItems, settingsMeta, targetMeta } from './domain/control';
import { useCameraDirectionTarget } from './hooks/useCameraDirectionTarget';
import { useArduinoController } from './hooks/useArduinoController';
import { useCamera } from './hooks/useCamera';
import { useGazePanTilt } from './hooks/useGazePanTilt';
import { useRotationScanner } from './hooks/useRotationScanner';
import { useToast } from './hooks/useToast';
import { holdGazeMotion } from './lib/arduinoSerial';
import { useAppStore } from './store/useAppStore';
import type { CommandItem, SettingsMenu, SetupStage, ToastTone } from './types/control';

function App() {
  const store = useAppStore();
  const roomCamera = useCamera('environment');
  const [setupStage, setSetupStage] = useState<SetupStage>('HOME');
  const { toast, notify, dismiss } = useToast();
  const [selecting, setSelecting] = useState(false);
  const selectionLock = useRef(false);
  const roomActive = setupStage === 'ROOM';
  const isSettings = store.interactionMode === 'SETTINGS' || store.interactionMode === 'SETTINGS_SUBMENU';
  const menuKey = isSettings ? store.settingsMenu : store.selectedTarget;
  const scanList = useMemo(() => {
    if (isSettings) return settingsItems[store.settingsMenu];
    return scanItems[store.selectedTarget];
  }, [isSettings, store.selectedTarget, store.settingsMenu]);
  const { connectArduinoFromUi, autoConnectGrantedArduino, disconnectArduinoFromUi, sendArduinoCommand } = useArduinoController(store, notify);
  const { rotationStep, rotationStepRef } = useRotationScanner(store.interactionMode, store.isPaused || store.emergencyActive, store.scanIntervalMs, scanList.length, menuKey);

  useCameraDirectionTarget(store.arduinoLevels.pan, store.arduinoLevels.tilt,
    roomActive && store.arduinoStatus === 'CONNECTED' && store.motionProtocolReady && store.hasArduinoAngle,
    store.activeAngleTarget, store.setActiveAngleTarget);
  useGazePanTilt({
    omega: store.gazeOmega, sampleSequence: store.sampleSequence, trackingSessionId: store.trackingSessionId,
    faceDetected: store.faceDetected, gazeReady: store.gazeReady, calibrationActive: store.calibrationActive,
    isBlinking: store.isBlinking, saccadeBraking: store.saccadeBraking, connectionState: store.connectionState,
    arduinoStatus: store.arduinoStatus, motionProtocolReady: store.motionProtocolReady,
    panSign: store.motorPanSign, tiltSign: store.motorTiltSign, levels: store.arduinoLevels,
    isPaused: store.isPaused || store.emergencyActive || store.interactionMode !== 'EXPLORE', isActive: roomActive
  });

  const lastBlinkRef = useRef(0);
  useEffect(() => {
    document.documentElement.dataset.theme = store.themeMode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', store.themeMode === 'dark' ? '#171B1A' : '#F7F9F8');
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
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${protocol}://${window.location.host}/ws/state`);
      socket.addEventListener('open', () => store.setConnectionState('STREAMING'));
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
    return () => { disposed = true; window.clearTimeout(retryId); socket?.close(); };
  }, [store.setConnectionState, store.syncFromServer, notify]);
  useEffect(() => {
    if (!store.blinkSequence || store.blinkSequence === lastBlinkRef.current || store.emergencyActive) return;
    lastBlinkRef.current = store.blinkSequence;
    if (!roomActive) return;
    if (store.lastBlinkEvent === 'CANCEL') {
      if (store.interactionMode !== 'EXPLORE') void returnToExplore('방 화면으로 돌아갑니다');
      return;
    }
    if (store.lastBlinkEvent === 'SELECT' && !store.isPaused) void selectCurrentItem();
  }, [store.blinkSequence, store.emergencyActive]);

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
    store.setSelectedTarget(target);
    store.setInteractionMode('COMMAND');
    await request(`/state/target?target=${target}`);
    await request('/state/mode?mode=COMMAND');
  }
  async function openSettings() {
    if (store.interactionMode !== 'EXPLORE' || selectionLock.current || store.emergencyActive) return;
    if (store.arduinoStatus === 'CONNECTED' && store.motionProtocolReady) {
      if (!await holdGazeMotion()) { notify('카메라 정지 응답을 확인하지 못했습니다', 'error'); return; }
    }
    if (useAppStore.getState().emergencyActive) return;
    store.setSettingsMenu('ROOT');
    store.setInteractionMode('SETTINGS');
  }
  function openSettingsMenu(menu: SettingsMenu) {
    store.setSettingsMenu(menu);
    store.setInteractionMode(menu === 'ROOT' ? 'SETTINGS' : 'SETTINGS_SUBMENU');
  }
  async function selectCurrentItem() {
    if (selectionLock.current || store.emergencyActive || store.isPaused) return;
    selectionLock.current = true;
    setSelecting(true);
    try {
      if (store.interactionMode === 'EXPLORE') { await openCurrentTarget(); return; }
      const item = scanList[rotationStepRef.current % scanList.length];
      if (!item || item.command === 'CANCEL') { await returnToExplore('선택을 취소했습니다'); return; }
      if (isSettings) { await selectSetting(item); return; }
      const result = await sendArduinoCommand(item.command);
      const delivered = result.ok && !result.rejected;
      const logged = await request(`/events/command?command=${encodeURIComponent(item.command)}`, false);
      await returnToExplore(delivered
        ? `${item.description} 명령을 전달했습니다${logged ? '' : ' · 서버 기록 연결 실패'}`
        : result.error ?? '기기에 명령을 전달하지 못했습니다', delivered ? logged ? 'success' : 'info' : 'error');
    } finally { selectionLock.current = false; setSelecting(false); }
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
      if (await request(`/vision/learning?enabled=${enabled}`)) await returnToExplore(`온라인 학습 ${enabled ? '시작' : '일시정지'}를 요청했습니다`, 'success');
      return;
    }
    if (item.command === 'SETTINGS_SAVE_MODEL' && await request('/vision/model/save')) await returnToExplore('개인화 모델 저장을 요청했습니다', 'success');
    if (item.command === 'SETTINGS_RESET_MODEL' && await request('/vision/model/reset')) await returnToExplore('시선 모델 초기화를 요청했습니다', 'success');
  }

  const activeStep = rotationStep % scanList.length;
  const currentItem = scanList[activeStep];
  const radialTarget = isSettings ? settingsMeta[store.settingsMenu] : targetMeta[store.selectedTarget];
  const settingStatus = isSettings && store.settingsMenu === 'SCAN_SPEED' ? `현재 ${store.scanIntervalMs / 1000}초`
    : isSettings && store.settingsMenu === 'THEME' ? store.themeMode === 'dark' ? '다크 모드' : '라이트 모드'
    : isSettings && store.settingsMenu === 'LEARNING' ? store.learningEnabled ? '학습 중' : '학습 일시정지' : undefined;

  return <main className={`app ${roomActive ? 'app--room' : ''}`}>
    {setupStage === 'HOME' && <HomeScreen onStart={() => setSetupStage('EYE_CAMERA')} />}
    {setupStage !== 'HOME' && !roomActive && <SetupFlow roomCamera={roomCamera} setupStage={setupStage} store={store}
      onStartVision={() => void request('/vision/start')} onContinue={() => setSetupStage('ROOM_CAMERA')}
      onConnectRoomCamera={() => { void roomCamera.connect(); void connectArduinoFromUi(); }} />}
    {roomActive && <RoomView roomCameraReady={roomCamera.status === 'READY'} roomVideoRef={roomCamera.videoRef} store={store}
      onConnectArduino={() => void connectArduinoFromUi()} onDisconnectArduino={() => void disconnectArduinoFromUi()}
      onReconnectCamera={() => void roomCamera.connect()} onOpenSettings={() => void openSettings()}>
      {store.interactionMode !== 'EXPLORE' && !store.emergencyActive && <RadialControl key={`${store.interactionMode}-${menuKey}`}
        activeScanStep={activeStep} rotationStep={rotationStep} currentItem={currentItem} radialTarget={radialTarget}
        scanIntervalMs={store.scanIntervalMs} scanList={scanList} status={settingStatus} paused={store.isPaused} busy={selecting} onSelectCurrent={() => void selectCurrentItem()} />}
    </RoomView>}
    {store.emergencyActive && <EmergencyAlert onClear={() => request('/emergency/clear')} />}
    {!store.emergencyActive && <AppToast toast={toast} onDismiss={dismiss} />}
  </main>;
}

export default App;
