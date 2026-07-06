# EyeCan Room

EyeCan Room은 시선과 눈깜박임을 이용해 침상 사용자의 생활환경을 제어하는 시스템입니다.

이 저장소는 역할별로 나눈 작은 모노레포 구조로 구성되어 있습니다.

- `apps/web`: 캘리브레이션, 스캔 메뉴, TV 모형 화면을 담당하는 React + TypeScript UI
- `apps/api`: 시선 상태, 장치 명령, WebSocket/HTTP 연동을 담당하는 Python 백엔드
- `firmware`: 카메라 이동, 선풍기, 조명, 커튼 제어를 담당하는 Arduino/ESP32 펌웨어
- `configs`: 공통 캘리브레이션 값과 장치 프리셋

## MVP 기술 스택

- 프론트엔드: React, TypeScript, Vite, Zustand
- 비전: Python, OpenCV, MediaPipe, NumPy
- 백엔드: FastAPI 또는 Flask, pySerial
- Firmware: Arduino C++

## 참고 사항

초기 구현은 노트북 브라우저에서 실행하는 로컬 웹앱 형태를 우선합니다.
UI는 웹 기반으로 두고, 카메라 처리와 하드웨어 제어는 Python과 펌웨어가 맡습니다.

## 환경 설정

### 1. 준비 사항

- Node.js 20 이상
- npm
- Python 3.11 이상
- Arduino IDE 또는 Arduino CLI

### 2. 웹앱 설치

```bash
cd apps/web
npm install
npm run build
```

### 3. Python 환경 만들기

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Python API 실행

```bash
cd apps/api
source .venv/bin/activate
uvicorn app.main:app --reload
```

### 5. 웹앱 개발 서버 실행

```bash
cd apps/web
npm run dev
```

### 6. 펌웨어 설정

- Arduino IDE에서 `firmware/eyecan_room.ino`를 엽니다.
- 보드와 시리얼 포트를 올바르게 선택합니다.
- 스케치를 Arduino 또는 ESP32 장치에 업로드합니다.

### 7. 공통 설정

- `configs/default.json`에서 스캔 속도와 캘리브레이션 기본값을 수정합니다.
- Serial 명령 이름은 펌웨어 스케치와 반드시 맞춥니다.
