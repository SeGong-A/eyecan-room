import type { CSSProperties } from 'react';
import type { CommandItem, TargetMeta } from '../types/control';

type RadialControlProps = {
  activeScanStep: number;
  currentItem: CommandItem;
  isSettingsMode: boolean;
  isTargetChoice: boolean;
  radialRotation: number;
  radialStepAngle: number;
  radialTarget: TargetMeta;
  scanIntervalMs: number;
  scanList: CommandItem[];
  onSelectCurrent: () => void;
};

export function RadialControl({
  activeScanStep,
  currentItem,
  isSettingsMode,
  isTargetChoice,
  radialRotation,
  radialStepAngle,
  radialTarget,
  scanIntervalMs,
  scanList,
  onSelectCurrent
}: RadialControlProps) {
  return (
    <section className="radial-overlay" aria-live="polite">
      <header className="radial-heading">
        <small>{isTargetChoice ? '제어 대상 선택' : `${radialTarget.name} 제어`}</small>
        <h1>{isTargetChoice ? '무엇을 제어할까요?' : '명령이 돌아가며 선택됩니다'}</h1>
        <p>{isTargetChoice ? '커튼과 창문 중 원하는 대상을 먼저 선택하세요.' : '원하는 명령이 위에 오면 길게 눈을 감으세요.'}</p>
      </header>
      <div className="radial-selector">
        <div className="selection-marker"><span>선택 위치</span><i /></div>
        <div className="command-wheel" style={{ '--wheel-rotation': `${radialRotation}deg` } as CSSProperties}>
          {scanList.map((item, index) => {
            const angle = index * radialStepAngle;
            const counterRotation = -(radialRotation + angle);
            return (
              <div
                className={index === activeScanStep ? 'radial-command active' : 'radial-command'}
                key={item.command}
                style={{ '--item-angle': `${angle}deg`, '--counter-rotation': `${counterRotation}deg` } as CSSProperties}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </div>
            );
          })}
        </div>
        <div className="radial-center">
          <span>{radialTarget.icon}</span>
          <strong>{radialTarget.name}</strong>
          <small>{currentItem.label} 선택 대기</small>
        </div>
        <svg className="radial-timer" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="56" />
          <circle key={activeScanStep} className="timer-progress" cx="60" cy="60" r="56" style={{ animationDuration: `${scanIntervalMs}ms` }} />
        </svg>
      </div>
      <div className="radial-current">
        <span className="blink-symbol">◉</span>
        <div>
          <small>{isSettingsMode ? '현재 설정' : isTargetChoice ? '현재 대상' : '현재 명령'}</small>
          <strong>{currentItem.label}</strong>
        </div>
        <button className="blink-select-button" type="button" onClick={onSelectCurrent}>길게 눈감아 선택</button>
      </div>
    </section>
  );
}
