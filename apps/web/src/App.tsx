import { useEffect, useMemo, useRef, useState } from 'react';
import { AppToast } from './components/AppToast';
import { HomeScreen } from './components/HomeScreen';
import { RadialControl } from './components/RadialControl';
import { RoomView } from './components/RoomView';
import { SetupFlow } from './components/SetupFlow';
import { positionItems, scanItems, scanSpeedItems, settingsRootItems, targetMeta, themeItems } from './domain/control';
import { useAngleTarget } from './hooks/useAngleTarget';
import { useArduinoController } from './hooks/useArduinoController';
import { useCamera } from './hooks/useCamera';
import { useGazePanTilt } from './hooks/useGazePanTilt';
import { useRotationScanner } from './hooks/useRotationScanner';
import { connectIpadController, disconnectIpadController, isIpadSerialSupported, sendIpadVolume } from './lib/ipadSerial';
import { useAppStore } from './store/useAppStore';
import type { CommandItem, CommandLogItem, ScanTarget, SetupStage } from './types/control';
import { clamp } from './utils/gaze';

function App() {
  const store = useAppStore();
  const eyeCamera = useCamera('user');
  const roomCamera = useCamera('environment');
  const [setupStage, setSetupStage] = useState<SetupStage>('HOME');
  const [toast, setToast] = useState('');
  const [commandLog, setCommandLog] = useState<CommandLogItem[]>([]);
  const [demoAngles, setDemoAngles] = useState(false);
  const roomActive = setupStage === 'ROOM';
  const scanList = useMemo(() => {
    if (store.interactionMode === 'SETTINGS') return settingsRootItems;
    if (store.interactionMode === 'SETTINGS_SUBMENU') {
      if (store.settingsMenu === 'SCAN_SPEED') return scanSpeedItems;
      if (store.settingsMenu === 'POSITIONS') return positionItems;
      return themeItems;
    }
    return scanItems[store.selectedTarget] ?? scanItems.IPAD;
  }, [store.interactionMode, store.selectedTarget, store.settingsMenu]);
  const { connectArduinoFromUi, disconnectArduinoFromUi, sendArduinoCommand } = useArduinoController(store, setToast);
  const { rotationStep, rotationStepRef } = useRotationScanner(store.interactionMode, store.isPaused || store.emergencyActive, store.scanIntervalMs, scanList.length);
  const targetSetter = store.setActiveAngleTarget;

  useAngleTarget(
    store.arduinoLevels.pan,
    store.arduinoLevels.tilt,
    store.devicePositions,
    roomActive && (store.arduinoStatus === 'CONNECTED' || demoAngles),
    store.activeAngleTarget,
    targetSetter
  );
  useGazePanTilt(
    store.gazeOmega,
    store.arduinoStatus,
    store.isPaused || store.emergencyActive || store.interactionMode !== 'EXPLORE',
    roomActive,
    sendArduinoCommand
  );

  const lastBlinkRef = useRef(0);
  useEffect(() => { document.documentElement.dataset.theme = store.themeMode; }, [store.themeMode]);
  useEffect(() => {
    store.setIpadStatus(isIpadSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED');
  }, []);
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
      try { store.syncFromServer(JSON.parse(event.data)); }
      catch { setToast('상태 데이터를 읽지 못했습니다'); }
    });
    socket.addEventListener('close', () => store.setConnectionState('DISCONNECTED'));
    socket.addEventListener('error', () => store.setConnectionState('DISCONNECTED'));
    return () => socket.close();
  }, [store.setConnectionState, store.syncFromServer]);
  useEffect(() => {
    if (!store.blinkSequence || store.blinkSequence === lastBlinkRef.current || store.emergencyActive) return;
    lastBlinkRef.current = store.blinkSequence;
    if (store.lastBlinkEvent === 'CANCEL') { void returnToExplore('방 화면으로 돌아갑니다'); return; }
    if (store.lastBlinkEvent !== 'SELECT' || store.isPaused) return;
    void selectCurrentItem();
  }, [store.blinkSequence, store.emergencyActive]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function request(url: string) {
    try { return (await fetch(url, { method: 'POST' })).ok; }
    catch { store.setConnectionState('DISCONNECTED'); setToast('API 서버에 연결되지 않았습니다'); return false; }
  }
  async function postCommand(command: string, target: string, label: string) {
    const sent = await request(`/events/command?command=${encodeURIComponent(command)}`);
    const status: CommandLogItem['status'] = sent ? 'sent' : 'offline';
    setCommandLog((items) => [{ id: Date.now(), target, label, command, status }, ...items].slice(0, 6));
  }
  async function returnToExplore(message?: string) {
    store.setInteractionMode('EXPLORE');
    store.setSettingsMenu('ROOT');
    store.setScanStep(0);
    await request('/state/mode?mode=EXPLORE');
    if (message) setToast(message);
  }
  async function openCurrentTarget() {
    const target = store.activeAngleTarget;
    if (!target) { setToast('등록된 기기 위치가 아닙니다'); return; }
    store.setSelectedTarget(target);
    store.setInteractionMode('COMMAND');
    await request(`/state/target?target=${target}`);
    await request('/state/mode?mode=COMMAND');
  }
  async function selectCurrentItem() {
    if (store.interactionMode === 'EXPLORE') { await openCurrentTarget(); return; }
    const item = scanList[rotationStepRef.current % scanList.length];
    if (!item || item.command === 'CANCEL') { await returnToExplore('선택을 취소합니다'); return; }
    if (store.interactionMode === 'SETTINGS' || store.interactionMode === 'SETTINGS_SUBMENU') { await selectSetting(item); return; }
    if (item.command.startsWith('IPAD_VOLUME_')) {
      if (store.ipadStatus !== 'CONNECTED' || !store.ipadBleConnected) {
        await returnToExplore('iPad 제어 장치의 USB 연결과 Bluetooth 페어링을 확인해주세요');
        return;
      }
      const result = await sendIpadVolume(item.command.endsWith('UP') ? 'UP' : 'DOWN');
      await postCommand(item.command, 'iPad', item.label);
      await returnToExplore(result.message);
      return;
    }
    const result = await sendArduinoCommand(item.command);
    await postCommand(item.command, targetMeta[store.selectedTarget].name, item.label);
    await returnToExplore(result.ok ? item.description : `${item.description} · ${result.error}`);
  }
  async function selectSetting(item: CommandItem) {
    if (item.command === 'SETTINGS_CLOSE') { await returnToExplore('설정을 닫습니다'); return; }
    if (item.command === 'BACK') { store.setSettingsMenu('ROOT'); store.setInteractionMode('SETTINGS'); return; }
    if (item.command === 'SETTINGS_SCAN_SPEED') { store.setSettingsMenu('SCAN_SPEED'); store.setInteractionMode('SETTINGS_SUBMENU'); return; }
    if (item.command === 'SETTINGS_THEME') { store.setSettingsMenu('THEME'); store.setInteractionMode('SETTINGS_SUBMENU'); return; }
    if (item.command === 'SETTINGS_POSITIONS') { store.setSettingsMenu('POSITIONS'); store.setInteractionMode('SETTINGS_SUBMENU'); return; }
    if (item.command.startsWith('POSITION_')) {
      const target = item.command.replace('POSITION_', '') as ScanTarget;
      store.registerDevicePosition(target);
      await returnToExplore(`${targetMeta[target].name} 위치를 Pan ${store.arduinoLevels.pan}°, Tilt ${store.arduinoLevels.tilt}°로 저장했습니다`);
      return;
    }
    if (item.command.startsWith('SCAN_SPEED_')) {
      const interval = Number(item.command.replace('SCAN_SPEED_', ''));
      store.setScanIntervalMs(interval); await request(`/state/scan-speed?scan_interval_ms=${interval}`); await returnToExplore(`로테이션 시간을 ${interval / 1000}초로 설정합니다`); return;
    }
    if (item.command === 'THEME_LIGHT' || item.command === 'THEME_DARK') {
      store.setThemeMode(item.command === 'THEME_DARK' ? 'dark' : 'light'); await returnToExplore('화면 모드를 변경했습니다'); return;
    }
    if (item.command === 'SETTINGS_LEARNING') {
      const enabled = !store.learningEnabled; await request(`/vision/learning?enabled=${enabled}`); await returnToExplore(`온라인 학습을 ${enabled ? '시작합니다' : '일시정지합니다'}`); return;
    }
    if (item.command === 'SETTINGS_SAVE_MODEL') { await request('/vision/model/save'); await returnToExplore('개인화 시선 모델 저장을 요청했습니다'); return; }
    if (item.command === 'SETTINGS_RESET_MODEL') { await request('/vision/model/reset'); await returnToExplore('시선 모델을 기본값으로 초기화합니다'); return; }
    if (item.command === 'SETTINGS_IPAD') { await connectIpad(); await returnToExplore(); }
  }
  async function connectIpad() {
    store.setIpadStatus('CONNECTING'); store.setIpadError(null);
    try {
      await disconnectIpadController();
      await connectIpadController((line) => {
        if (line === 'BLE_CONNECTED') store.setIpadBleConnected(true);
        if (line === 'BLE_DISCONNECTED') store.setIpadBleConnected(false);
        if (line === 'DISCONNECTED') { store.setIpadStatus('DISCONNECTED'); store.setIpadBleConnected(false); }
        if (line.startsWith('ERR')) store.setIpadError(line);
      });
      store.setIpadStatus('CONNECTED');
      setToast('iPad 제어 장치를 연결했습니다. iPad Bluetooth 페어링을 확인해주세요');
    } catch (error) {
      store.setIpadStatus('ERROR'); store.setIpadError(error instanceof Error ? error.message : '연결 오류');
    }
  }
  function mockTarget(target: ScanTarget) {
    const defaults: Record<ScanTarget, { pan: number; tilt: number }> = {
      CURTAIN: { pan: 45, tilt: 20 }, LIGHT: { pan: 90, tilt: 55 }, FAN: { pan: 135, tilt: 20 }, IPAD: { pan: 90, tilt: 20 }
    };
    setDemoAngles(true);
    const position = store.devicePositions[target] ?? defaults[target];
    if (!store.devicePositions[target]) store.registerDevicePosition(target, position);
    store.setArduinoLevels(position);
  }

  const activeStep = rotationStep % scanList.length;
  const currentItem = scanList[activeStep];
  const isSettings = store.interactionMode === 'SETTINGS' || store.interactionMode === 'SETTINGS_SUBMENU';
  const radialTarget = isSettings ? { name: store.settingsMenu === 'POSITIONS' ? '기기 위치' : '설정', icon: '⚙' } : targetMeta[store.selectedTarget];
  const point = { x: clamp(0.5 + (store.lastGazePoint.x - 0.5) * 2.4, 0.08, 0.92), y: clamp(0.5 + (store.lastGazePoint.y - 0.5) * 2.4, 0.1, 0.9) };

  return <main className={`app theme-${store.themeMode}`}>
    {setupStage === 'HOME' && <HomeScreen onStart={() => setSetupStage('EYE_CAMERA')} />}
    {setupStage !== 'HOME' && !roomActive && <SetupFlow eyeCamera={eyeCamera} roomCamera={roomCamera} setupStage={setupStage} store={store}
      onStartVision={() => void request('/vision/start?camera_index=0')}
      onContinue={() => setSetupStage('ROOM_CAMERA')}
      onConnectRoomCamera={() => void roomCamera.connect()}
      onEnterDemo={() => { setDemoAngles(true); setSetupStage('ROOM'); setToast('UI 데모 화면으로 이동합니다'); }} />}
    {roomActive && <RoomView gazeCursor={{ x: `${point.x * 100}%`, y: `${point.y * 100}%` }} roomCameraReady={roomCamera.status === 'READY'} roomVideoRef={roomCamera.videoRef}
      store={store} visibleGazeDirection={store.gazeDirection} onConnectArduino={() => void connectArduinoFromUi()} onDisconnectArduino={() => void disconnectArduinoFromUi()}
      onOpenSettings={() => { if (store.interactionMode === 'EXPLORE') store.setInteractionMode('SETTINGS'); }} onMockTarget={mockTarget} onDemoSelect={() => void selectCurrentItem()}>
      {store.interactionMode !== 'EXPLORE' && <RadialControl activeScanStep={activeStep} currentItem={currentItem} isSettingsMode={isSettings} isTargetChoice={false}
        radialRotation={-activeStep * (360 / scanList.length)} radialStepAngle={360 / scanList.length} radialTarget={radialTarget} scanIntervalMs={store.scanIntervalMs}
        scanList={scanList} onSelectCurrent={() => void selectCurrentItem()} />}
    </RoomView>}
    {store.emergencyActive && <section className="emergency-alert" role="alertdialog" aria-modal="true">
      <div className="emergency-icon">!</div><h1>응급상황 발생</h1><p>응급호출벨이 작동하였습니다</p><small>시연 모드 · 실제 벨 및 외부 연락은 실행되지 않습니다</small>
      <button type="button" onClick={() => void request('/emergency/clear')}>상황 확인 및 해제</button>
    </section>}
    <AppToast message={toast} />
    {store.interactionMode !== 'EXPLORE' && <div className="sr-only" aria-live="assertive">{currentItem.label} 항목이 선택 대기 중입니다.</div>}
  </main>;
}

export default App;
