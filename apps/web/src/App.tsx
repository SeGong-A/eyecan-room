import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useCamera, type CameraStatus } from './hooks/useCamera';
import {
  useAppStore,
  type FullGazeDirection,
  type InteractionMode,
  type ScanTarget
} from './store/useAppStore';

type CommandItem = { label: string; description: string; command: string };

const targetMeta: Record<ScanTarget, { name: string; icon: string }> = {
  FAN: { name: '선풍기', icon: '✣' },
  LIGHT: { name: '조명', icon: '☀' },
  TV: { name: 'TV', icon: '▣' },
  CURTAIN: { name: '커튼', icon: '▥' }
};

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
  ]
};

const gazeSamples: Record<FullGazeDirection, { x: number; y: number }> = {
  LEFT: { x: 0.28, y: 0.5 }, RIGHT: { x: 0.72, y: 0.5 },
  UP: { x: 0.5, y: 0.28 }, DOWN: { x: 0.5, y: 0.72 }, CENTER: { x: 0.5, y: 0.5 }
};
const cameraCommandByDirection: Record<FullGazeDirection, string> = {
  LEFT: 'CAM_LEFT', RIGHT: 'CAM_RIGHT', UP: 'CAM_UP', DOWN: 'CAM_DOWN', CENTER: 'CAM_STOP'
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

function cameraMessage(status: CameraStatus) {
  if (status === 'REQUESTING') return '카메라 연결을 기다리는 중입니다';
  if (status === 'DENIED') return '브라우저 설정에서 카메라 권한을 허용해주세요';
  if (status === 'UNAVAILABLE') return '사용할 수 있는 카메라를 찾지 못했습니다';
  if (status === 'ERROR') return '카메라 연결 중 문제가 발생했습니다';
  return '내장 카메라를 연결하면 눈의 위치를 확인할 수 있어요';
}

function App() {
  const store = useAppStore();
  const camera = useCamera();
  const [calibrationIndex, setCalibrationIndex] = useState(0);
  const [showCalibration, setShowCalibration] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [toast, setToast] = useState('');
  const [tvState, setTvState] = useState({ power: false, channel: 7, volume: 18 });
  const scanList = useMemo(() => scanItems[store.selectedTarget], [store.selectedTarget]);
  const gazeHoldStartRef = useRef<number | null>(null);
  const lastDirectionRef = useRef(store.gazeDirection);
  const lastDispatchedDirectionRef = useRef<FullGazeDirection | null>(null);
  const lastProcessedBlinkSequenceRef = useRef(0);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/state`);
    socket.addEventListener('open', () => store.setConnectionState('STREAMING'));
    socket.addEventListener('message', (event) => store.syncFromServer(JSON.parse(event.data)));
    socket.addEventListener('close', () => store.setConnectionState('DISCONNECTED'));
    socket.addEventListener('error', () => store.setConnectionState('DISCONNECTED'));
    return () => socket.close();
  }, [store.setConnectionState, store.syncFromServer]);

  useEffect(() => { lastDirectionRef.current = store.gazeDirection; }, [store.gazeDirection]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      if (store.connectionState !== 'STREAMING' || !store.isCalibrated || store.isPaused || store.interactionMode !== 'EXPLORE') {
        gazeHoldStartRef.current = null;
        lastDispatchedDirectionRef.current = null;
        return;
      }
      const now = Date.now();
      if (lastDirectionRef.current !== store.gazeDirection) {
        lastDirectionRef.current = store.gazeDirection;
        gazeHoldStartRef.current = now;
        lastDispatchedDirectionRef.current = null;
        return;
      }
      if (gazeHoldStartRef.current === null) { gazeHoldStartRef.current = now; return; }
      if (now - gazeHoldStartRef.current < 1000 || lastDispatchedDirectionRef.current === store.gazeDirection) return;
      void postCommand(cameraCommandByDirection[store.gazeDirection]);
      lastDispatchedDirectionRef.current = store.gazeDirection;
    }, 250);
    return () => window.clearInterval(timerId);
  }, [store.connectionState, store.gazeDirection, store.interactionMode, store.isCalibrated, store.isPaused]);

  useEffect(() => {
    if (!store.isCalibrated || store.isPaused || store.interactionMode !== 'COMMAND') return;
    const timerId = window.setInterval(
      () => store.setScanStep((step) => (step + 1) % scanList.length),
      store.scanIntervalMs
    );
    return () => window.clearInterval(timerId);
  }, [store.interactionMode, store.isCalibrated, store.isPaused, store.scanIntervalMs, scanList.length, store.setScanStep]);

  useEffect(() => {
    if (!store.blinkSequence || store.blinkSequence === lastProcessedBlinkSequenceRef.current) return;
    lastProcessedBlinkSequenceRef.current = store.blinkSequence;
    if (store.lastBlinkEvent === 'CANCEL') {
      store.setInteractionMode('EXPLORE');
      void postCommand('CAM_STOP');
      return;
    }
    if (store.lastBlinkEvent !== 'SELECT' || !store.isCalibrated || store.isPaused) return;
    if (store.interactionMode === 'EXPLORE') {
      store.setInteractionMode('COMMAND');
      void fetch('/state/mode?mode=COMMAND', { method: 'POST' });
      return;
    }
    const item = scanList[store.scanStep];
    if (!item || item.command === 'CANCEL') {
      store.setInteractionMode('EXPLORE');
      void fetch('/state/mode?mode=EXPLORE', { method: 'POST' });
      return;
    }
    void postCommand(item.command);
    updateTvMock(item.command);
    setToast(`${targetMeta[store.selectedTarget].name} · ${item.label} 명령을 보냈습니다`);
    store.setInteractionMode('EXPLORE');
    store.setScanStep(0);
    void fetch('/state/mode?mode=EXPLORE', { method: 'POST' });
  }, [store.blinkSequence]);

  useEffect(() => {
    if (!toast) return;
    const timerId = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timerId);
  }, [toast]);

  async function postCommand(command: string) {
    await fetch(`/events/command?command=${encodeURIComponent(command)}`, { method: 'POST' });
  }
  async function postGazeSample(direction: FullGazeDirection) {
    const sample = gazeSamples[direction];
    await fetch(`/events/gaze?x=${sample.x}&y=${sample.y}`, { method: 'POST' });
    store.setGazeDirection(direction);
  }
  async function selectTarget(target: ScanTarget) {
    store.setSelectedTarget(target);
    await fetch(`/state/target?target=${target}`, { method: 'POST' });
  }
  async function simulateBlink(durationMs: number) {
    const now = Date.now();
    await fetch(`/events/blink?is_closed=true&now_ms=${now}`, { method: 'POST' });
    await fetch(`/events/blink?is_closed=false&now_ms=${now + durationMs}`, { method: 'POST' });
  }
  async function captureCalibrationStep() {
    await postGazeSample(calibrationSteps[calibrationIndex]);
    if (calibrationIndex < calibrationSteps.length - 1) setCalibrationIndex((index) => index + 1);
    else {
      store.setIsCalibrated(true);
      await fetch('/state/calibration?is_calibrated=true', { method: 'POST' });
      setShowCalibration(false);
      setCalibrationIndex(0);
      setToast('시선 맞춤을 완료했습니다');
    }
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

  const currentItem = scanList[store.scanStep];
  const cameraReady = camera.status === 'READY';
  const radialStepAngle = 360 / scanList.length;
  const radialRotation = -store.scanStep * radialStepAngle;

  return (
    <main className={store.isPaused ? 'app app-paused' : 'app'}>
      <header className="app-header">
        <a className="brand" href="#main-view" aria-label="EyeCan Room 홈">
          <span className="brand-mark"><i /><i /></span>
          <span>EyeCan <strong>Room</strong></span>
        </a>
        <div className="header-status" aria-live="polite">
          <span className={`status-dot ${cameraReady ? 'online' : ''}`} />
          {cameraReady ? '내장 카메라 연결됨' : '카메라 연결 필요'}
        </div>
        <div className="header-actions">
          <button className="text-button" type="button" onClick={() => setShowSimulator((value) => !value)}>테스트 도구</button>
          <button className="icon-button" type="button" aria-label="설정" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </header>

      <section className="main-view" id="main-view">
        <div className="room-stage">
          <div className="room-placeholder" role="img" aria-label="룸 카메라 연결 대기 화면">
            <div className="ambient ambient-one" /><div className="ambient ambient-two" />
            <div className="room-scene"><span className="scene-window" /><span className="scene-sofa" /><span className="scene-lamp" /></div>
            <div className="room-connection-card">
              <span className="camera-glyph">⌁</span>
              <strong>룸 카메라 준비 중</strong>
              <p>USB 룸 카메라는 하드웨어 연결 단계에서 이 화면에 표시됩니다.</p>
            </div>
          </div>

          <div className="focus-zone" aria-hidden="true">
            <i /><i /><i /><i />
            <span>{store.interactionMode === 'COMMAND' ? '선택됨' : '중앙에 맞춘 뒤 길게 눈을 감으세요'}</span>
          </div>
          <div className={`gaze-pill gaze-${store.gazeDirection.toLowerCase()}`}>
            <span>●</span> 시선 · {directionLabel[store.gazeDirection]}
          </div>

          <div className="object-lock" aria-live="polite">
            <span>{targetMeta[store.selectedTarget].icon}</span>
            <div>
              <small>중앙 감지 대상</small>
              <strong>{targetMeta[store.selectedTarget].name}</strong>
            </div>
          </div>

          {store.interactionMode === 'COMMAND' && (
            <section className="radial-overlay" aria-live="polite">
              <header className="radial-heading">
                <small>{targetMeta[store.selectedTarget].name} 제어</small>
                <h1>명령이 돌아가며 선택됩니다</h1>
                <p>원하는 명령이 위에 오면 길게 눈을 감으세요.</p>
              </header>

              <div className="radial-selector">
                <div className="selection-marker">
                  <span>선택 위치</span>
                  <i />
                </div>
                <div
                  className="command-wheel"
                  style={{ '--wheel-rotation': `${radialRotation}deg` } as CSSProperties}
                >
                  {scanList.map((item, index) => {
                    const angle = index * radialStepAngle;
                    const counterRotation = -(radialRotation + angle);
                    return (
                      <div
                        className={index === store.scanStep ? 'radial-command active' : 'radial-command'}
                        key={item.command}
                        style={{
                          '--item-angle': `${angle}deg`,
                          '--counter-rotation': `${counterRotation}deg`
                        } as CSSProperties}
                      >
                        <strong>{item.label}</strong>
                        <span>{item.description}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="radial-center">
                  <span>{targetMeta[store.selectedTarget].icon}</span>
                  <strong>{targetMeta[store.selectedTarget].name}</strong>
                  <small>{currentItem.label} 선택 대기</small>
                </div>
                <svg className="radial-timer" viewBox="0 0 120 120" aria-hidden="true">
                  <circle cx="60" cy="60" r="56" />
                  <circle key={store.scanStep} className="timer-progress" cx="60" cy="60" r="56" style={{ animationDuration: `${store.scanIntervalMs}ms` }} />
                </svg>
              </div>
              <div className="radial-current">
                <span className="blink-symbol">◉</span>
                <div>
                  <small>현재 명령</small>
                  <strong>{currentItem.label}</strong>
                </div>
                <em>길게 눈 감아 선택</em>
              </div>
            </section>
          )}

          {showSimulator && <nav className="target-dock" aria-label="테스트 대상 선택">
            {(Object.keys(targetMeta) as ScanTarget[]).map((target) => (
              <button className={target === store.selectedTarget ? 'active' : ''} key={target} type="button" onClick={() => void selectTarget(target)}>
                <span>{targetMeta[target].icon}</span>{targetMeta[target].name}
              </button>
            ))}
          </nav>}
        </div>

        <aside className="side-panel">
          <section className="eye-camera-card">
            <div className="section-title"><div><small>눈 추적 카메라</small><h2>내장 카메라</h2></div><span className={cameraReady ? 'badge ready' : 'badge'}>{cameraReady ? '연결됨' : '대기'}</span></div>
            <div className="eye-preview">
              <video ref={camera.videoRef} muted playsInline aria-label="내장 카메라 미리보기" />
              {!cameraReady && <div className="preview-empty"><span>◉</span><p>{cameraMessage(camera.status)}</p></div>}
              {cameraReady && <div className="face-guide"><span>얼굴을 안내선 안에 맞춰주세요</span></div>}
            </div>
            {!cameraReady ? (
              <button className="primary-button" type="button" disabled={camera.status === 'REQUESTING'} onClick={() => void camera.connect()}>
                {camera.status === 'REQUESTING' ? '연결하는 중…' : '내장 카메라 연결'}
              </button>
            ) : (
              <div className="camera-controls">
                {camera.devices.length > 1 && <select aria-label="카메라 선택" value={camera.selectedDeviceId} onChange={(event) => void camera.connect(event.target.value)}>{camera.devices.map((device) => <option value={device.deviceId} key={device.deviceId}>{device.label}</option>)}</select>}
                <button type="button" onClick={camera.disconnect}>연결 끊기</button>
              </div>
            )}
          </section>

          <section className="readiness-card">
            <div className="section-title"><div><small>시작 준비</small><h2>{store.isCalibrated ? '사용할 준비가 됐어요' : '시선을 맞춰주세요'}</h2></div><span className="readiness-score">{cameraReady && store.isCalibrated ? '2/2' : cameraReady || store.isCalibrated ? '1/2' : '0/2'}</span></div>
            <ul className="check-list">
              <li className={cameraReady ? 'done' : ''}><span>{cameraReady ? '✓' : '1'}</span><div><strong>내장 카메라</strong><small>{cameraReady ? '정상적으로 연결됐습니다' : '눈을 인식할 카메라를 연결하세요'}</small></div></li>
              <li className={store.isCalibrated ? 'done' : ''}><span>{store.isCalibrated ? '✓' : '2'}</span><div><strong>시선 맞춤</strong><small>{store.isCalibrated ? '시선 맞춤을 완료했습니다' : '5개 방향을 차례로 바라봅니다'}</small></div></li>
            </ul>
            <button className="secondary-button" type="button" disabled={!cameraReady} onClick={() => setShowCalibration(true)}>{store.isCalibrated ? '시선 다시 맞추기' : '시선 맞춤 시작'}</button>
          </section>

          <section className="help-card"><span>눈</span><div><strong>1초 바라보기</strong><small>룸 카메라 이동</small></div><span>—</span><div><strong>0.5초 눈 감기</strong><small>현재 항목 선택</small></div></section>
          {store.selectedTarget === 'TV' && <section className={tvState.power ? 'tv-status on' : 'tv-status'}><span>TV MOCK</span><strong>{tvState.power ? `CH ${tvState.channel}` : 'POWER OFF'}</strong><small>VOL {tvState.volume}</small></section>}
        </aside>
      </section>

      {showSimulator && <section className="simulator" aria-label="개발용 입력 시뮬레이터"><div><strong>입력 테스트</strong><small>실제 시선 인식 연결 전 전체 흐름을 확인합니다</small></div><div className="simulator-buttons">{calibrationSteps.map((direction) => <button type="button" key={direction} onClick={() => void postGazeSample(direction)}>{directionLabel[direction]}</button>)}<button type="button" onClick={() => void simulateBlink(650)}>길게 눈 감기</button><button type="button" onClick={() => void simulateBlink(2100)}>일시정지</button></div></section>}

      {showCalibration && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calibration-title"><section className="calibration-modal"><button className="modal-close" type="button" aria-label="닫기" onClick={() => setShowCalibration(false)}>×</button><span className="step-count">{calibrationIndex + 1} / {calibrationSteps.length}</span><div className={`calibration-target target-${calibrationSteps[calibrationIndex].toLowerCase()}`}><span /></div><h1 id="calibration-title">{calibrationCopy[calibrationSteps[calibrationIndex]]}</h1><p>얼굴은 움직이지 말고 눈동자만 움직여주세요.</p><div className="step-dots">{calibrationSteps.map((step, index) => <i className={index <= calibrationIndex ? 'active' : ''} key={step} />)}</div><button className="primary-button" type="button" onClick={() => void captureCalibrationStep()}>{calibrationIndex === calibrationSteps.length - 1 ? '시선 맞춤 완료' : '이 방향 저장'}</button></section></div>}

      {showSettings && <div className="drawer-backdrop" onClick={() => setShowSettings(false)}><aside className="settings-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><small>EyeCan Room</small><h2>사용 설정</h2></div><button type="button" onClick={() => setShowSettings(false)}>×</button></div><label><span><strong>메뉴 이동 속도</strong><small>강조 항목이 다음으로 이동하는 시간</small></span><b>{(store.scanIntervalMs / 1000).toFixed(1)}초</b></label><input type="range" min="600" max="3000" step="100" value={store.scanIntervalMs} onChange={(event) => { const value = Number(event.target.value); store.setScanIntervalMs(value); void fetch(`/state/scan-speed?scan_interval_ms=${value}`, { method: 'POST' }); }} /><button className="secondary-button" type="button" onClick={() => setShowCalibration(true)} disabled={!cameraReady}>시선 다시 맞추기</button><div className="system-info"><span>API 상태</span><strong>{store.connectionState}</strong><span>마지막 명령</span><strong>{store.lastCommand}</strong></div></aside></div>}

      {store.isPaused && <div className="pause-screen"><span>Ⅱ</span><h1>잠시 쉬는 중이에요</h1><p>다시 2초 동안 눈을 감으면 시작합니다.</p><button type="button" onClick={() => void simulateBlink(2100)}>화면 눌러 다시 시작</button></div>}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
      {store.interactionMode === 'COMMAND' && <div className="sr-only" aria-live="assertive">{currentItem.label} 항목이 선택 대기 중입니다.</div>}
    </main>
  );
}

export default App;
