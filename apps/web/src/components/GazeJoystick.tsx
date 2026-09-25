type Props = {
  errorX: number;
  errorY: number;
  deadzone: number;
  calibrationActive: boolean;
  showMotion: boolean;
  compact?: boolean;
};

const ERROR_RADIUS = 0.15;
const VIEW_RADIUS = 76;

export function GazeJoystick({ errorX, errorY, deadzone, calibrationActive, showMotion, compact = false }: Props) {
  const magnitude = Math.hypot(errorX, errorY);
  const scale = magnitude > ERROR_RADIUS ? ERROR_RADIUS / magnitude : 1;
  const knobX = 100 + (errorX * scale / ERROR_RADIUS) * VIEW_RADIUS;
  const knobY = 100 + (errorY * scale / ERROR_RADIUS) * VIEW_RADIUS;
  const deadzoneRadius = Math.min(VIEW_RADIUS, Math.max(4, (deadzone / ERROR_RADIUS) * VIEW_RADIUS));
  const motionVisible = showMotion && magnitude > deadzone;

  return <div className={`gaze-joystick ${compact ? 'gaze-joystick-compact' : ''} ${calibrationActive ? 'is-calibrating' : ''}`} aria-label={calibrationActive ? '자동 영점 조정 중' : '시선 조이스틱'}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle className="joystick-field" cx="100" cy="100" r={VIEW_RADIUS} />
      <circle className="joystick-deadzone" cx="100" cy="100" r={deadzoneRadius} />
      {motionVisible && <line className="joystick-vector" x1="100" y1="100" x2={knobX} y2={knobY} />}
      {motionVisible && <circle className="joystick-knob" cx={knobX} cy={knobY} r="10" />}
      <line className="joystick-cross" x1="82" y1="100" x2="118" y2="100" />
      <line className="joystick-cross" x1="100" y1="82" x2="100" y2="118" />
    </svg>
    {calibrationActive && <small>자동 영점 조정 중</small>}
  </div>;
}
