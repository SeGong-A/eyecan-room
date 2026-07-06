import { useEffect, useMemo } from 'react';
import { useAppStore, type ScanTarget } from './store/useAppStore';

const scanItems: Record<ScanTarget, string[]> = {
  FAN: ['ON', 'OFF', 'LOW', 'MID', 'HIGH'],
  TV: ['POWER', 'CH +', 'CH -', 'VOL +', 'VOL -'],
  CURTAIN: ['OPEN', 'CLOSE', 'STOP']
};

const gazeSamples: Record<'LEFT' | 'CENTER' | 'RIGHT', { x: number; y: number }> = {
  LEFT: { x: 0.28, y: 0.5 },
  CENTER: { x: 0.5, y: 0.5 },
  RIGHT: { x: 0.72, y: 0.5 }
};

function App() {
  const gazeDirection = useAppStore((state) => state.gazeDirection);
  const selectedTarget = useAppStore((state) => state.selectedTarget);
  const isCalibrated = useAppStore((state) => state.isCalibrated);
  const scanStep = useAppStore((state) => state.scanStep);
  const connectionState = useAppStore((state) => state.connectionState);
  const setGazeDirection = useAppStore((state) => state.setGazeDirection);
  const setSelectedTarget = useAppStore((state) => state.setSelectedTarget);
  const setIsCalibrated = useAppStore((state) => state.setIsCalibrated);
  const setScanStep = useAppStore((state) => state.setScanStep);
  const setConnectionState = useAppStore((state) => state.setConnectionState);
  const syncFromServer = useAppStore((state) => state.syncFromServer);

  const scanList = useMemo(() => scanItems[selectedTarget], [selectedTarget]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/state`);

    socket.addEventListener('open', () => {
      setConnectionState('STREAMING');
    });

    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data) as {
        gaze_direction?: 'LEFT' | 'CENTER' | 'RIGHT';
        selected_target?: ScanTarget;
        scan_step?: number;
        connection_state?: 'DISCONNECTED' | 'READY' | 'STREAMING';
        last_blink_event?: 'NONE' | 'SHORT' | 'SELECT' | 'CANCEL';
        last_gaze_point_x?: number;
        last_gaze_point_y?: number;
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

  async function postReadyState() {
    const response = await fetch('/state/ready', { method: 'POST' });
    const data = (await response.json()) as { connection_state?: 'DISCONNECTED' | 'READY' | 'STREAMING' };
    if (data.connection_state) {
      setConnectionState(data.connection_state);
    }
  }

  async function postGazeSample(direction: 'LEFT' | 'CENTER' | 'RIGHT') {
    const sample = gazeSamples[direction];
    await fetch(`/events/gaze?x=${sample.x}&y=${sample.y}`, { method: 'POST' });
    setGazeDirection(direction);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">EyeCan Room</p>
          <h1>Gaze-first room control dashboard</h1>
          <p className="lede">
            A local web app for calibration, scan menus, and TV mock control while Python handles the vision loop.
          </p>
        </div>

        <div className="status-card">
          <span>Connection</span>
          <strong>{connectionState}</strong>
          <button type="button" onClick={() => void postReadyState()}>Mark ready</button>
        </div>
      </section>

      <section className="grid">
        <article className="panel panel-room">
          <div className="panel-head">
            <h2>Room Camera</h2>
            <span>{gazeDirection}</span>
          </div>
          <div className="camera-frame">
            <div className="target-box">CENTER SELECT ZONE</div>
            <div className="target-chip">{selectedTarget}</div>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => setSelectedTarget('FAN')}>Fan</button>
            <button type="button" onClick={() => setSelectedTarget('TV')}>TV</button>
            <button type="button" onClick={() => setSelectedTarget('CURTAIN')}>Curtain</button>
          </div>
        </article>

        <article className="panel panel-flow">
          <div className="panel-head">
            <h2>Control Flow</h2>
            <span>{isCalibrated ? 'Calibrated' : 'Needs calibration'}</span>
          </div>

          <div className="flow-list">
            <div className={gazeDirection === 'LEFT' ? 'flow-item active' : 'flow-item'}>LEFT</div>
            <div className={gazeDirection === 'CENTER' ? 'flow-item active' : 'flow-item'}>CENTER</div>
            <div className={gazeDirection === 'RIGHT' ? 'flow-item active' : 'flow-item'}>RIGHT</div>
          </div>

          <div className="button-row">
            <button type="button" onClick={() => void postGazeSample('LEFT')}>Simulate Left</button>
            <button type="button" onClick={() => void postGazeSample('CENTER')}>Simulate Center</button>
            <button type="button" onClick={() => void postGazeSample('RIGHT')}>Simulate Right</button>
          </div>

          <div className="button-row">
            <button type="button" onClick={() => setIsCalibrated(true)}>Complete calibration</button>
            <button type="button" onClick={() => setScanStep((scanStep + 1) % scanList.length)}>Advance scan</button>
          </div>
        </article>

        <article className="panel panel-scan">
          <div className="panel-head">
            <h2>Scan Menu</h2>
            <span>{selectedTarget}</span>
          </div>
          <div className="scan-list">
            {scanList.map((item, index) => (
              <div key={item} className={index === scanStep ? 'scan-item active' : 'scan-item'}>
                {item}
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

export default App;
