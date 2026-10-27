# EyeCan Room 2.1 검증 기록

## 범위

- 브랜치: `feat/eyecan-room-2-1-object-aac-tts`
- 2.0 미커밋 변경 보존. Arduino 펌웨어와 `eyecan_integrated_control_v2/`는 변경하지 않음.
- 새 서비스 `app.object_api`만 별도 Python 3.11 환경에서 실행. 기존 시선 환경은 변경하지 않음.
- AAC는 로컬 상태이며 기기 `ScanTarget`, Serial, TV 명령 프로토콜과 분리됨.

## 재현 명령

저장소 루트:

```bash
apps/api/.venv-detection/bin/python -m pytest apps/api/tests -q
apps/api/.venv-detection/bin/python -m py_compile apps/api/app/object_api.py apps/api/app/object_detection.py
```

웹 폴더:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm build
pnpm exec playwright test tests/aac.spec.ts
pnpm exec playwright test tests/ui.spec.ts
```

Playwright는 카메라·Arduino·시선 API·TTS를 모의 처리합니다. 물리 모터나 실제 사용자의 눈감음, 스피커 출력 검증이 아닙니다. 화면 캡처는 `docs/aac-2.1/screenshots/`에 생성됩니다.

## 소프트웨어 검증 결과

- Python 테스트 23개 통과 (객체 API 8개 포함).
- Playwright 고유 테스트 79개 통과: 기존 UI 49개, 카메라 초기화 3개, 응급 프록시 1개, AAC 26개. 테스트 그룹을 나누어 실행했음.
- 타입 검사, 프로덕션 빌드, Python 컴파일, `git diff --check` 통과.
- 1366×768 / 1920×1080 / 390×844 / 360×800의 라이트·다크 AAC 캡처 확인.
- 실제 전송 JPEG가 640×360이고 원본 왼쪽 위 표식이 회전 후 오른쪽 아래에 있는지 픽셀 검사 통과.
- 새 장치 명령이 AAC에서 Arduino·TV로 전달되지 않는지, 취소된 발화의 늦은 콜백이 성공 처리를 하지 않는지 검증.
- 얼굴·카메라·Serial 단절, 짧은 Blink, 전환 중 Blink, 500ms 이전 눈감음, ACK 누락, 음성 없음·실패·시작 지연과 탐지 서버 중단을 검증.

## 실제 모델 실행

- 모델: `yolo11n.pt`, Ultralytics assets `v8.3.0`
- SHA-256: `0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1`
- CPU, 스레드 2, 입력 640, 신뢰도 0.60.
- COCO128의 컵 라벨이 있는 사진 5장으로 실제 추론을 실행함. 3장에서 컵 검출, 2장은 검출 없음. 검출된 3장 중 1장은 UI의 1% 면적 조건 미달. 이 소규모 학습 데이터 실행은 실행 가능성 확인이지 현장 정확도 평가가 아님.
- 첫 추론 약 198ms, 이후 약 62~68ms. 시선 worker 동시 실행 중의 성능은 현장 확인 필요.
- 원본 이미지와 모의 검증은 구분됨. 재현 결과는 git 제외된 `apps/api/.test-artifacts/object-smoke.json`.
- 실제 실행 중인 웹 프록시 `5173/objects/detect` → `8001`에 COCO 이미지 `000000000605.jpg`를 JPEG로 전송하여 컵 2개 응답(신뢰도 약 0.861/0.785)을 확인함.

```bash
curl -L --fail https://github.com/ultralytics/assets/releases/download/v0.0.0/coco128.zip -o /tmp/eyecan-coco128.zip
apps/api/.venv-detection/bin/python apps/api/scripts/smoke_object_model.py /tmp/eyecan-coco128.zip
```

## 현장 완료 조건 (아직 미완료)

- 실제 컵 배치·조명 조건을 바꾼 전체 흐름 20회.
- 취소·응급·탐지 서버 단절 각각 5회.
- 실제 내장 카메라 눈 입력으로 아래쪽 500ms 안정화 및 정지 ACK 후 진입 확인.
- 실제 한국어 음성이 정확히 한 번 나오는지 스피커로 확인.
- 다른 문장, 중복 발화, 의도하지 않은 Arduino 명령은 0회여야 함.
- 각 시행의 조건·성공/실패·원인을 기록하고 설정의 JSON 측정 로그를 첨부.
- 실제 외장 영상의 탐지 박스 정렬·컵 최소 면적·소실 시 진입 차단 확인.
- 각티슈 P1: 실제 사진 수집, 촬영 세션별 분할, 라벨링, 학습 및 컵 회귀 검증 후에만 활성화.

소프트웨어 테스트 통과와 실제 사용자·장치 연속 시연 완료는 별개입니다. 현재 각티슈 학습과 현장 시연은 완료로 표시하지 않습니다.

## 물병·핸드폰 확장 (2026-10-23)

- YOLO 클래스 이름 `bottle`, `cell phone`을 허용하고 API에서는 `bottle`, `cell_phone`으로 반환합니다. 모델 가중치와 신뢰도 0.60, 면적·안정화 조건은 유지합니다.
- 물컵·물병·핸드폰을 종류별로 분리하며 같은 종류 여러 개는 메뉴 하나로 통합합니다. 물병·핸드폰은 각각 요청 3개와 뒤로를 제공합니다. 전화 요청도 TTS일 뿐 전화나 Arduino 명령을 실행하지 않습니다.
- Python 테스트 28개, AAC Playwright 테스트 44개 및 타입 검사 포함 웹 빌드 통과. 새 요청 6개의 단일 음성 호출과 장치 명령 미전송을 모의 브라우저에서 검증했습니다.
- 실제 COCO128 추론에서 컵·병 검출 확인. 핸드폰 라벨 사진 5장은 모두 신뢰도 0.60 이상 검출이 없었습니다. 그중 라벨 면적 1% 이상인 사진은 1장입니다. 새로운 3종 smoke 검증은 `cell_phone` 미검출로 실패하며, 모의 메뉴 검증과 구분합니다.
- 실제 핸드폰 배치 사진에서 탐지·후보 안정화·발화를 확인하기 전에는 핸드폰 실기 완료로 표시하지 않습니다. 컵·병의 내용물이 물인지 모델은 판별하지 않습니다.
- 가전 방향과 객체가 겹치면 카메라 정지 후 후보를 다시 읽고 `가전 → 탐지 객체 → 뒤로` 목록을 고정합니다. 객체가 없을 때는 기존 가전 메뉴로 바로 진입하며, 객체 선택은 Arduino·TV 명령 없이 해당 AAC 요청 메뉴로 이어집니다. 좌측 커튼+물병, 우측 선풍기+핸드폰 및 가전 선택 분기를 Playwright로 검증합니다.
- 가전 1개·객체 4개·뒤로의 최대 6항목 대상 선택 메뉴를 1366×768, 390×844, 360×800의 라이트·다크에서 검사했습니다. 모든 항목·중앙 표시·하단 선택 영역의 화면 이탈, 상호 겹침, 내부 텍스트 넘침이 없어야 통과합니다.
