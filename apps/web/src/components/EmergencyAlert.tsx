import { useEffect, useRef, useState } from 'react';
import { BellRing, Check } from 'lucide-react';
import { Button } from './ui';

export function EmergencyAlert({ onClear }: { onClear: () => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="emergency-alert" aria-labelledby="emergency-title" aria-describedby="emergency-description" onCancel={(event) => event.preventDefault()}>
    <div className="emergency-content"><BellRing size={56} strokeWidth={1.6} aria-hidden="true" /><span className="eyebrow">긴급 알림</span>
      <h1 id="emergency-title">응급상황 발생</h1><p id="emergency-description">응급호출벨이 작동하였습니다</p>
      <p className="emergency-disclaimer">시연 모드 · 실제 벨 및 외부 연락은 실행되지 않습니다</p>
      <Button busy={busy} icon={<Check size={22} aria-hidden="true" />} onClick={async () => { setBusy(true); setFailed(false); try { setFailed(!await onClear()); } finally { setBusy(false); } }}>상황 확인 및 해제</Button>
      {failed && <p role="alert">해제 요청을 전달하지 못했습니다. 서버 연결을 확인해주세요.</p>}
    </div>
  </dialog>;
}
