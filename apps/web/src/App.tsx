import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAppStore,
  type FullGazeDirection,
  type InteractionMode,
  type ScanTarget
} from './store/useAppStore';

type CommandItem = {
  label: string;
  command: string;
};

const scanItems: Record<ScanTarget, CommandItem[]> = {
  FAN: [
    { label: 'ON', command: 'FAN_ON' },
    { label: 'OFF', command: 'FAN_OFF' },
    { label: 'LOW', command: 'FAN_LOW' },
    { label: 'MID', command: 'FAN_MID' },
    { label: 'HIGH', command: 'FAN_HIGH' },
    { label: 'CANCEL', command: 'CANCEL' }
  ],
  LIGHT: [
    { label: 'ON', command: 'LIGHT_ON' },
    { label: 'OFF', command: 'LIGHT_OFF' },
    { label: 'UP', command: 'LIGHT_UP' },
    { label: 'DOWN', command: 'LIGHT_DOWN' },
    { label: 'CANCEL', command: 'CANCEL' }
  ],
  TV: [
    { label: 'POWER', command: 'TV_POWER' },
    { label: 'CH +', command: 'TV_CH_UP' },
    { label: 'CH -', command: 'TV_CH_DOWN' },
    { label: 'VOL +', command: 'TV_VOL_UP' },
    { label: 'VOL -', command: 'TV_VOL_DOWN' },
    { label: 'CANCEL', command: 'CANCEL' }
  ],
  CURTAIN: [
    { label: 'OPEN', command: 'CURTAIN_OPEN' },
    { label: 'CLOSE', command: 'CURTAIN_CLOSE' },
    { label: 'STOP', command: 'CURTAIN_STOP' },
    { label: 'CANCEL', command: 'CANCEL' }
  ]
};

const gazeSamples: Record<FullGazeDirection, { x: number; y: number }> = {
  LEFT: { x: 0.28, y: 0.5 },
  RIGHT: { x: 0.72, y: 0.5 },
  UP: { x: 0.5, y: 0.28 },
  DOWN: { x: 0.5, y: 0.72 },
  CENTER: { x: 0.5, y: 0.5 }
};

const cameraCommandByDirection: Record<FullGazeDirection, string> = {
  LEFT: 'CAM_LEFT',
  RIGHT: 'CAM_RIGHT',
  UP: 'CAM_UP',
  DOWN: 'CAM_DOWN',
  CENTER: 'CAM_STOP'
};

const calibrationSteps: FullGazeDirection[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];
const targets: ScanTarget[] = ['FAN', 'LIGHT', 'TV', 'CURTAIN'];

function App() {
  const gazeDirection = useAppStore((state) => state.gazeDirection);
  const selectedTarget = useAppStore((state) => state.selectedTarget);
  const interactionMode = useAppStore((state) => state.interactionMode);
  const isCalibrated = useAppStore((state) => state.isCalibrated);
  const isPaused = useAppStore((state) => state.isPaused);
  const scanIntervalMs = useAppStore((state) => state.scanIntervalMs);
  const scanStep = useAppStore((state) => state.scanStep);
  const connectionState = useAppStore((state) => state.connectionState);
  const lastBlinkEvent = useAppStore((state) => state.lastBlinkEvent);
  const blinkSequence = useAppStore((state) => state.blinkSequence);
  const lastCommand = useAppStore((state) => state.lastCommand);
  const lastGazePoint = useAppStore((state) => state.lastGazePoint);
  const setGazeDirection = useAppStore((state) => state.setGazeDirection);
  const setSelectedTarget = useAppStore((state) => state.setSelectedTarget);
  const setInteractionMode = useAppStore((state) => state.setInteractionMode);
  const setIsCalibrated = useAppStore((state) => state.setIsCalibrated);
  const setScanIntervalMs = useAppStore((state) => state.setScanIntervalMs);
  const setScanStep = useAppStore((state) => state.setScanStep);
  const setConnectionState = useAppStore((state) => state.setConnectionState);
  const syncFromServer = useAppStore((state) => state.syncFromServer);

  const [calibrationIndex, setCalibrationIndex] = useState(0);
  const [tvState, setTvState] = useState({ power: false, channel: 7, volume: 18 });

  const scanList = useMemo(() => scanItems[selectedTarget], [selectedTarget]);
  const gazeHoldStartRef = useRef<number | null>(null);
  const lastDirectionRef = useRef(gazeDirection);
  const lastDispatchedDirectionRef = useRef<FullGazeDirection | null>(null);
  const lastProcessedBlinkSequenceRef = useRef(0);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/state`);

    socket.addEventListener('open', () => {
      setConnectionState('STREAMING');
    });

    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data) as {
        gaze_direction?: FullGazeDirection;
        selected_target?: ScanTarget;
        interaction_mode?: InteractionMode;
        is_calibrated?: boolean;
        is_paused?: boolean;
        scan_interval_ms?: number;
        scan_step?: number;
        connection_state?: 'DISCONNECTED' | 'READY' | 'STREAMING';
        last_blink_event?: 'NONE' | 'SHORT' | 'SELECT' | 'CANCEL';
        blink_sequence?: number;
        last_gaze_point_x?: number;
        last_gaze_point_y?: number;
        last_command?: string;
      };

      syncFromServer(payload);
    });

    socket.addEventListener('close', () => {
      setConnectionState('DISCONNECTED');
    });

    socket.addEventListener('error', () => {
      setConnectionState('DISCONNECTED');
    });

    return () => {
      socket.close();
    };
  }, [setConnectionState, syncFromServer]);

  useEffect(() => {
    lastDirectionRef.current = gazeDirection;
  }, [gazeDirection]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      if (connectionState !== 'STREAMING' || !isCalibrated || isPaused || interactionMode !== 'EXPLORE') {
        gazeHoldStartRef.current = null;
        lastDispatchedDirectionRef.current = null;
        return;
      }

      const currentDirection = gazeDirection;
      const now = Date.now();

      if (lastDirectionRef.current !== currentDirection) {
        lastDirectionRef.current = currentDirection;
        gazeHoldStartRef.current = now;
        lastDispatchedDirectionRef.current = null;
        return;
      }

      if (gazeHoldStartRef.current === null) {
        gazeHoldStartRef.current = now;
        return;
      }

      if (now - gazeHoldStartRef.current < 1000 || lastDispatchedDirectionRef.current === currentDirection) {
        return;
      }

      void postCommand(cameraCommandByDirection[currentDirection]);
      lastDispatchedDirectionRef.current = currentDirection;
      gazeHoldStartRef.current = now;
    }, 250);

    return () => {
      window.clearInterval(timerId);
    };
  }, [connectionState, gazeDirection, interactionMode, isCalibrated, isPaused]);

  useEffect(() => {
    if (!isCalibrated || isPaused || interactionMode !== 'COMMAND') {
      return;
    }

    const timerId = window.setInterval(() => {
      setScanStep((currentStep) => (currentStep + 1) % scanList.length);
    }, scanIntervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [interactionMode, isCalibrated, isPaused, scanIntervalMs, scanList.length, setScanStep]);

  useEffect(() => {
    if (blinkSequence === 0 || blinkSequence === lastProcessedBlinkSequenceRef.current) {
      return;
    }

    lastProcessedBlinkSequenceRef.current = blinkSequence;

    if (lastBlinkEvent === 'CANCEL') {
      setInteractionMode('EXPLORE');
      void postCommand('CAM_STOP');
      return;
    }

    if (lastBlinkEvent !== 'SELECT' || !isCalibrated || isPaused) {
      return;
    }

    if (interactionMode === 'EXPLORE') {
      setInteractionMode('COMMAND');
      void fetch(`/state/mode?mode=COMMAND`, { method: 'POST' });
      return;
    }

    const item = scanList[scanStep];
    if (!item || item.command === 'CANCEL') {
      setInteractionMode('EXPLORE');
      void fetch(`/state/mode?mode=EXPLORE`, { method: 'POST' });
      return;
    }

    void postCommand(item.command);
    setInteractionMode('EXPLORE');
    setScanStep(0);
    updateTvMock(item.command);
    void fetch(`/state/mode?mode=EXPLORE`, { method: 'POST' });
  }, [
    blinkSequence,
    interactionMode,
    isCalibrated,
    isPaused,
    lastBlinkEvent,
    scanList,
    scanStep,
    setInteractionMode,
    setScanStep
  ]);

  async function postReadyState() {
    const response = await fetch('/state/ready', { method: 'POST' });
    const data = (await response.json()) as { connection_state?: 'DISCONNECTED' | 'READY' | 'STREAMING' };
    if (data.connection_state) {
      setConnectionState(data.connection_state);
    }
  }

  async function postCommand(command: string) {
    await fetch(`/events/command?command=${command}`, { method: 'POST' });
  }

  async function postGazeSample(direction: FullGazeDirection) {
    const sample = gazeSamples[direction];
    await fetch(`/events/gaze?x=${sample.x}&y=${sample.y}`, { method: 'POST' });
    setGazeDirection(direction);
  }

  async function selectTarget(target: ScanTarget) {
    setSelectedTarget(target);
    setInteractionMode('EXPLORE');
    await fetch(`/state/target?target=${target}`, { method: 'POST' });
  }

  async function completeCalibration() {
    setIsCalibrated(true);
    setCalibrationIndex(0);
    await fetch('/state/calibration?is_calibrated=true', { method: 'POST' });
  }

  async function updateScanSpeed(nextValue: number) {
    setScanIntervalMs(nextValue);
    await fetch(`/state/scan-speed?scan_interval_ms=${nextValue}`, { method: 'POST' });
  }

  async function simulateBlink(durationMs: number) {
    const now = Date.now();
    await fetch(`/events/blink?is_closed=true&now_ms=${now}`, { method: 'POST' });
    await fetch(`/events/blink?is_closed=false&now_ms=${now + durationMs}`, { method: 'POST' });
  }

  function updateTvMock(command: string) {
    setTvState((current) => {
      if (command === 'TV_POWER') {
        return { ...current, power: !current.power };
      }
      if (command === 'TV_CH_UP') {
        return { ...current, channel: current.channel + 1 };
      }
      if (command === 'TV_CH_DOWN') {
        return { ...current, channel: Math.max(1, current.channel - 1) };
      }
      if (command === 'TV_VOL_UP') {
        return { ...current, volume: Math.min(100, current.volume + 5) };
      }
      if (command === 'TV_VOL_DOWN') {
        return { ...current, volume: Math.max(0, current.volume - 5) };
      }
      return current;
    });
  }

  const currentCalibrationStep = calibrationSteps[calibrationIndex];

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">EyeCan Room</p>
          <h1>Eye guided room control</h1>
        </div>

        <div className="system-strip">
          <div>
            <span>API</span>
            <strong>{connectionState}</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>{isPaused ? 'PAUSED' : interactionMode}</strong>
          </div>
          <button type="button" onClick={() => void postReadyState()}>
            Ready
          </button>
        </div>
      </section>

      <section className="workspace">
        <section className="camera-zone">
          <div className="panel-head">
            <h2>Room Camera</h2>
            <span>{gazeDirection}</span>
          </div>
          <div className={`camera-frame gaze-${gazeDirection.toLowerCase()}`}>
            <div className="room-object fan">FAN</div>
            <div className="room-object light">LIGHT</div>
            <div className="room-object tv">TV</div>
            <div className="room-object curtain">CURTAIN</div>
            <div className="target-box">
              <span>{interactionMode === 'EXPLORE' ? selectedTarget : 'COMMAND'}</span>
            </div>
          </div>
          <div className="target-row">
            {targets.map((target) => (
              <button
                key={target}
                type="button"
                className={target === selectedTarget ? 'active-button' : ''}
                onClick={() => void selectTarget(target)}
              >
                {target}
              </button>
            ))}
          </div>
        </section>

        <aside className="control-stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Calibration</h2>
              <span>{isCalibrated ? 'DONE' : currentCalibrationStep}</span>
            </div>
            <div className="calibration-pad">
              {calibrationSteps.map((step, index) => (
                <button
                  key={step}
                  type="button"
                  className={index <= calibrationIndex || isCalibrated ? 'calibrated' : ''}
                  onClick={() => {
                    setCalibrationIndex(Math.min(index + 1, calibrationSteps.length - 1));
                    void postGazeSample(step);
                  }}
                >
                  {step}
                </button>
              ))}
            </div>
            <button type="button" className="wide-button" onClick={() => void completeCalibration()}>
              Complete calibration
            </button>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Gaze Input</h2>
              <span>
                {lastGazePoint.x.toFixed(2)}, {lastGazePoint.y.toFixed(2)}
              </span>
            </div>
            <div className="direction-pad">
              <button type="button" onClick={() => void postGazeSample('UP')}>UP</button>
              <button type="button" onClick={() => void postGazeSample('LEFT')}>LEFT</button>
              <button type="button" onClick={() => void postGazeSample('CENTER')}>CENTER</button>
              <button type="button" onClick={() => void postGazeSample('RIGHT')}>RIGHT</button>
              <button type="button" onClick={() => void postGazeSample('DOWN')}>DOWN</button>
            </div>
          </section>
        </aside>

        <aside className="control-stack">
          <section className="panel scan-panel">
            <div className="panel-head">
              <h2>Scan Menu</h2>
              <span>{selectedTarget}</span>
            </div>
            <div className="scan-list">
              {scanList.map((item, index) => (
                <div key={item.command} className={index === scanStep && interactionMode === 'COMMAND' ? 'scan-item active' : 'scan-item'}>
                  {item.label}
                </div>
              ))}
            </div>
            <label className="range-label">
              Scan speed
              <input
                type="range"
                min="600"
                max="3000"
                step="100"
                value={scanIntervalMs}
                onChange={(event) => void updateScanSpeed(Number(event.target.value))}
              />
              <span>{(scanIntervalMs / 1000).toFixed(1)}s</span>
            </label>
          </section>

          <section className="panel tv-panel">
            <div className="panel-head">
              <h2>TV Mock</h2>
              <span>{tvState.power ? 'ON' : 'OFF'}</span>
            </div>
            <div className={tvState.power ? 'tv-screen on' : 'tv-screen'}>
              <strong>{tvState.power ? `CH ${tvState.channel}` : 'POWER OFF'}</strong>
              <span>VOL {tvState.volume}</span>
            </div>
          </section>
        </aside>
      </section>

      <section className="bottom-bar">
        <div>Last blink: {lastBlinkEvent}</div>
        <div>Last command: {lastCommand}</div>
        <div className="button-row">
          <button type="button" onClick={() => void simulateBlink(650)}>Long blink</button>
          <button type="button" onClick={() => void simulateBlink(2100)}>Pause blink</button>
        </div>
      </section>
    </main>
  );
}

export default App;
