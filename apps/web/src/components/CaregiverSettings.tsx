import { useEffect, useState } from 'react';
import { Bot, Cable, Eye, MonitorUp, Plug, SlidersHorizontal, Unplug, X } from 'lucide-react';
import { arduinoStatusText, caregiverDeviceCommands } from '../domain/control';
import type { AppState } from '../store/useAppStore';
import { Button, ErrorState, IconButton, StatusBadge } from './ui';
import type { useSpeech } from '../hooks/useSpeech';
import type { useObjectDetection } from '../hooks/useObjectDetection';

type Props = {
  open: boolean;
  store: AppState;
  busy: boolean;
  onClose: () => void;
  onOpenRotationSettings: () => void;
  onOpenMotorSettings: () => void;
  onConnectArduino: () => void;
  onDisconnectArduino: () => void;
  onToggleLearning: (enabled: boolean) => void;
  onOpenTV: () => void;
  onDeviceCommand: (command: string) => void;
  speech: ReturnType<typeof useSpeech>;
  detector: ReturnType<typeof useObjectDetection>;
  onExportAacLogs: () => void;
};

export function CaregiverSettings({
  open, store, busy, onClose, onOpenRotationSettings, onOpenMotorSettings,
  onConnectArduino, onDisconnectArduino, onToggleLearning, onOpenTV, onDeviceCommand, speech, detector, onExportAacLogs
}: Props) {
  const [speechError, setSpeechError] = useState('');
  const [testingSpeech, setTestingSpeech] = useState(false);
  const connected = store.arduinoStatus === 'CONNECTED';

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  return <div className="caregiver-shell" role="presentation" onPointerDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="caregiver-panel" role="dialog" aria-modal="true" aria-labelledby="caregiver-title">
      <header><div><span className="eyebrow">보조자 전용</span><h2 id="caregiver-title">설정 및 점검</h2></div>
        <IconButton autoFocus label="설정 닫기" onClick={onClose}><X size={20} aria-hidden="true" /></IconButton></header>

      <section className="caregiver-section" aria-labelledby="caregiver-ai"><div className="caregiver-section-heading"><Bot size={20} aria-hidden="true" /><div><h3 id="caregiver-ai">AI / 시선 인식</h3><p>현재 모델은 유지하면서 새 가중치 갱신만 제어합니다.</p></div></div>
        <label className="setting-toggle"><span><strong>가중치 자동 갱신</strong><small>{store.learningEnabled ? '외장 영상이 표시될 때 개인화 학습' : '마지막 가중치로 시선 추론 계속'}</small></span>
          <input type="checkbox" checked={store.learningEnabled} disabled={busy} onChange={(event) => onToggleLearning(event.target.checked)} />
          <i aria-hidden="true" /></label>
        <p role="status">{store.learningEnabled ? store.learningActive ? '외장 영상 표시 중 · 개인화 학습 활성' : '외장 영상 표시 대기 · 개인화 학습 정지' : '개인화 학습 꺼짐'}</p>
      </section>

      <section className="caregiver-section" aria-labelledby="caregiver-control"><div className="caregiver-section-heading"><Eye size={20} aria-hidden="true" /><div><h3 id="caregiver-control">시선 선택 설정</h3><p>선택 속도, 화면 모드와 개인화 모델을 조정합니다.</p></div></div>
        <Button variant="secondary" onClick={onOpenRotationSettings}>로테이션 설정 열기</Button>
      </section>

      <section className="caregiver-section" aria-labelledby="caregiver-device"><div className="caregiver-section-heading"><SlidersHorizontal size={20} aria-hidden="true" /><div><h3 id="caregiver-device">장치 연결 및 점검</h3><p>환자 메뉴에서 제외된 기존 명령을 여기서 점검합니다.</p></div></div>
        <div className="caregiver-status"><Cable size={18} aria-hidden="true" /><span>Arduino</span><StatusBadge tone={connected ? 'success' : store.arduinoStatus === 'ERROR' ? 'error' : 'warning'}>{arduinoStatusText(store.arduinoStatus)}</StatusBadge></div>
        {store.arduinoError && <ErrorState title="장치 연결 확인">{store.arduinoError}</ErrorState>}
        <dl className="device-readings caregiver-readings">
          <div><dt>시선 서버</dt><dd>{store.connectionState === 'STREAMING' ? '연결됨' : '연결 대기'}</dd></div>
          <div><dt>Pan / Tilt</dt><dd>{store.hasArduinoAngle && connected ? `${store.arduinoLevels.pan}° / ${store.arduinoLevels.tilt}°` : '확인 대기'}</dd></div>
          <div><dt>조명 / 선풍기</dt><dd>{connected ? `${store.arduinoLevels.light} / ${store.arduinoLevels.fan}` : '확인 대기'}</dd></div>
          <div><dt>팬틸트</dt><dd>{connected ? store.motionProtocolReady ? '준비됨' : '펌웨어 확인 필요' : '확인 대기'}</dd></div>
          <div><dt>마지막 명령</dt><dd>{store.lastArduinoCommand === 'NONE' ? '없음' : store.lastArduinoCommand}</dd></div>
        </dl>
        <div className="caregiver-actions"><Button variant="secondary" busy={store.arduinoStatus === 'CONNECTING' || store.arduinoStatus === 'RECONNECTING'} onClick={connected ? onDisconnectArduino : onConnectArduino} icon={connected ? <Unplug size={18} /> : <Plug size={18} />}>{connected ? '연결 해제' : 'Arduino 연결'}</Button>
          <Button variant="secondary" onClick={onOpenMotorSettings}>카메라·모터 점검</Button></div>
        <div className="caregiver-test-grid">{caregiverDeviceCommands.map((item) => {
          const Icon = item.icon;
          return <Button key={item.command} variant="quiet" disabled={!connected || busy} onClick={() => onDeviceCommand(item.command)} icon={<Icon size={18} aria-hidden="true" />}>{item.label}</Button>;
        })}</div>
        <details className="connection-log caregiver-log"><summary>통신 기록</summary><pre>{store.arduinoLog.join('\n') || '아직 수신한 기록이 없습니다.'}</pre></details>
      </section>

      <section className="caregiver-section" aria-labelledby="caregiver-tv"><div className="caregiver-section-heading"><MonitorUp size={20} aria-hidden="true" /><div><h3 id="caregiver-tv">TV 보조 화면</h3><p>확장 모니터에 TV 시뮬레이션 창을 엽니다.</p></div></div>
        <Button onClick={onOpenTV} icon={<MonitorUp size={18} aria-hidden="true" />}>TV 화면 열기</Button>
      </section>
      <section className="caregiver-section" aria-labelledby="caregiver-aac">
        <h3 id="caregiver-aac">의사소통 · 한국어 음성</h3>
        <label className="aac-voice-label">음성<select value={speech.voiceURI} onChange={event => speech.chooseVoice(event.target.value)}>
          <option value="">한국어 기본 음성</option>{speech.voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
        </select></label>
        {!speech.voices.length && <p>사용 가능한 한국어 음성이 없습니다.</p>}
        <div className="caregiver-actions"><Button disabled={!speech.voices.length || testingSpeech} onClick={() => {
          setTestingSpeech(true); setSpeechError('');
          void speech.speak('물 마시고 싶어요.', () => {}).catch(error => setSpeechError(String(error.message))).finally(() => setTestingSpeech(false));
        }}>음성 테스트</Button><Button variant="secondary" onClick={speech.cancel}>음성 중단</Button></div>
        <p role="status">{speechError || speech.status}</p>
        <dl className="device-readings caregiver-readings"><div><dt>객체 탐지</dt><dd>{detector.health.status}</dd></div><div><dt>모델</dt><dd>{detector.health.modelId || '준비 대기'}</dd></div></dl>
        {detector.health.error && <p role="status">{detector.health.error}</p>}
        <div className="caregiver-actions"><Button variant="secondary" onClick={detector.retry}>탐지 다시 확인</Button><Button variant="secondary" onClick={onExportAacLogs}>측정 로그 내보내기</Button></div>
      </section>
    </section>
  </div>;
}
