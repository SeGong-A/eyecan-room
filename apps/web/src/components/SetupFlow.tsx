import { ArrowRight, Camera, Check, Circle, Eye, LoaderCircle, RefreshCw, ScanFace, Video } from 'lucide-react';
import type { useCamera } from '../hooks/useCamera';
import type { AppState } from '../store/useAppStore';
import type { SetupStage } from '../types/control';
import { BrandLogo } from './BrandLogo';
import { GazeJoystick } from './GazeJoystick';
import { Button, ErrorState, StatusBadge } from './ui';

type Props = {
  roomCamera: ReturnType<typeof useCamera>;
  setupStage: Exclude<SetupStage, 'HOME' | 'ROOM'>;
  store: AppState;
  onStartVision: () => void;
  onContinue: () => void;
  onConnectRoomCamera: () => void;
};

export function SetupFlow({ roomCamera, setupStage, store, onStartVision, onContinue, onConnectRoomCamera }: Props) {
  const isEye = setupStage === 'EYE_CAMERA';
  const visionReady = store.visionStatus === 'RUNNING' && store.faceDetected && store.gazeReady;
  const starting = store.visionStatus === 'STARTING';
  const running = store.visionStatus === 'RUNNING';
  const visionFailed = store.visionStatus === 'ERROR' || Boolean(store.visionError);
  const cameraBusy = roomCamera.status === 'REQUESTING';
  const roomTitle = roomCamera.status === 'DENIED' ? '카메라 권한이 필요합니다'
    : roomCamera.error ? '외장 카메라를 연결하지 못했습니다'
    : cameraBusy ? '외장 카메라 연결 중' : '방 카메라를 연결합니다';
  const eyeTitle = visionFailed ? '눈동자 인식을 시작하지 못했습니다'
    : visionReady ? '시선 제어 준비가 끝났습니다'
    : starting ? '내장 카메라를 찾고 있습니다'
    : running ? store.faceDetected ? '기준점을 맞추고 있습니다' : '얼굴을 기다리고 있습니다'
    : '시선 제어를 준비합니다';
  const checks = [
    { label: '내장 카메라', done: running, active: starting, Icon: Camera },
    { label: '얼굴 인식', done: running && store.faceDetected, active: running && !store.faceDetected, Icon: ScanFace },
    { label: '기준점', done: visionReady, active: running && store.faceDetected && !store.gazeReady, Icon: Eye }
  ];

  return <>
    <header className="app-header"><BrandLogo /><StatusBadge tone={store.connectionState === 'STREAMING' ? 'success' : 'warning'}>
      {store.connectionState === 'STREAMING' ? '시스템 연결됨' : '시스템 연결 대기'}
    </StatusBadge></header>
    <section className="setup-screen" id="main-view">
      <ol className="setup-steps" aria-label="연결 진행 단계">
        <li className={isEye ? 'is-current' : 'is-complete'} aria-current={isEye ? 'step' : undefined}>
          <span>{isEye ? '1' : <Check size={16} aria-hidden="true" />}</span>눈동자 인식
        </li>
        <li className={!isEye ? 'is-current' : ''} aria-current={!isEye ? 'step' : undefined}><span>2</span>방 카메라</li>
      </ol>
      <div className="setup-content">
        <header className="setup-heading"><span className="eyebrow">{isEye ? '눈동자 인식' : '외장 카메라'}</span><h1>{isEye ? eyeTitle : roomTitle}</h1></header>
        {isEye ? <>
          <div className="setup-gaze"><GazeJoystick compact errorX={store.gazeError.x} errorY={store.gazeError.y}
            deadzone={store.gazeDeadzone} calibrationActive={store.calibrationActive}
            showMotion={visionReady && !store.isBlinking && !store.saccadeBraking && !store.calibrationActive} /></div>
          <ul className="readiness-list" aria-label="시선 준비 상태">
            {checks.map(({ label, done, active, Icon }) => <li key={label} className={done ? 'is-complete' : active ? 'is-active' : ''}>
              <Icon size={20} aria-hidden="true" /><span>{label}</span>
              {done ? <Check size={18} aria-hidden="true" /> : active ? <LoaderCircle size={18} className="loading-icon" aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
              <span className="sr-only">{done ? '완료' : active ? '진행 중' : '대기'}</span>
            </li>)}
          </ul>
          {visionFailed && <ErrorState title="시선 추적 연결 오류">{store.visionError ?? '카메라 연결을 확인한 후 다시 시도해주세요.'}</ErrorState>}
          <Button className="setup-primary" busy={starting} disabled={running && !visionReady && !visionFailed}
            icon={visionReady ? <ArrowRight size={20} aria-hidden="true" /> : visionFailed ? <RefreshCw size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            onClick={visionReady ? onContinue : onStartVision}>
            {visionReady ? '방 카메라 연결로 이동' : visionFailed ? '다시 시도' : starting ? '카메라 확인 중' : running ? '시선 인식 중' : '눈동자 인식 시작'}
          </Button>
        </> : <>
          <div className={`setup-camera-symbol ${cameraBusy ? 'is-connecting' : ''}`} aria-hidden="true"><Video size={56} strokeWidth={1.5} /></div>
          <div className="camera-connection-row"><Camera size={22} aria-hidden="true" /><div><strong>외장 카메라</strong><span>{cameraBusy ? '연결 확인 중' : roomCamera.error ? '연결 필요' : '연결 대기'}</span></div>
            {cameraBusy ? <LoaderCircle size={20} className="loading-icon" aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
          </div>
          {roomCamera.error && <ErrorState title={roomCamera.status === 'DENIED' ? '접근 권한이 없습니다' : '카메라 연결 오류'}>
            {roomCamera.status === 'DENIED' ? '브라우저에서 카메라 권한을 허용한 후 다시 연결해주세요.' : roomCamera.error.message}
          </ErrorState>}
          <Button className="setup-primary" busy={cameraBusy} onClick={onConnectRoomCamera} icon={<Video size={20} aria-hidden="true" />}>
            {cameraBusy ? '외장 카메라 확인 중' : roomCamera.error ? '다시 연결' : '외장 카메라 연결'}
          </Button>
        </>}
      </div>
      <video className="camera-hidden-feed" ref={roomCamera.videoRef} muted playsInline aria-hidden="true" />
    </section>
  </>;
}
