import type { useObjectDetection } from '../hooks/useObjectDetection';
import { objectNames } from '../domain/aac';

export function ObjectDetectionOverlay({ detector, hidden, directionReady }: {
  detector: ReturnType<typeof useObjectDetection>; hidden: boolean; directionReady: boolean;
}) {
  if (hidden) return null;
  return <div className="object-overlay" aria-label="객체 탐지">
    {detector.boxes.filter(t => t.stable && t.visible > 0).map(t => <div key={t.id} className="object-box" style={{ left: t.box.x, top: t.box.y, width: t.box.width, height: t.box.height }}><span>{objectNames[t.type]}</span></div>)}
    <div className="object-status" role="status">{detector.health.status === 'READY' ? `요청 가능한 객체 ${detector.candidates.length}개${directionReady ? ' · 의사소통 선택 가능' : ''}` : detector.health.status === 'LOADING' ? '객체 탐지 준비 중' : '객체 탐지 연결 대기'}</div>
  </div>;
}
