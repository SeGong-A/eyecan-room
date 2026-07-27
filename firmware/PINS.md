# Arduino Uno 핀 배치

`eyecan_room.ino`가 실제로 사용하는 핀과 그 이유를 정리합니다. 배선을 바꾸면 이 표와
`eyecan_room.ino` 상단의 핀 상수를 함께 업데이트합니다.

## 사용 중인 핀

| 기능 | 핀 | 타입 | 비고 |
| --- | --- | --- | --- |
| Pan Servo | D9 | PWM (Servo 라이브러리) | Timer1 사용 |
| Tilt Servo | D10 | PWM (Servo 라이브러리) | Timer1 사용 |
| Fan 속도 | D5 | PWM (`analogWrite`) | Timer0, 0~255 |
| Light 밝기 | D6 | PWM (`analogWrite`) | Timer0, 0~255 |
| Curtain 열기 방향 | D7 | Digital out | 릴레이/모터 드라이버 방향 핀 |
| Curtain 닫기 방향 | D8 | Digital out | 릴레이/모터 드라이버 방향 핀 |

## 예약 / 사용 금지

| 핀 | 이유 |
| --- | --- |
| D0 (RX) | USB Serial 명령 수신에 사용 — 다른 용도로 쓰면 시리얼 통신이 깨짐 |
| D1 (TX) | USB Serial ACK 응답 송신에 사용 — 위와 동일 |

## 아직 비어있는 핀 (향후 확장용, 예: Window 모터)

| 핀 | 비고 |
| --- | --- |
| D2, D4, D12, D13 | Digital I/O, PWM 아님 (D13은 보드 내장 LED와 공유) |
| D3, D11 | PWM 가능 (Timer2) — 속도 제어가 필요한 모터를 추가하면 여기부터 사용 |
| A0–A5 | 아날로그 입력, digitalWrite/Read로도 사용 가능 |

## 타이머 충돌 메모

Servo 라이브러리는 D9/D10에서 Timer1을 점유합니다. Fan(D5)/Light(D6)는 Timer0,
향후 확장 시 후보인 D3/D11은 Timer2를 쓰므로 서보 동작과 PWM 밝기/속도 제어가
서로 간섭하지 않습니다.

## 실제 배선으로 바꾸는 법

1. 이 표의 핀 번호를 실제로 연결한 핀으로 수정합니다.
2. `eyecan_room.ino` 상단의 `const int ...Pin = ...;` 상수를 동일하게 맞춥니다.
3. D0/D1은 절대 다른 용도로 재사용하지 않습니다.
