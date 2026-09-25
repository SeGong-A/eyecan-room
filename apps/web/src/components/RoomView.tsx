import type { ReactNode, RefCallback } from 'react';
import { arduinoStatusText, directionLabel } from '../domain/control';
import type { AppState } from '../store/useAppStore';
import type { FullGazeDirection } from '../types/control';
import { targetMeta } from '../domain/control';
import { GazeJoystick } from './GazeJoystick';

type RoomViewProps = {
  children: ReactNode;
  roomCameraReady: boolean;
  roomVideoRef: RefCallback<HTMLVideoElement>;
  store: AppState;
  visibleGazeDirection: FullGazeDirection;
  onConnectArduino: () => void;
  onDisconnectArduino: () => void;
  onOpenSettings: () => void;
};

export function RoomView({
  children,
  roomCameraReady,
  roomVideoRef,
  store,
  visibleGazeDirection,
  onConnectArduino,
  onDisconnectArduino,
  onOpenSettings
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
          {store.arduinoStatus === 'CONNECTED' && <small>{store.motionProtocolReady ? '연속 팬틸트 준비됨' : 'Arduino 펌웨어 업데이트 필요'} · 모터 방향 {store.motorSetupComplete ? '점검 완료' : '기본 방향 사용 중'}</small>}
          {store.arduinoLog.length > 0 && (
            <small>{store.arduinoLog[store.arduinoLog.length - 1]}</small>
          )}
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
      {store.interactionMode === 'EXPLORE' && !store.emergencyActive && <GazeJoystick
        errorX={store.gazeError.x}
        errorY={store.gazeError.y}
        deadzone={store.gazeDeadzone}
        calibrationActive={store.calibrationActive}
        showMotion={store.faceDetected && store.gazeReady && !store.isBlinking && !store.saccadeBraking && !store.calibrationActive}
      />}

      {children}
    </section>
  );
}
