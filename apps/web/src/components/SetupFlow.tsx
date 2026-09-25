import type { useCamera } from '../hooks/useCamera';
import type { AppState } from '../store/useAppStore';
import type { SetupStage } from '../types/control';
import { GazeJoystick } from './GazeJoystick';

type CameraController = ReturnType<typeof useCamera>;
type Props = {
  roomCamera: CameraController;
  setupStage: Exclude<SetupStage, 'HOME' | 'ROOM'>;
  store: AppState;
  onStartVision: () => void;
  onContinue: () => void;
  onConnectRoomCamera: () => void;
};

export function SetupFlow({ roomCamera, setupStage, store, onStartVision, onContinue, onConnectRoomCamera }: Props) {
  const visionReady = store.visionStatus === 'RUNNING' && store.faceDetected && store.gazeReady;
  return <>
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><i /><i /></span><span>EyeCan <strong>Room</strong></span></div>
      <div className="header-status"><span className={`status-dot ${visionReady ? 'online' : ''}`} />{setupStage === 'EYE_CAMERA' ? '눈동자 인식' : '외장 카메라 연결'}</div>
    </header>
    <section className="setup-screen quiet-setup" id="main-view">
      <div className="setup-copy">
        <small>{setupStage === 'EYE_CAMERA' ? 'STEP 1 · 눈동자 인식' : 'STEP 2 · 외장 카메라'}</small>
        <h1>{setupStage === 'EYE_CAMERA' ? '시선 제어를 준비합니다' : '방 카메라를 연결합니다'}</h1>
        <p>{setupStage === 'EYE_CAMERA' ? '정면을 편하게 바라보면 자동으로 기준점을 맞춥니다.' : '연결된 카메라 화면에서 방 안의 기기를 제어합니다.'}</p>
      </div>
      <div className="setup-panel setup-status-panel">
        <video className="camera-hidden-feed" ref={roomCamera.videoRef} muted playsInline />
        {setupStage === 'EYE_CAMERA' ? <>
          <GazeJoystick
            compact
            errorX={store.gazeError.x}
            errorY={store.gazeError.y}
            deadzone={store.gazeDeadzone}
            calibrationActive={store.calibrationActive}
            showMotion={store.gazeReady && store.faceDetected && !store.isBlinking && !store.saccadeBraking && !store.calibrationActive}
          />
          <strong>{visionReady ? '시선 제어 준비 완료' : store.visionStatus === 'STARTING' ? '내장 카메라를 찾고 있습니다' : store.visionStatus === 'RUNNING' ? '정면을 바라봐주세요' : '내장 카메라를 시작해주세요'}</strong>
          <p>카메라 {store.visionStatus === 'STARTING' ? '검색 중' : store.visionStatus === 'RUNNING' ? '연결됨' : '대기'} · 얼굴 {store.faceDetected ? '인식됨' : '대기'} · 자동 기준점 {store.gazeReady ? '완료' : '조정 중'}</p>
          {store.visionError && <div className="camera-error" role="alert"><strong>시선 추적 오류</strong><p>{store.visionError}</p></div>}
          <button className="primary-button" type="button" disabled={store.visionStatus === 'STARTING' || (store.visionStatus === 'RUNNING' && !visionReady)} onClick={visionReady ? onContinue : onStartVision}>{visionReady ? '외장 카메라 연결로 이동' : store.visionStatus === 'STARTING' ? '카메라 확인 중' : store.visionStatus === 'RUNNING' ? '자동 기준점 조정 중' : '눈동자 인식 시작'}</button>
        </> : <>
          <div className="camera-glyph" aria-hidden="true">▣</div>
          <strong>{roomCamera.status === 'REQUESTING' ? 'USB 외장 카메라를 찾고 있습니다' : '외장 카메라를 연결해주세요'}</strong>
          <p>내장 카메라는 시선 추적에만 사용하며 방 화면에는 USB 외장 카메라가 표시됩니다.</p>
          <button className="primary-button" type="button" disabled={roomCamera.status === 'REQUESTING'} onClick={onConnectRoomCamera}>{roomCamera.status === 'REQUESTING' ? '외장 카메라 확인 중' : '외장 카메라 연결'}</button>
        </>}
        {roomCamera.error && <div className="camera-error" role="alert"><strong>카메라 연결 오류</strong><p>{roomCamera.error.message}</p></div>}
      </div>
    </section>
  </>;
}
