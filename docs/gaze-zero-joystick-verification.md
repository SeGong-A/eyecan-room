# Gaze Zero/Joystick Verification

검증일: 2026-09-25

## 자동 검증

- Web TypeScript: 통과 (`pnpm exec tsc --noEmit --pretty false`)
- Web production build: 통과 (`pnpm build`)
- Python compile: 통과 (`main.py`, `vision.py`, `adaptive_gaze.py`)
- Python regression tests: 8개 통과
  - 눈을 뜬 유효 샘플 15개로 초기 영점 설정
  - EMA, 가우시안 영점 감쇄, 데드존, 비례 속도 출력
  - Y축 급변 제동
  - 얼굴 유실 시 영점 보존 및 시간 상태 초기화
  - 짧은 깜빡임 4회 응급 이벤트와 재호출 대기
- Arduino Uno compile: 통과
  - Flash: 13,152 / 32,256 bytes (40%)
  - SRAM: 401 / 2,048 bytes (19%), 1,647 bytes available

## 런타임 확인

- API `/health`: 정상
- WebSocket: API 재시작 뒤 자동 재연결 확인
- Vision worker: `RUNNING`, 얼굴 검출, 자동 영점 준비 완료, 샘플 순번 증가 확인
- 외장 USB 카메라: ROOM 전체 화면 표시 확인
- 외장 영상: `<video>`에만 180도 회전 적용 확인
- STEP 1 및 ROOM: 중앙 십자선 표시 확인
- Chrome Web Serial: `Arduino 연결됨`, Pan 90°/Tilt 20°, `연속 팬틸트 준비됨` 확인
- 설정 진입 시 `H` ACK 수신 및 중앙 로테이션 UI 동작 확인
- 개발용 데모 진입 및 모의 각도 제어 제거 확인

## 모델

- `Gaze_control_RL/face_landmarker.task`: 3.6MB
  - SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- `Gaze_control_RL/residual_gaze_model_v3.zip`: 145KB
  - SHA-256: `76ba544686bb78617adaf182bdd49a57448061522468e9630b6a50d369c55a07`
- `Gaze_control_RL/residual_gaze_model_v3_personalized.zip`: 보존

## 남은 실기 확인

- `/dev/cu.usbserial-120`에 최신 펌웨어 업로드 완료.
- 상태/정지 프로토콜 확인:
  - `Q 1` → `A 1 900 200`
  - `H 2` → `A 2 900 200`
- 속도 적분 확인:
  - `V 3 100 0` 이후 watchdog 정지 → Pan 90.0°에서 93.0°로 이동
  - `H 4`, `Q 5` → `A 4 930 200`, `A 5 930 200`
- 수동 중앙 복귀 뒤 `Q 6` → `A 6 900 200` 확인.

재업로드 명령:

```bash
arduino-cli upload -p /dev/cu.usbserial-120 \
  --fqbn arduino:avr:uno \
  Gaze_control_RL/eyecan_integrated_control_v2
```

- 실제 설치 화면 기준 좌우/상하 부호는 설정의 `모터 방향`에서 확인하고 점검 완료 처리해야 함.
- 실제 양축 방향, 1.5초 한계 재영점, 방향 구역 진입 및 조명·선풍기·커튼 명령 실행은 현장 확인이 필요함.
