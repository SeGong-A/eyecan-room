from __future__ import annotations

import asyncio
from dataclasses import dataclass, asdict
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .blink import BlinkEventType, BlinkStateMachine
from .gaze import GazeClassifier, GazePoint
from .vision import GazeSample, VisionGazeTracker


@dataclass
class ControlState:
    gaze_direction: str = "CENTER"
    selected_target: str = "TV"
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
    last_command: str = "NONE"
    vision_status: str = "STOPPED"
    vision_error: str | None = None
    face_detected: bool = False
    eye_aspect_ratio: float = 0.0


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
gaze_classifier = GazeClassifier()
vision_tracker = VisionGazeTracker()
active_websockets: set[WebSocket] = set()
main_loop: asyncio.AbstractEventLoop | None = None


@app.on_event("startup")
async def remember_main_loop() -> None:
    global main_loop
    main_loop = asyncio.get_running_loop()


async def broadcast_state() -> None:
    payload = asdict(state)
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
    return asdict(state)


@app.post("/state/ready")
async def mark_ready() -> dict[str, object]:
    state.connection_state = "READY"
    await broadcast_state()
    return asdict(state)


@app.post("/state/calibration")
async def update_calibration(is_calibrated: bool) -> dict[str, object]:
    state.is_calibrated = is_calibrated
    state.scan_step = 0
    await broadcast_state()
    return asdict(state)


@app.post("/state/target")
async def update_target(target: str) -> dict[str, object]:
    state.selected_target = target
    state.interaction_mode = "EXPLORE"
    state.scan_step = 0
    await broadcast_state()
    return asdict(state)


@app.post("/state/mode")
async def update_mode(mode: str) -> dict[str, object]:
    state.interaction_mode = mode
    state.scan_step = 0
    await broadcast_state()
    return asdict(state)


@app.post("/state/scan-speed")
async def update_scan_speed(scan_interval_ms: int) -> dict[str, object]:
    state.scan_interval_ms = max(1000, min(scan_interval_ms, 5000))
    await broadcast_state()
    return asdict(state)


@app.post("/events/blink")
async def receive_blink_event(is_closed: bool, now_ms: int) -> dict[str, object]:
    event = blink_machine.update(is_closed=is_closed, now_ms=now_ms)
    state.last_blink_event = event.value
    if event.value != BlinkEventType.NONE.value:
        state.blink_sequence += 1
    if event == BlinkEventType.CANCEL:
        state.is_paused = not state.is_paused
        state.interaction_mode = "EXPLORE"
        state.scan_step = 0
    await broadcast_state()
    return {"event": event.value, "state": asdict(state)}


@app.post("/events/gaze")
async def receive_gaze_event(x: float, y: float) -> dict[str, object]:
    point = GazePoint(x=x, y=y)
    direction = gaze_classifier.classify(point)
    state.gaze_direction = direction.value
    state.last_gaze_point_x = x
    state.last_gaze_point_y = y
    await broadcast_state()
    return {"direction": direction.value, "state": asdict(state)}


def receive_vision_sample(sample: GazeSample) -> None:
    state.vision_status = vision_tracker.status
    state.vision_error = vision_tracker.error
    state.face_detected = sample.face_detected
    state.eye_aspect_ratio = sample.ear

    blink_event = blink_machine.update(
        is_closed=sample.face_detected and sample.ear < 0.2,
        now_ms=int(time.time() * 1000),
    )
    state.last_blink_event = blink_event.value
    if blink_event.value != BlinkEventType.NONE.value:
        state.blink_sequence += 1
    if blink_event == BlinkEventType.CANCEL:
        state.is_paused = not state.is_paused
        state.interaction_mode = "EXPLORE"
        state.scan_step = 0

    if sample.face_detected:
        point = GazePoint(x=sample.x, y=sample.y)
        direction = gaze_classifier.classify(point)
        state.gaze_direction = direction.value
        state.last_gaze_point_x = sample.x
        state.last_gaze_point_y = sample.y

    if main_loop and main_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast_state(), main_loop)


@app.post("/vision/start")
async def start_vision(camera_index: int = 0) -> dict[str, object]:
    vision_tracker.start(camera_index=camera_index, on_sample=receive_vision_sample)
    state.vision_status = vision_tracker.status
    state.vision_error = vision_tracker.error
    await broadcast_state()
    return asdict(state)


@app.post("/vision/stop")
async def stop_vision() -> dict[str, object]:
    vision_tracker.stop()
    state.vision_status = vision_tracker.status
    await broadcast_state()
    return asdict(state)


@app.post("/events/command")
async def receive_command(command: str) -> dict[str, object]:
    state.last_command = command
    await broadcast_state()
    return {"command": command, "state": asdict(state)}


@app.websocket("/ws/state")
async def ws_state(websocket: WebSocket) -> None:
    await websocket.accept()
    state.connection_state = "STREAMING"
    active_websockets.add(websocket)
    await websocket.send_json(asdict(state))

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
    except Exception:
        active_websockets.discard(websocket)
