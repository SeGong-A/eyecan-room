import type { useCamera } from '../hooks/useCamera';
import type { AppState } from '../store/useAppStore';
import type { FullGazeDirection, SetupStage } from '../types/control';
import { calibrationCopy, calibrationSteps, directionLabel } from '../domain/control';
import { cameraMessage, visionMessage } from '../utils/gaze';

type CameraController = ReturnType<typeof useCamera>;

type SetupFlowProps = {
  calibrationIndex: number;
  eyeCamera: CameraController;
  expectedCalibrationDirection: FullGazeDirection;
  gazeTrackingReady: boolean;
  isExpectedDirection: boolean;
  isEyeCalibrationStep: boolean;
  roomCamera: CameraController;
  setupStage: Exclude<SetupStage, 'HOME' | 'ROOM'>;
  store: AppState;
  onCaptureCalibrationStep: () => void;
  onConnectEyeCameraAndStartVision: () => void;
  onConnectRoomCameraAndEnter: () => void;
};

export function SetupFlow({
  calibrationIndex,
  eyeCamera,
  expectedCalibrationDirection,
  gazeTrackingReady,
  isExpectedDirection,
  isEyeCalibrationStep,
  roomCamera,
  setupStage,
  store,
  onCaptureCalibrationStep,
  onConnectEyeCameraAndStartVision,
  onConnectRoomCameraAndEnter
}: SetupFlowProps) {
  return (
    <>
      <header className="app-header">
        <a className="brand" href="#main-view" aria-label="EyeCan Room 홈">
          <span className="brand-mark"><i /><i /></span>
          <span>EyeCan <strong>Room</strong></span>
        </a>
        <div className="header-status" aria-live="polite">
          <span className={`status-dot ${gazeTrackingReady ? 'online' : ''}`} />
          {setupStage === 'EYE_CAMERA' && !isEyeCalibrationStep && '내장 카메라 연결 필요'}
          {isEyeCalibrationStep && '사용자 눈동자 인식 중'}
          {setupStage === 'ROOM_CAMERA' && '외장 카메라 연결 필요'}
        </div>
      </header>

      <section className={isEyeCalibrationStep ? 'setup-screen setup-screen-compact' : 'setup-screen'} id="main-view">
        <div className="setup-copy">
          <small>
            {setupStage === 'EYE_CAMERA' && 'STEP 1 · 사용자 눈동자 인식'}
            {setupStage === 'ROOM_CAMERA' && 'STEP 2 · 외장 카메라 연결'}
          </small>
          <h1>
            {setupStage === 'EYE_CAMERA' && !isEyeCalibrationStep && '눈동자 인식을 시작합니다'}
            {isEyeCalibrationStep && '시선 방향 확인'}
            {setupStage === 'ROOM_CAMERA' && '외장 카메라를 연결합니다'}
          </h1>
          <p>
            {setupStage === 'EYE_CAMERA' && !isEyeCalibrationStep && '내장 카메라로 눈과 얼굴 위치를 확인하고 문제가 생기면 원인을 바로 표시합니다.'}
            {isEyeCalibrationStep && '정면, 왼쪽, 오른쪽, 위, 아래를 차례로 저장해주세요.'}
            {setupStage === 'ROOM_CAMERA' && '외장 카메라가 연결되면 방 화면으로 바로 이동합니다.'}
          </p>
        </div>

        <div className="setup-panel">
          <video className="camera-hidden-feed" ref={eyeCamera.videoRef} muted playsInline aria-label="내장 카메라 눈동자 인식 스트림" />
          <video className="camera-hidden-feed" ref={roomCamera.videoRef} muted playsInline aria-label="외장 룸 카메라 스트림" />

          {setupStage === 'EYE_CAMERA' && !isEyeCalibrationStep && (
            <div className="start-card">
              <div className="start-orbit" aria-hidden="true"><i /><i /><i /></div>
              <span className={`setup-state-dot ${gazeTrackingReady ? 'ready' : ''}`} />
              <strong>{gazeTrackingReady ? '시선 추적이 준비되었습니다' : '시선 추적을 시작해주세요'}</strong>
              <p>{cameraMessage(eyeCamera.status)}</p>
              <div className="setup-actions">
                <button className="primary-button" type="button" disabled={eyeCamera.status === 'REQUESTING'} onClick={onConnectEyeCameraAndStartVision}>
                  {eyeCamera.status === 'REQUESTING' ? '연결 중' : '시작하기'}
                </button>
              </div>
            </div>
          )}

          {isEyeCalibrationStep && (
            <div className="gaze-check-card">
              <div className="gaze-guide-stage" aria-label={`${directionLabel[expectedCalibrationDirection]} 시선 유도 화면`}>
                <span className="guide-cross guide-cross-top" />
                <span className="guide-cross guide-cross-right" />
                <span className="guide-cross guide-cross-bottom" />
                <span className="guide-cross guide-cross-left" />
                <span className={`guide-target target-${expectedCalibrationDirection.toLowerCase()}`} />
                <em>{directionLabel[expectedCalibrationDirection]}</em>
              </div>
              <strong>{calibrationCopy[expectedCalibrationDirection]}</strong>
              <small>{calibrationIndex + 1} / {calibrationSteps.length}</small>
              <div className={isExpectedDirection ? 'gaze-detection-status ok' : 'gaze-detection-status'}>
                <span>{store.faceDetected ? '얼굴 인식됨' : '얼굴 대기 중'}</span>
                <strong>현재 시선: {directionLabel[store.gazeDirection]}</strong>
                <em>{visionMessage(store.visionStatus)}</em>
              </div>
              {store.visionError && <div className="camera-error compact" role="alert"><strong>시선 추적 오류</strong><p>{store.visionError}</p></div>}
              <div className="step-dots">{calibrationSteps.map((step, index) => <i className={index <= calibrationIndex ? 'active' : ''} key={step} />)}</div>
              <p className="dev-skip-note">이 방향을 바라본 상태에서 저장하세요</p>
              <button className="primary-button dev-ok-button" type="button" onClick={onCaptureCalibrationStep}>
                {calibrationIndex === calibrationSteps.length - 1 ? '시선 인식 완료' : `${directionLabel[expectedCalibrationDirection]} 저장`}
              </button>
            </div>
          )}

          {setupStage === 'ROOM_CAMERA' && (
            <div className="setup-actions">
              {roomCamera.devices.length > 1 && (
                <select aria-label="외장 카메라 선택" value={roomCamera.selectedDeviceId} onChange={(event) => void roomCamera.connect(event.target.value)}>
                  {roomCamera.devices.map((device) => <option value={device.deviceId} key={device.deviceId}>{device.label}</option>)}
                </select>
              )}
              <button className="primary-button" type="button" disabled={roomCamera.status === 'REQUESTING'} onClick={onConnectRoomCameraAndEnter}>
                {roomCamera.status === 'REQUESTING' ? '외장 카메라 연결 중' : '외장 카메라 연결하기'}
              </button>
            </div>
          )}

          {(eyeCamera.error || roomCamera.error) && (
            <div className="camera-error" role="alert">
              <strong>카메라 연결 오류</strong>
              <span>{setupStage === 'ROOM_CAMERA' ? roomCamera.error?.name : eyeCamera.error?.name}</span>
              <p>{setupStage === 'ROOM_CAMERA' ? roomCamera.error?.message : eyeCamera.error?.message}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
