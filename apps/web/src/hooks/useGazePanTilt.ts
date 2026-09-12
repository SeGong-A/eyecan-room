import { useEffect, useRef } from 'react';
import type { ArduinoWriteResult } from '../lib/arduinoSerial';
import type { ArduinoStatus } from '../types/control';

// apps/api/app/vision.py AdaptiveGazeController.max_pointer_speed(1.5)와 맞춘 상한.
const MAX_OMEGA = 1.5;
const MIN_STEP_DEG = 5; // omega가 백엔드 데드존을 살짝 넘었을 때의 최소 스텝
const MAX_STEP_DEG = 45; // 펌웨어 기본 STEP_SIZE와 동일한 상한

// arduinoSerial.ts의 왕복 비용(WRITE_DELAY_MS 90ms × 3줄 + ACK_WAIT_MS 260ms ≈ 530ms)보다
// 여유 있게 잡은 반복 전송 간격. 이번 변경은 "얼마나 자주 보낼지"가 아니라 "한 번에
// 얼마나 움직일지"만 바꾸므로 간격 자체는 그대로 유지한다.
const PAN_TILT_REPEAT_MS = 600;

// 시선이 중심에서 벗어난 정도(omega)에 비례하는 스텝 크기(도)를 계산한다.
// omega는 백엔드(vision.py)의 P-제어기가 이미 데드존 처리를 해둔 값이라 여기서
// 별도 데드존 판정 없이 절대값이 0에 가까우면 그대로 "움직이지 않음"으로 취급한다.
function omegaToStepDeg(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < 1e-3) return 0;
  const scaled = (magnitude / MAX_OMEGA) * MAX_STEP_DEG;
  return Math.round(Math.min(MAX_STEP_DEG, Math.max(MIN_STEP_DEG, scaled)));
}

/**
 * 시선이 화면 중심에서 벗어난 정도(팬/틸트 각각의 omega)에 비례해 아두이노 팬틸트
 * 카메라를 계속 이동시킨다 — 살짝 벗어나면 작게, 끝까지 밀어붙이면 크게 움직이는
 * 조이스틱형 제어. 양쪽 축 omega가 모두 0(=시선이 중앙 데드존 안)이면 그 자리에서
 * 멈춘다. 대각선 시선이면 팬/틸트 두 축을 한 틱에 함께 움직인다.
 */
export function useGazePanTilt(
  gazeOmega: { x: number; y: number },
  arduinoStatus: ArduinoStatus,
  isPaused: boolean,
  isActive: boolean,
  sendArduinoCommand: (command: string) => Promise<ArduinoWriteResult>
) {
  const omegaRef = useRef(gazeOmega);
  const sendRef = useRef(sendArduinoCommand);

  useEffect(() => {
    omegaRef.current = gazeOmega;
  }, [gazeOmega]);

  // sendArduinoCommand는 매 렌더마다 새로 생성되는 일반 함수라(useArduinoController.ts에
  // useCallback 없이 정의됨), 아래 인터벌 effect의 의존성 배열에 넣지 않고 ref로만
  // 최신값을 읽는다 — useRotationScanner가 rotationStepRef로 최신 스텝을 읽는 것과 동일한 패턴.
  useEffect(() => {
    sendRef.current = sendArduinoCommand;
  });

  useEffect(() => {
    if (!isActive || isPaused || arduinoStatus !== 'CONNECTED') return;

    const timerId = window.setInterval(() => {
      const { x, y } = omegaRef.current;
      const panDeg = omegaToStepDeg(x);
      const tiltDeg = omegaToStepDeg(y);

      // 팬/틸트 둘 다 0이면(=시선이 중앙 데드존 안) 그 자리에서 멈춘다 — 아무 것도
      // 보내지 않음.
      //
      // 대신 시선이 중앙으로 돌아오는 즉시 자동으로 카메라를 정중앙(90/90)으로
      // 복귀시키고 싶다면, 아래 줄의 주석을 해제한다:
      // if (panDeg === 0 && tiltDeg === 0) { void sendRef.current('CAM_STOP'); return; }

      if (panDeg > 0) void sendRef.current(`${x < 0 ? 'CAM_LEFT' : 'CAM_RIGHT'}:${panDeg}`);
      if (tiltDeg > 0) void sendRef.current(`${y < 0 ? 'CAM_UP' : 'CAM_DOWN'}:${tiltDeg}`);
    }, PAN_TILT_REPEAT_MS);

    return () => window.clearInterval(timerId);
  }, [isActive, isPaused, arduinoStatus]);
}
