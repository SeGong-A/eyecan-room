# EyeCan Room

EyeCan Room은 시선과 눈깜박임을 이용해 침상 사용자의 생활환경을 제어하는 시스템입니다.

최종 제어 대상은 선풍기, 조명, 커튼과 보조 모니터 TV입니다. Arduino가 회신한 팬틸트 카메라 각도의 넓은 방향 구역으로 현재 대상을
판별하고, 길게 눈을 감으면 해당 기기의 명령 회전 UI를 바로 엽니다.

이 저장소는 역할별로 나눈 작은 모노레포 구조로 구성되어 있습니다.

- `apps/web`: 자동 시선 준비, 스캔 메뉴, Web Serial 기반 Arduino 연결을 담당하는 React + TypeScript UI
- `apps/api`: 시선 추적 실행, 시선 상태, WebSocket/HTTP 연동을 담당하는 Python 백엔드
- `Gaze_control_RL`: 시선 추적 모델과 Arduino 통합 제어 스케치
- `firmware`: direct command 방식의 Arduino 펌웨어와 배선 문서
- `configs`: 공통 캘리브레이션 값과 장치 프리셋

## MVP 기술 스택

- 프론트엔드: React, TypeScript, Vite, Zustand
- 비전: Python, OpenCV, MediaPipe, NumPy
- 백엔드: FastAPI, WebSocket
- Firmware: Arduino C++

## 실행 구조

현재 프로젝트는 시선 추적과 Arduino 제어 경로를 분리합니다.

```text
내장 카메라 + Gaze_control_RL 모델
        ↓
FastAPI apps/api
        ↓ /ws/state
React UI apps/web

React UI apps/web
        ↓ Web Serial API
Arduino

React UI apps/web ↔ FastAPI TV 상태
        ↓ 별도 /tv-display 창
포터블 모니터
```

- UI와 시선 추적은 API로 연결됩니다.
- UI가 `/vision/start`를 호출하면 FastAPI가 연결된 카메라를 검사해 얼굴이 가장 크게 보이는 내장 카메라를 선택하고 `Gaze_control_RL`의 모델로 시선 제어값을 계산합니다.
- 계산된 시선 오차, 모터 속도, 자동 영점 상태, 눈깜빡임 이벤트는 `/ws/state` WebSocket으로 UI에 전달됩니다.
- UI와 Arduino는 API가 아니라 브라우저의 Web Serial API로 직접 연결됩니다.
- UI의 `/events/command` 호출은 Arduino 제어용이 아니라 API 상태와 로그 동기화용입니다.
- TV 채널·전원은 Arduino로 보내지 않고 FastAPI의 `/tv/command`와 `/ws/state`로 방 화면과 TV 창을 동기화합니다. 볼륨은 이번 시연 메뉴에서 제외했습니다.
- 시선 추적 worker는 원본 PPO 모델로 추론하면서 90개 유효 샘플마다 온라인 학습을 수행합니다.
- 2초 안에 짧은 깜빡임 4회를 감지하면 시연용 응급 알림을 고정 표시합니다.

## 환경 설정

### 1. 준비 사항

- Node.js 20 이상
- pnpm
- Python 3.11
- Chrome 또는 Edge
- Arduino IDE 또는 Arduino CLI
- 시선 추적용 내장 카메라
- 외장 카메라와 Arduino 장치
- TV 시연용 포터블 모니터와 영상 출력 가능한 USB-C 케이블 또는 USB-C→HDMI 어댑터 + HDMI→Mini HDMI 케이블

### 2. 웹앱 설치

```bash
cd apps/web
pnpm install
pnpm build
```

### 3. Python 환경 만들기

```bash
cd apps/api
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

시선 추적의 MediaPipe FaceLandmarker는 현재 macOS에서 Python 3.11 + `mediapipe==0.10.21` 조합으로 맞춥니다. Python 3.13 + `mediapipe==1.0.1` 조합은 FaceLandmarker 생성 시 Python 프로세스가 종료될 수 있습니다.

이미 `apps/api/.venv`를 Python 3.13으로 만든 적이 있다면 해당 가상환경을 삭제한 뒤 위 명령으로 다시 만듭니다.

시선 추적에 필요한 모델은 아래 위치에 있어야 합니다.

```text
Gaze_control_RL/face_landmarker.task
Gaze_control_RL/residual_gaze_model_v3.zip
```

### 4. Arduino 펌웨어 업로드

시연용 Web Serial 연결은 메뉴 기반 스케치와 맞춰져 있습니다.

- Arduino IDE에서 `Gaze_control_RL/eyecan_integrated_control_v2/eyecan_integrated_control_v2.ino`를 엽니다.
- 보드와 시리얼 포트를 선택합니다.
- baud rate는 스케치와 동일하게 `9600`을 사용합니다.
- 스케치를 Arduino에 업로드합니다.

최신 UI의 연속 팬틸트 제어에는 이 스케치의 `V/H/Q` 프로토콜이 필요합니다.

- `V <id> <pan10> <tilt10>`: 두 축 속도 지정 (`0.1°/s` 단위)
- `H <id>`: 현재 각도에서 정지
- `Q <id>`: 현재 Pan/Tilt 각도 조회
- 응답 `A <id> <pan10> <tilt10>`, 오류 `E <id> <code>`

구형 펌웨어가 업로드되어 있으면 웹 화면에 `Arduino 펌웨어 업데이트 필요`가 표시되고 자동 시선 이동은 시작되지 않습니다.

`firmware/eyecan_room.ino`는 direct command 방식의 별도 스케치입니다. 현재 UI의 Web Serial 명령 시퀀스는 메뉴 기반 통합 스케치 기준입니다.

### 5. Python API 실행

터미널 1에서 실행합니다.

```bash
cd apps/api
source .venv/bin/activate
uvicorn app.main:app --reload
```

API는 기본적으로 `http://127.0.0.1:8000`에서 실행됩니다.

### 6. 웹앱 개발 서버 실행

터미널 2에서 실행합니다.

```bash
cd apps/web
pnpm dev
```

> VS Code의 **Go Live / Live Server로 프로젝트 루트를 열면 폴더 목록만 표시됩니다.**
> 이 웹앱은 반드시 위 명령으로 실행한 뒤 터미널에 표시되는 `http://localhost:5173` 주소로 접속합니다.

웹앱은 아래 주소로 접속합니다.

```text
http://localhost:5173
```

Vite 개발 서버는 `/vision`, `/state`, `/events`, `/tv/command`, `/ws` 요청을 `http://127.0.0.1:8000`의 API 서버로 프록시합니다.

### 6-1. 2.1 객체 탐지 서버 (별도 터미널)

시선용 가상환경은 변경하지 않습니다. 저장소 루트에서 최초 한 번 실행합니다.

```bash
python3.11 -m venv apps/api/.venv-detection
apps/api/.venv-detection/bin/pip install -r apps/api/requirements-detection.lock.txt
apps/api/.venv-detection/bin/python apps/api/scripts/prepare_object_model.py
```

모델은 공식 YOLO11n 가중치이며 `apps/api/models/objects/manifest.json`에 출처·버전·SHA-256을 기록합니다. 서버는 준비된 로컬 파일만 읽고 실행 중 자동 다운로드하지 않습니다. Ultralytics의 AGPL-3.0/상용 라이선스 조건을 확인한 뒤 배포하세요.

이후에는 별도 터미널에서 다음 명령만 실행합니다.

```bash
cd apps/api
.venv-detection/bin/uvicorn app.object_api:app --host 127.0.0.1 --port 8001
```

실행 순서는 시선 API `8000` → 객체 탐지 API `8001` → 웹 `5173`입니다. 웹의 `/objects/*`만 `8001`로 전달합니다. 확인 주소는 `http://127.0.0.1:8001/objects/health`이며 기본 모델은 `READY`, `supportedTypes: ["bottle", "cell_phone", "cup"]`가 나와야 합니다. 탐지 서버를 끄더라도 기존 가전·TV 제어 경로는 유지됩니다.

### 6-2. 2.1 AAC 음성 사전 점검

- 방 화면의 설정 → `의사소통 · 한국어 음성`에서 한국어 음성을 선택하고 `음성 테스트`로 소리 출력을 확인합니다. OS에 한국어 음성이 없으면 먼저 설치해야 합니다. 자동 재발화는 하지 않습니다.
- 실제 컵·물병·핸드폰을 외장 영상의 충분히 큰 영역에 놓습니다. 화면에서 절반 이상 보이고 전체 원본 영상 면적의 1% 이상이어야 하며, 아래쪽으로 카메라를 움직인 뒤에도 보여야 합니다. 모델은 일반 컵·병을 탐지하며 물이 들어 있는지 구별하지 않으므로 시연용 물컵·물병을 배치합니다.
- Arduino 회신 각도가 `147 < Pan < 157`, `Tilt ≥ 25`에서 500ms 유지되면 의사소통 대상이 됩니다. 유지 구간은 `Tilt ≥ 21`이며 기존 가전 선택이 우선합니다.
- 이 상태에서 0.5초 이상 2초 미만 눈감기 → 물컵 → 요청 선택 → 한국어 음성 1회 → 1초 완료 알림 후 탐색으로 돌아갑니다. 메뉴가 열린 이후에는 객체가 가려져도 목록을 유지합니다.
- 객체 목록은 탐지된 종류만 물컵 → 물병 → 핸드폰 → 휴지 → 뒤로 순으로 표시합니다. 휴지는 검증된 별도 모델이 없으면 표시하지 않습니다. 물병 요청은 물병 요청·뚜껑 열기·물병 치우기, 핸드폰 요청은 핸드폰 요청·전화 요청·충전 요청이며 각각 뒤로가 포함됩니다. 보호자에게 음성으로 요청할 뿐 실제 전화나 기기 명령을 실행하지 않습니다.
- 커튼·조명·선풍기·TV 방향에서 객체가 함께 안정적으로 탐지되면 긴 눈감기 후 `현재 가전 → 탐지 객체 → 뒤로` 대상 선택 메뉴가 먼저 열립니다. 가전을 고르면 기존 제어 메뉴, 객체를 고르면 해당 음성 요청 메뉴로 이동합니다. 객체가 없으면 기존처럼 가전 메뉴가 바로 열리며, 아래쪽 AAC 전용 진입도 유지됩니다.
- 2초 이상 눈감기는 취소, 응급 제스처는 최우선입니다. 둘 다 음성 출력을 중단합니다. 얼굴·연결 유실은 새로운 선택을 막지만 이미 시작한 발화는 끝까지 재생합니다.
- 객체 탐지 오류는 설정에서 `탐지 다시 확인`, 측정 기록은 `측정 로그 내보내기`로 확인합니다. 로그에는 이미지·음성 원본이 포함되지 않습니다.
- 각티슈 메뉴 데이터는 준비되어 있지만 검증된 커스텀 모델이 없으므로 현재 휴지 후보는 표시하지 않습니다. 모델 교체와 실제 시연 완료 여부는 [2.1 검증 기록](docs/aac-2.1-verification.md)을 참고하세요.

### 7. 실행 순서 요약

처음 실행할 때:

```bash
cd /Users/youbeenisabellahwang/Desktop/eyecan-room/apps/api
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

새 터미널:

```bash
cd /Users/youbeenisabellahwang/Desktop/eyecan-room/apps/web
pnpm install
pnpm dev
```

이미 설치가 끝난 뒤에는:

```bash
cd /Users/youbeenisabellahwang/Desktop/eyecan-room/apps/api
source .venv/bin/activate
uvicorn app.main:app --reload
```

새 터미널:

```bash
cd /Users/youbeenisabellahwang/Desktop/eyecan-room/apps/web
pnpm dev
```

### 8. 시연 흐름

1. API 서버를 먼저 실행합니다.
2. 웹앱 개발 서버를 실행합니다.
3. Chrome 또는 Edge에서 `http://localhost:5173`에 접속합니다.
4. `시작하기` → `눈동자 인식 시작`을 누르고 내장 카메라·얼굴 인식·기준점 상태가 준비되면 `방 카메라 연결로 이동`을 선택합니다. 수동 5방향 캘리브레이션은 없습니다.
5. 외장 카메라 연결 단계에서 카메라를 연결합니다.
6. Arduino가 연결되지 않았다면 ROOM 화면의 `Arduino 연결` 버튼으로 포트를 선택합니다. 우측 상단 연결 상태 버튼에서는 연결·해제, 각도, 마지막 명령과 통신 기록을 확인합니다.
   Arduino를 새로 연결할 때마다 카메라는 실측 TV 정면인 `Pan 152° / Tilt 16°`로 초기화합니다. 새로고침 후 재진입할 때도 동일하며, 초기 각도 회신 확인과 1초 이동 대기가 끝난 뒤 시선 이동을 허용합니다. 메뉴를 열고 닫는 동작은 원점 복귀가 아니라 현 위치 정지입니다.
7. 설정 → `설치 점검` → `카메라 이동`에서 축별 3도 이동을 확인합니다. 필요하면 `방향 반전`에서 좌우/상하 부호를 반전한 뒤 `점검 완료`를 선택합니다.
8. 정면 `Pan 152° / Tilt 16°`에서 좌우 ±10°·상하 ±8° 영역은 TV, 그보다 왼쪽은 커튼, 오른쪽은 선풍기, 보정 화면의 위쪽 영역은 조명으로 자동 판정됩니다. 조명 구역은 TV보다 우선합니다. 현재 거꾸로 설치된 카메라에서는 위쪽 이동 시 Tilt 각도가 감소하며, 특정 기기 각도를 별도로 등록할 필요가 없습니다.
9. 시선으로 카메라를 움직이고 중앙을 보면 현재 각도에서 정지합니다. 방향 대상이 0.5초 유지되어 표시되면 길게 눈감아 해당 기기의 명령 UI를 엽니다.
10. 원하는 명령이 선택 위치에 오면 다시 길게 눈감습니다.

### 9. TV 포터블 모니터 준비

1. M3 MacBook Air는 덮개를 열고 내장 화면·내장 카메라를 사용합니다. 기존 LG 외장 화면은 분리하고 포터블 모니터 한 대만 연결합니다.
2. 영상 출력이 가능한 USB-C 케이블로 MacBook의 Thunderbolt/USB-C 포트와 모니터 Type-C 입력을 연결합니다.
3. 화면이 나오지 않거나 전원이 부족하면 모니터에 별도 USB-C 전원을 연결하고, 영상은 `USB-C→HDMI 어댑터 + HDMI→Mini HDMI 케이블`로 연결합니다.
4. macOS `시스템 설정 > 디스플레이`에서 미러링이 아닌 `확장 디스플레이`로 설정합니다.
5. 방 화면 우측 상단 `설정 > TV 화면 열기`를 누릅니다. 자동 배치 권한을 허용하면 TV 창을 보조 화면으로 옮기고, 미지원·거부 시에는 직접 옮깁니다.
6. TV 창에서 `전체 화면`을 한 번 누릅니다. 추후 영상 파일에 소리가 포함되면 브라우저 자동재생 정책 때문에 시연 전 `영상 재생 시작`을 한 번 눌러야 할 수 있습니다.

`apps/web/public/tv/channels/`에는 채널 1 자연, 채널 2 바다, 채널 3 산 영상이 연결되어 있으며 각 영상은 반복 재생됩니다. 세 파일은 H.264 MP4로 브라우저 재생이 가능하지만 오디오 트랙이 없습니다. 이번 시연의 TV 메뉴는 `CH− / POWER / CH+ / 뒤로`만 제공하며 볼륨 제어는 노출하지 않습니다. POWER OFF는 실제 HDMI 전원을 차단하는 것이 아니라 TV 웹 UI를 검은 화면으로 전환합니다.

외장 카메라 영상은 카메라의 거꾸로 된 설치 방향을 보정하기 위해 화면에서만 180도 회전합니다. 모터 Pan/Tilt 부호와 방향 구역 판정은 영상 회전과 독립적이며, 카메라 재장착이나 서보 기준 변경 뒤에는 모터 방향 점검을 다시 수행합니다.

### 10. 공통 설정

- `configs/default.json`은 공통 장치 프리셋 참고용입니다. 사용자 시선 영점은 실행 중 자동으로 조정됩니다.
- Serial 명령 이름은 펌웨어 스케치와 반드시 맞춥니다.
- 우측 상단 `설정 > AI / 시선 인식 > 가중치 자동 갱신`을 끄면 현재 모델로 추론과 자동 영점은 계속하고, 새 PPO 경험 축적과 optimizer 갱신만 멈춥니다. 이 값은 로컬 런타임 설정에 저장됩니다.
- 개인화 학습은 위 설정이 켜져 있고 외장 영상이 방 화면에서 실제 재생 중일 때만 허용합니다. 홈·눈동자 준비·카메라 연결 단계, 영상 중단·해제, 숨겨진 탭과 응급 화면에서는 학습하지 않습니다. 시선 추론과 자동 영점은 학습과 별개로 유지합니다. 브라우저가 비정상 종료되어도 표시 상태 신호가 3초 동안 없으면 worker가 학습을 중단합니다.

## UI 디자인 및 회귀 검사

- 공통 로고, 디자인 토큰, 상태별 변경 전후 캡처: [UI 개편 검증 기록](docs/ui-redesign/README.md)
- `apps/web`에서 `pnpm exec playwright install chromium`을 한 번 실행한 뒤 `pnpm test:ui`로 모의 UI 검사를 실행합니다. 비어 있는 4173 포트가 필요합니다.
- 테스트는 카메라, WebSocket, HTTP API, Web Serial을 모두 모의 처리하며 실제 Arduino나 시선 모델을 작동시키지 않습니다.
