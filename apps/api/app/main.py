from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, asdict, field
import time

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .blink import BlinkEventType, BlinkStateMachine, EmergencyBlinkDetector
from .gaze import GazeClassifier, GazePoint
from .runtime_settings import load_learning_enabled, save_learning_enabled
from .learning_gate import ROOM_LEASE_SECONDS
from .vision import GazeSample, VisionGazeTracker


@dataclass
class TVState:
    power: bool = True
    channel: int = 1
    volume: int = 50
    mute: bool = False
    revision: int = 0


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
    gaze_error_x: float = 0.0
    gaze_error_y: float = 0.0
    gaze_deadzone: float = 0.03
    calibration_active: bool = False
    is_blinking: bool = False
    saccade_braking: bool = False
    sample_sequence: int = 0
    tracking_session_id: str = ""
    last_command: str = "NONE"
    vision_status: str = "STOPPED"
    vision_error: str | None = None
    face_detected: bool = False
    eye_aspect_ratio: float = 0.0
    gaze_ready: bool = False
    learning_enabled: bool = True
    learning_active: bool = False
    learning_update_count: int = 0
    emergency_active: bool = False
    emergency_sequence: int = 0
    tv: TVState = field(default_factory=TVState)


app = FastAPI(title="EyeCan Room API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

state = ControlState(learning_enabled=load_learning_enabled())
blink_machine = BlinkStateMachine()
emergency_detector = EmergencyBlinkDetector()
gaze_classifier = GazeClassifier()
vision_tracker = VisionGazeTracker()
active_websockets: set[WebSocket] = set()
room_video_leases: dict[WebSocket, float] = {}
main_loop: asyncio.AbstractEventLoop | None = None


def state_payload() -> dict[str, object]:
    payload = asdict(state)
    payload['learning_active'] = (state.learning_active and state.learning_enabled and
                                  vision_tracker.status == 'RUNNING' and
                                  max(room_video_leases.values(), default=0.0) > time.monotonic())
    return payload


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
    state.learning_active = sample.learning_active
    state.learning_update_count = sample.learning_update_count
    # 얼굴을 놓치면 sample.omega_x/y가 이미 0.0으로 오므로, 여기서 얼굴 검출 여부와
    # 무관하게 그대로 반영하면 "얼굴 인식 실패 시 팬틸트 정지"까지 자연히 해결된다.
    state.gaze_omega_x = sample.omega_x
    state.gaze_omega_y = sample.omega_y
    state.gaze_error_x = sample.error_x
    state.gaze_error_y = sample.error_y
    state.gaze_deadzone = sample.deadzone
    state.calibration_active = sample.calibration_active
    state.is_blinking = sample.is_blinking
    state.saccade_braking = sample.saccade_braking
    state.sample_sequence = sample.sample_sequence
    state.tracking_session_id = sample.tracking_session_id

    now_ms = int(time.time() * 1000)
    if not sample.face_detected:
        blink_machine.reset()
        emergency_detector.reset()
        schedule_broadcast_state()
        return
    blink_event = blink_machine.update(is_closed=sample.is_blinking, now_ms=now_ms)
    apply_blink_event(blink_event, now_ms)

    if sample.face_detected:
        update_gaze_point(x=sample.x, y=sample.y)

    schedule_broadcast_state()


@app.post("/vision/start")
async def start_vision(camera_index: int = -1) -> dict[str, object]:
    blink_machine.reset()
    emergency_detector.reset()
    vision_tracker.start(
        camera_index=camera_index,
        on_sample=receive_vision_sample,
        learning_enabled=state.learning_enabled,
    )
    state.gaze_error_x = 0.0
    state.gaze_error_y = 0.0
    state.gaze_omega_x = 0.0
    state.gaze_omega_y = 0.0
    state.sample_sequence = 0
    state.learning_active = False
    state.tracking_session_id = vision_tracker.tracking_session_id
    state.vision_status = vision_tracker.status
    state.vision_error = vision_tracker.error
    await broadcast_state()
    return state_payload()


@app.post("/vision/learning")
async def set_vision_learning(enabled: bool) -> dict[str, object]:
    if vision_tracker.status in {"RUNNING", "STARTING"}:
        result = await asyncio.to_thread(
            vision_tracker.send_control_and_wait,
            "learning",
            enabled=enabled,
        )
        if not result or not result.get("ok"):
            detail = result.get("error") if result else "Vision tracker is not running"
            raise HTTPException(status_code=409, detail=detail)
    save_learning_enabled(enabled)
    state.learning_enabled = enabled
    await broadcast_state()
    return state_payload()


@app.post("/tv/command")
async def control_tv(command: str) -> dict[str, object]:
    command = command.upper()
    if command == "POWER_TOGGLE":
        state.tv.power = not state.tv.power
    elif command in {"CHANNEL_NEXT", "CHANNEL_PREV", "VOLUME_UP", "VOLUME_DOWN", "MUTE_TOGGLE"}:
        if not state.tv.power:
            raise HTTPException(status_code=409, detail="TV 전원이 꺼져 있습니다")
        if command == "CHANNEL_NEXT":
            state.tv.channel = state.tv.channel % 3 + 1
        elif command == "CHANNEL_PREV":
            state.tv.channel = (state.tv.channel - 2) % 3 + 1
        elif command == "VOLUME_UP":
            state.tv.volume = min(100, state.tv.volume + 10)
            state.tv.mute = False
        elif command == "VOLUME_DOWN":
            state.tv.volume = max(0, state.tv.volume - 10)
            state.tv.mute = state.tv.volume == 0
        else:
            state.tv.mute = not state.tv.mute
    else:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 TV 명령입니다: {command}")

    state.tv.revision += 1
    state.last_command = f"TV_{command}"
    await broadcast_state()
    return {"accepted": True, "tv": asdict(state.tv)}


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


@app.post("/vision/recenter")
async def recenter_vision() -> dict[str, object]:
    if not vision_tracker.send_control("recenter"):
        raise HTTPException(status_code=409, detail="Vision tracker is not running")
    state.gaze_error_x = 0.0
    state.gaze_error_y = 0.0
    state.gaze_omega_x = 0.0
    state.gaze_omega_y = 0.0
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
    state.learning_active = False
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
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except (ValueError, TypeError):
                continue
            if not isinstance(payload, dict) or payload.get('type') != 'room_video_visibility':
                continue
            if payload.get('visible') is True:
                room_video_leases[websocket] = time.monotonic() + ROOM_LEASE_SECONDS
            else:
                room_video_leases.pop(websocket, None)
            vision_tracker.send_control('room_visibility', expires_at=max(room_video_leases.values(), default=0.0))
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
    except Exception:
        active_websockets.discard(websocket)
    finally:
        active_websockets.discard(websocket)
        room_video_leases.pop(websocket, None)
        vision_tracker.send_control('room_visibility', expires_at=max(room_video_leases.values(), default=0.0))
