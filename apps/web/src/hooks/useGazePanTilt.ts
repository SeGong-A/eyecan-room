import { useEffect, useRef } from 'react';
import type { ArduinoWriteResult } from '../lib/arduinoSerial';
import type { ArduinoStatus, FullGazeDirection } from '../types/control';

// 시선 방향은 이제 팬틸트 카메라 전용이다. 대상(선풍기/조명/TV/커튼/창문) 선택은
// 깜빡임만으로 이뤄지고 방향과는 무관하므로, 이 매핑에는 appliance 커맨드가 없다.
// CENTER는 의도적으로 매핑하지 않는다 — 시선이 가장자리를 벗어나면 "그 자리에서
// 멈춘다"는 뜻이다.
const PAN_TILT_COMMAND_BY_DIRECTION: Partial<Record<FullGazeDirection, string>> = {
  LEFT: 'CAM_LEFT',
  RIGHT: 'CAM_RIGHT',
  UP: 'CAM_UP',
  DOWN: 'CAM_DOWN'
};

// arduinoSerial.ts의 왕복 비용(WRITE_DELAY_MS 90ms × 3줄 + ACK_WAIT_MS 260ms ≈ 530ms)보다
// 여유 있게 잡은 반복 전송 간격. 시선이 한 방향 가장자리에 머무는 동안 이 주기로 계속
// CAM_LEFT/RIGHT/UP/DOWN을 다시 보내 45도씩(펌웨어 STEP_SIZE) 누적 이동시킨다.
const PAN_TILT_REPEAT_MS = 600;

/**
 * 시선이 화면 가장자리(LEFT/RIGHT/UP/DOWN)에 머무는 동안 아두이노 팬틸트 카메라를
 * 그 방향으로 상시 이동시킨다. 시선이 CENTER로 돌아오면 그 자리에서 멈춘다.
 */
export function useGazePanTilt(
  gazeDirection: FullGazeDirection,
  arduinoStatus: ArduinoStatus,
  isPaused: boolean,
  isActive: boolean,
  sendArduinoCommand: (command: string) => Promise<ArduinoWriteResult>
) {
  const directionRef = useRef(gazeDirection);
  const sendRef = useRef(sendArduinoCommand);

  useEffect(() => {
    directionRef.current = gazeDirection;
  }, [gazeDirection]);

  // sendArduinoCommand는 매 렌더마다 새로 생성되는 일반 함수라(useArduinoController.ts에
  // useCallback 없이 정의됨), 아래 인터벌 effect의 의존성 배열에 넣지 않고 ref로만
  // 최신값을 읽는다 — useRotationScanner가 rotationStepRef로 최신 스텝을 읽는 것과 동일한 패턴.
  useEffect(() => {
    sendRef.current = sendArduinoCommand;
  });

  useEffect(() => {
    if (!isActive || isPaused || arduinoStatus !== 'CONNECTED') return;

    const timerId = window.setInterval(() => {
      const command = PAN_TILT_COMMAND_BY_DIRECTION[directionRef.current];
      if (!command) {
        // 시선이 CENTER(가장자리 밖)일 때는 그 자리에서 멈춘다 — 아무 것도 보내지 않음.
        //
        // 대신 시선이 중앙으로 돌아오는 즉시 자동으로 카메라를 정중앙(90/90)으로
        // 복귀시키고 싶다면, 아래 줄의 주석을 해제한다:
        // void sendRef.current('CAM_STOP');
        return;
      }
      void sendRef.current(command);
    }, PAN_TILT_REPEAT_MS);

    return () => window.clearInterval(timerId);
  }, [isActive, isPaused, arduinoStatus]);
}
