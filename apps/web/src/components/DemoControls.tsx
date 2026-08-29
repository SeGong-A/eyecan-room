import { calibrationSteps, directionLabel } from '../domain/control';
import type { FullGazeDirection } from '../types/control';

type DemoControlsProps = {
  onGazeSample: (direction: FullGazeDirection) => void;
  onSelectBlink: () => void;
  onPauseBlink: () => void;
};

export function DemoControls({ onGazeSample, onSelectBlink, onPauseBlink }: DemoControlsProps) {
  return (
    <>
      <section className="demo-notice" aria-label="데모 안내">
        <strong>포인터 테스트</strong>
        <small>방향 버튼으로 시선 포인터를 움직이고 깜빡임으로 로테이션 UI를 확인합니다</small>
      </section>
      <section className="simulator" aria-label="개발용 입력 시뮬레이터">
        <div className="simulator-buttons">
          {calibrationSteps.map((direction) => (
            <button type="button" key={direction} onClick={() => onGazeSample(direction)}>
              {directionLabel[direction]}
            </button>
          ))}
          <button type="button" onClick={onSelectBlink}>깜빡임 선택</button>
          <button type="button" onClick={onPauseBlink}>일시정지</button>
        </div>
      </section>
    </>
  );
}
