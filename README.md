# EyeCan Room

EyeCan Room은 시선과 눈깜박임을 이용해 침상 사용자의 생활환경을 제어하는 시스템입니다.

최종 제어 대상은 선풍기, 조명, TV, 커튼, 창문입니다. 커튼과 창문은 카메라에서 같은 창가 영역으로
감지한 뒤, 회전 선택 UI에서 제어 대상을 한 번 더 선택하고 각 장치의 명령 화면으로 이동합니다.

이 저장소는 역할별로 나눈 작은 모노레포 구조로 구성되어 있습니다.

- `apps/web`: 캘리브레이션, 스캔 메뉴, Web Serial 기반 Arduino 연결을 담당하는 React + TypeScript UI
- `apps/api`: 시선 추적 실행, 시선 상태, WebSocket/HTTP 연동을 담당하는 Python 백엔드
- `Gaze_control_RL`: 시선 추적 모델과 Arduino 통합 제어 스케치
- `firmware`: direct command 방식의 Arduino/ESP32 펌웨어와 배선 문서
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
```

- UI와 시선 추적은 API로 연결됩니다.
- UI가 `/vision/start?camera_index=0`을 호출하면 FastAPI가 내장 카메라를 열고 `Gaze_control_RL`의 모델로 시선 좌표를 계산합니다.
- 계산된 시선 방향, 시선 좌표, 눈깜빡임 이벤트는 `/ws/state` WebSocket으로 UI에 전달됩니다.
- UI와 Arduino는 API가 아니라 브라우저의 Web Serial API로 직접 연결됩니다.
- UI의 `/events/command` 호출은 Arduino 제어용이 아니라 API 상태와 로그 동기화용입니다.

## 환경 설정

### 1. 준비 사항

- Node.js 20 이상
- pnpm
- Python 3.11 이상
- Chrome 또는 Edge
- Arduino IDE 또는 Arduino CLI
- 시선 추적용 내장 카메라
- 외장 카메라와 Arduino 장치

### 2. 웹앱 설치

```bash
cd apps/web
pnpm install
pnpm build
```

### 3. Python 환경 만들기

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

시선 추적에 필요한 모델은 아래 위치에 있어야 합니다.

```text
Gaze_control_RL/face_landmarker.task
Gaze_control_RL/residual_gaze_model_v3.zip
```

### 4. Arduino 펌웨어 업로드

시연용 Web Serial 연결은 메뉴 기반 스케치와 맞춰져 있습니다.

- Arduino IDE에서 `Gaze_control_RL/eyecan_integrated_control_v2.ino`를 엽니다.
- 보드와 시리얼 포트를 선택합니다.
- baud rate는 스케치와 동일하게 `9600`을 사용합니다.
- 스케치를 Arduino에 업로드합니다.

`firmware/eyecan_room.ino`는 direct command 방식의 별도 스케치입니다. 현재 UI의 Web Serial 명령 시퀀스는 `Gaze_control_RL/eyecan_integrated_control_v2.ino` 기준입니다.

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

Vite 개발 서버는 `/vision`, `/state`, `/events`, `/ws` 요청을 `http://127.0.0.1:8000`의 API 서버로 프록시합니다.

### 7. 실행 순서 요약

처음 실행할 때:

```bash
cd /Users/youbeenisabellahwang/Desktop/eyecan-room/apps/api
python3 -m venv .venv
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
4. `시작하기`를 눌러 내장 카메라 기반 사용자 눈동자 인식을 진행합니다.
5. 외장 카메라 연결 단계에서 카메라를 연결합니다.
6. ROOM 화면 우측 상단의 `Arduino 연결` 버튼을 누르고 브라우저 포트 선택 창에서 Arduino 포트를 선택합니다.
7. 시선 방향과 길게 눈감기 선택으로 로테이션 UI를 띄우고 명령을 선택합니다.

### 9. 공통 설정

- `configs/default.json`에서 스캔 속도와 캘리브레이션 기본값을 수정합니다.
- Serial 명령 이름은 펌웨어 스케치와 반드시 맞춥니다.
