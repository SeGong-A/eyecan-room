import { useEffect, useRef } from 'react';
import { Cable, ChevronDown, Plug, Unplug, X } from 'lucide-react';
import type { AppState } from '../store/useAppStore';
import { arduinoStatusText } from '../domain/control';
import { Button, ErrorState, IconButton, StatusBadge } from './ui';

type Props = { store: AppState; open: boolean; onToggle: () => void; onClose: () => void; onConnect: () => void; onDisconnect: () => void };

export function ConnectionDetails({ store, open, onToggle, onClose, onConnect, onDisconnect }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const connected = store.arduinoStatus === 'CONNECTED';
  const busy = store.arduinoStatus === 'CONNECTING' || store.arduinoStatus === 'RECONNECTING';
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, onClose]);
  return <div className="connection-menu" ref={root} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { onClose(); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className={`connection-trigger ${connected ? 'is-connected' : ''}`} aria-label="연결 상태 상세" aria-expanded={open} aria-controls="connection-details" onClick={onToggle}>
      <Cable size={20} aria-hidden="true" /><span>{connected ? '연결됨' : busy ? '연결 중' : '연결 확인'}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <section id="connection-details" className="connection-details" aria-label="연결 상세">
      <header><div><span className="eyebrow">장치 관리</span><h2>연결 상태</h2></div><IconButton label="연결 상세 닫기" onClick={() => { onClose(); trigger.current?.focus(); }}><X size={20} /></IconButton></header>
      <div className="connection-detail-status"><strong>Arduino</strong><StatusBadge tone={connected ? 'success' : store.arduinoStatus === 'ERROR' ? 'error' : 'warning'}>{arduinoStatusText(store.arduinoStatus)}</StatusBadge></div>
      {store.arduinoError && <ErrorState title="장치 연결 확인">{store.arduinoError}</ErrorState>}
      {store.arduinoStatus === 'UNSUPPORTED' && <ErrorState title="브라우저 지원 필요">Chrome 또는 Edge에서 Arduino를 연결해주세요.</ErrorState>}
      <dl className="device-readings">
        <div><dt>시선 서버</dt><dd>{store.connectionState === 'STREAMING' ? '연결됨' : '연결 대기'}</dd></div>
        <div><dt>Pan / Tilt</dt><dd>{store.hasArduinoAngle && connected ? `${store.arduinoLevels.pan}° / ${store.arduinoLevels.tilt}°` : '확인 대기'}</dd></div>
        <div><dt>조명 / 선풍기</dt><dd>{connected ? `${store.arduinoLevels.light} / ${store.arduinoLevels.fan}` : '확인 대기'}</dd></div>
        <div><dt>팬틸트</dt><dd>{connected ? store.motionProtocolReady ? '준비됨' : '펌웨어 확인 필요' : '확인 대기'}</dd></div>
        <div><dt>모터 방향</dt><dd>{store.motorSetupComplete ? '점검 완료' : '기본 방향'}</dd></div>
        <div><dt>마지막 명령</dt><dd>{store.lastArduinoCommand === 'NONE' ? '없음' : store.lastArduinoCommand}</dd></div>
      </dl>
      <Button variant={connected ? 'secondary' : 'primary'} busy={busy} disabled={store.arduinoStatus === 'UNSUPPORTED'} onClick={connected ? onDisconnect : onConnect} icon={connected ? <Unplug size={20} /> : <Plug size={20} />}>
        {connected ? 'Arduino 연결 해제' : 'Arduino 연결'}
      </Button>
      <details className="connection-log"><summary>통신 기록</summary><pre>{store.arduinoLog.join('\n') || '아직 수신한 기록이 없습니다.'}</pre></details>
    </section>}
  </div>;
}
