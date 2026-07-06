import { useMemo } from 'react';
import { useAppStore, type ScanTarget } from './store/useAppStore';

const scanItems: Record<ScanTarget, string[]> = {
  FAN: ['ON', 'OFF', 'LOW', 'MID', 'HIGH'],
  TV: ['POWER', 'CH +', 'CH -', 'VOL +', 'VOL -'],
  CURTAIN: ['OPEN', 'CLOSE', 'STOP']
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

  const scanList = useMemo(() => scanItems[selectedTarget], [selectedTarget]);

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
          <button type="button" onClick={() => setConnectionState('READY')}>Mark ready</button>
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
            <button type="button" onClick={() => setGazeDirection('LEFT')}>Simulate Left</button>
            <button type="button" onClick={() => setGazeDirection('CENTER')}>Simulate Center</button>
            <button type="button" onClick={() => setGazeDirection('RIGHT')}>Simulate Right</button>
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
