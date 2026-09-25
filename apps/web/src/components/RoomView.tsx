import type { CSSProperties, ReactNode, RefCallback } from 'react';
import { arduinoStatusText, directionLabel } from '../domain/control';
import type { AppState } from '../store/useAppStore';
import type { FullGazeDirection, ScanTarget } from '../types/control';
import { targetMeta } from '../domain/control';

type RoomViewProps = {
  children: ReactNode;
  gazeCursor: { x: string; y: string };
  roomCameraReady: boolean;
  roomVideoRef: RefCallback<HTMLVideoElement>;
  store: AppState;
  visibleGazeDirection: FullGazeDirection;
  onConnectArduino: () => void;
  onDisconnectArduino: () => void;
  onOpenSettings: () => void;
  onMockTarget: (target: ScanTarget) => void;
  onDemoSelect: () => void;
};

export function RoomView({
  children,
  gazeCursor,
  roomCameraReady,
  roomVideoRef,
  store,
  visibleGazeDirection,
  onConnectArduino,
  onDisconnectArduino,
  onOpenSettings,
  onMockTarget,
  onDemoSelect
}: RoomViewProps) {
  return (
    <section className="room-fullscreen" id="main-view">
      {roomCameraReady ? (
        <video className="room-video" ref={roomVideoRef} muted playsInline aria-label="외장 룸 카메라 화면" />
      ) : (
        <div className="room-empty-feed" role="img" aria-label="외장 카메라 연결 대기 화면" />
      )}

      <div className="mini-brand" aria-label="EyeCan Room">
        <span className="brand-mark"><i /><i /></span>
        <strong>EyeCan Room</strong>
      </div>
      <button className="room-settings-button" type="button" aria-label="설정" onClick={onOpenSettings}>⚙</button>
      <div className="current-angle-target">
        <small>현재 카메라 대상</small>
        <strong>{store.activeAngleTarget ? targetMeta[store.activeAngleTarget].name : '선택 없음'}</strong>
      </div>
      <div className={`arduino-panel arduino-${store.arduinoStatus.toLowerCase()}`}>
        <div>
          <strong>{arduinoStatusText(store.arduinoStatus)}</strong>
          <small>{store.arduinoError ?? `마지막 전송: ${store.lastArduinoCommand}`}</small>
          {store.arduinoStatus === 'CONNECTED' && (
            <small>
              조명 {store.arduinoLevels.light} · 선풍기 {store.arduinoLevels.fan} · Pan {store.arduinoLevels.pan}° · Tilt {store.arduinoLevels.tilt}°
            </small>
          )}
          {store.arduinoLog.length > 0 && (
            <small>{store.arduinoLog[store.arduinoLog.length - 1]}</small>
          )}
          <small>iPad 제어 {store.ipadStatus === 'CONNECTED' ? 'USB 연결됨' : '미연결'} · Bluetooth {store.ipadBleConnected ? '페어링됨' : '대기'}</small>
        </div>
        <button
          type="button"
          disabled={store.arduinoStatus === 'UNSUPPORTED' || store.arduinoStatus === 'CONNECTING'}
          onClick={store.arduinoStatus === 'CONNECTED' ? onDisconnectArduino : onConnectArduino}
        >
          {store.arduinoStatus === 'CONNECTED' ? '해제' : 'Arduino 연결'}
        </button>
      </div>

      <div className={`gaze-pill gaze-${visibleGazeDirection.toLowerCase()}`}>
        <span>●</span> 시선 · {directionLabel[visibleGazeDirection]}
      </div>
      <div className="angle-demo-controls" aria-label="개발용 카메라 각도 테스트">
        <button type="button" onClick={() => onMockTarget('CURTAIN')}>왼쪽 · 커튼</button>
        <button type="button" onClick={() => onMockTarget('LIGHT')}>위 · 조명</button>
        <button type="button" onClick={() => onMockTarget('IPAD')}>정면 · iPad</button>
        <button type="button" onClick={() => onMockTarget('FAN')}>오른쪽 · 선풍기</button>
        <button className="demo-blink-button" type="button" onClick={onDemoSelect}>길게 눈감아 선택</button>
      </div>
      <div className="gaze-cursor" style={{ '--gaze-x': gazeCursor.x, '--gaze-y': gazeCursor.y } as CSSProperties} aria-hidden="true"><i /></div>

      {children}
    </section>
  );
}
