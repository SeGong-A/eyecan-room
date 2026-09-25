from __future__ import annotations

import asyncio
from dataclasses import dataclass, asdict
import time

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .blink import BlinkEventType, BlinkStateMachine, EmergencyBlinkDetector
from .gaze import GazeClassifier, GazePoint
from .vision import GazeSample, VisionGazeTracker


@dataclass
class ControlState:
    gaze_direction: str = "CENTER"
    selected_target: str = "FAN"
    interaction_mode: str = "EXPLORE"
    is_calibrated: bool = False
    is_paused: bool = False
    scan_interval_ms: int = 2000
    scan_step: int = 0
    connection_state: str = "DISCONNECTED"
    last_blink_event: str = BlinkEventType.NONE.value
    blink_sequence: int = 0
    last_gaze_point_x: float = 0.5
    last_gaze_point_y: float = 0.5
    gaze_omega_x: float = 0.0
    gaze_omega_y: float = 0.0
    last_command: str = "NONE"
    vision_status: str = "STOPPED"
    vision_error: str | None = None
    face_detected: bool = False
    eye_aspect_ratio: float = 0.0
    gaze_ready: bool = False
    learning_enabled: bool = True
    learning_update_count: int = 0
    emergency_active: bool = False
    emergency_sequence: int = 0


app = FastAPI(title="EyeCan Room API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

state = ControlState()
blink_machine = BlinkStateMachine()
emergency_detector = EmergencyBlinkDetector()
gaze_classifier = GazeClassifier()
vision_tracker = VisionGazeTracker()
active_websockets: set[WebSocket] = set()
main_loop: asyncio.AbstractEventLoop | None = None


def state_payload() -> dict[str, object]:
    return asdict(state)


def reset_scan_position() -> None:
    state.scan_step = 0


def update_gaze_point(x: float, y: float) -> str:
    point = GazePoint(x=x, y=y)
    direction = gaze_classifier.classify(point)
    state.gaze_direction = direction.value
    state.last_gaze_point_x = x
    state.last_gaze_point_y = y
    return direction.value


def apply_blink_event(event: BlinkEventType, now_ms: int) -> None:
    state.last_blink_event = event.value
    if event.value != BlinkEventType.NONE.value:
        state.blink_sequence += 1
    if emergency_detector.register(event, now_ms):
        state.emergency_active = True
        state.emergency_sequence += 1
        state.is_paused = True
        state.interaction_mode = "EXPLORE"
        reset_scan_position()
        return
    if event == BlinkEventType.CANCEL and state.emergency_active:
        clear_emergency(now_ms)
    elif event == BlinkEventType.CANCEL:
        state.interaction_mode = "EXPLORE"
        reset_scan_position()


def clear_emergency(now_ms: int) -> None:
    state.emergency_active = False
    state.is_paused = False
    emergency_detector.reset(now_ms, with_cooldown=True)


def schedule_broadcast_state() -> None:
    if main_loop and main_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast_state(), main_loop)


@app.on_event("startup")
async def remember_main_loop() -> None:
    global main_loop
    main_loop = asyncio.get_running_loop()


async def broadcast_state() -> None:
    payload = state_payload()
    stale_websockets: set[WebSocket] = set()

    for websocket in active_websockets:
        try:
            await websocket.send_json(payload)
        except Exception:
            stale_websockets.add(websocket)

    for websocket in stale_websockets:
        active_websockets.discard(websocket)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/state")
def get_state() -> dict[str, object]:
    return state_payload()


@app.post("/state/ready")
async def mark_ready() -> dict[str, object]:
    state.connection_state = "READY"
    await broadcast_state()
    return state_payload()


@app.post("/state/calibration")
async def update_calibration(is_calibrated: bool) -> dict[str, object]:
    state.is_calibrated = is_calibrated
    reset_scan_position()
    await broadcast_state()
    return state_payload()


@app.post("/state/target")
async def update_target(target: str) -> dict[str, object]:
    state.selected_target = target
    state.interaction_mode = "EXPLORE"
    reset_scan_position()
    await broadcast_state()
    return state_payload()


@app.post("/state/mode")
async def update_mode(mode: str) -> dict[str, object]:
    state.interaction_mode = mode
    reset_scan_position()
    await broadcast_state()
    return state_payload()


@app.post("/state/scan-speed")
async def update_scan_speed(scan_interval_ms: int) -> dict[str, object]:
    state.scan_interval_ms = max(1000, min(scan_interval_ms, 5000))
    await broadcast_state()
    return state_payload()


@app.post("/events/blink")
async def receive_blink_event(is_closed: bool, now_ms: int) -> dict[str, object]:
    event = blink_machine.update(is_closed=is_closed, now_ms=now_ms)
    apply_blink_event(event, now_ms)
    await broadcast_state()
    return {"event": event.value, "state": state_payload()}


@app.post("/events/gaze")
async def receive_gaze_event(x: float, y: float) -> dict[str, object]:
    direction = update_gaze_point(x=x, y=y)
    await broadcast_state()
    return {"direction": direction, "state": state_payload()}


def receive_vision_sample(sample: GazeSample) -> None:
    state.vision_status = vision_tracker.status
    state.vision_error = vision_tracker.error
    state.face_detected = sample.face_detected
    state.eye_aspect_ratio = sample.ear
    state.gaze_ready = sample.ready
    state.learning_enabled = sample.learning_enabled
    state.learning_update_count = sample.learning_update_count
    # 얼굴을 놓치면 sample.omega_x/y가 이미 0.0으로 오므로, 여기서 얼굴 검출 여부와
    # 무관하게 그대로 반영하면 "얼굴 인식 실패 시 팬틸트 정지"까지 자연히 해결된다.
    state.gaze_omega_x = sample.omega_x
    state.gaze_omega_y = sample.omega_y

    now_ms = int(time.time() * 1000)
    if not sample.face_detected:
        blink_machine.reset()
        emergency_detector.reset()
        schedule_broadcast_state()
        return
    blink_event = blink_machine.update(is_closed=sample.ear < 0.2, now_ms=now_ms)
    apply_blink_event(blink_event, now_ms)

    if sample.face_detected:
        update_gaze_point(x=sample.x, y=sample.y)

    schedule_broadcast_state()


@app.post("/vision/start")
async def start_vision(camera_index: int = 0) -> dict[str, object]:
    blink_machine.reset()
    emergency_detector.reset()
    vision_tracker.start(camera_index=camera_index, on_sample=receive_vision_sample)
    state.vision_status = vision_tracker.status
    state.vision_error = vision_tracker.error
    await broadcast_state()
    return state_payload()


@app.post("/vision/learning")
async def set_vision_learning(enabled: bool) -> dict[str, object]:
    if not vision_tracker.send_control("learning", enabled=enabled):
        raise HTTPException(status_code=409, detail="Vision tracker is not running")
    state.learning_enabled = enabled
    await broadcast_state()
    return state_payload()


@app.post("/vision/model/save")
async def save_vision_model() -> dict[str, object]:
    if not vision_tracker.send_control("save"):
        raise HTTPException(status_code=409, detail="Vision tracker is not running")
    return {"queued": True}


@app.post("/vision/model/reset")
async def reset_vision_model() -> dict[str, object]:
    if not vision_tracker.send_control("reset"):
        raise HTTPException(status_code=409, detail="Vision tracker is not running")
    state.gaze_ready = False
    await broadcast_state()
    return state_payload()


@app.post("/emergency/clear")
async def dismiss_emergency() -> dict[str, object]:
    clear_emergency(int(time.time() * 1000))
    await broadcast_state()
    return state_payload()


@app.post("/vision/stop")
async def stop_vision() -> dict[str, object]:
    vision_tracker.stop()
    state.vision_status = vision_tracker.status
    await broadcast_state()
    return state_payload()


@app.post("/events/command")
async def receive_command(command: str) -> dict[str, object]:
    state.last_command = command
    await broadcast_state()
    return {"command": command, "state": state_payload()}


@app.websocket("/ws/state")
async def ws_state(websocket: WebSocket) -> None:
    await websocket.accept()
    state.connection_state = "STREAMING"
    active_websockets.add(websocket)
    await websocket.send_json(state_payload())

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
    except Exception:
        active_websockets.discard(websocket)
