import { useCallback, useEffect, useState, type ReactNode, type RefCallback } from 'react';
import { CircleDot, Eye, Plug, Settings, VideoOff } from 'lucide-react';
import type { AppState } from '../store/useAppStore';
import { targetMeta } from '../domain/control';
import { BrandLogo } from './BrandLogo';
import { ConnectionDetails } from './ConnectionDetails';
import { GazeJoystick } from './GazeJoystick';
import { Button, IconButton } from './ui';

type Props = {
  children: ReactNode; roomCameraReady: boolean; roomVideoRef: RefCallback<HTMLVideoElement>; store: AppState;
  onConnectArduino: () => void; onDisconnectArduino: () => void; onOpenSettings: () => void; onReconnectCamera: () => void;
};

export function RoomView({ children, roomCameraReady, roomVideoRef, store, onConnectArduino, onDisconnectArduino, onOpenSettings, onReconnectCamera }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const exploring = store.interactionMode === 'EXPLORE';
  const target = !exploring && store.interactionMode === 'COMMAND' ? store.selectedTarget : store.activeAngleTarget;
  const TargetIcon = target ? targetMeta[target].icon : CircleDot;
  const tracking = store.visionStatus === 'RUNNING' && store.faceDetected && store.gazeReady && store.connectionState === 'STREAMING';
  useEffect(() => { if (!exploring || store.emergencyActive) setDetailsOpen(false); }, [exploring, store.emergencyActive]);

  return <section className="room-fullscreen" id="main-view">
    {roomCameraReady ? <video className="room-video" ref={roomVideoRef} muted playsInline aria-label="외장 룸 카메라 화면" /> : <div className="room-empty-feed">
      <VideoOff size={40} strokeWidth={1.5} aria-hidden="true" /><h1>방 카메라 연결이 끊겼습니다</h1><Button onClick={onReconnectCamera}>다시 연결</Button>
    </div>}
    <header className="room-header">
      <div className="room-brand"><BrandLogo /></div>
      <div className={`current-target ${target ? 'has-target' : ''}`}><TargetIcon size={24} aria-hidden="true" /><div><span>{store.interactionMode === 'COMMAND' ? '선택한 대상' : '현재 대상'}</span><strong>{target ? targetMeta[target].name : '선택 없음'}</strong></div></div>
      <div className="room-tools">
        <ConnectionDetails store={store} open={detailsOpen} onToggle={() => setDetailsOpen((open) => !open)} onClose={closeDetails} onConnect={onConnectArduino} onDisconnect={onDisconnectArduino} />
        <IconButton label="설정" className="room-settings-button" disabled={!exploring} onClick={onOpenSettings}><Settings size={22} aria-hidden="true" /></IconButton>
      </div>
    </header>
    {exploring && !store.emergencyActive && roomCameraReady && <GazeJoystick errorX={store.gazeError.x} errorY={store.gazeError.y}
      deadzone={store.gazeDeadzone} calibrationActive={store.calibrationActive}
      showMotion={tracking && !store.isBlinking && !store.saccadeBraking && !store.calibrationActive} />}
    {children}
    {exploring && <footer className="room-footer"><span className="tracking-status"><Eye size={18} aria-hidden="true" />
      {store.isPaused ? '시선 제어 일시정지' : tracking ? '시선 연결됨' : store.connectionState !== 'STREAMING' ? '시선 서버 연결 대기' : '시선 인식 대기'}
    </span>{store.arduinoStatus !== 'CONNECTED' && <Button variant="secondary" busy={store.arduinoStatus === 'CONNECTING' || store.arduinoStatus === 'RECONNECTING'} disabled={store.arduinoStatus === 'UNSUPPORTED'} onClick={onConnectArduino} icon={<Plug size={18} aria-hidden="true" />}>Arduino 연결</Button>}</footer>}
  </section>;
}
