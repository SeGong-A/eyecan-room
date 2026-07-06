from __future__ import annotations

from dataclasses import dataclass, asdict

from fastapi import FastAPI, WebSocket

from .blink import BlinkEventType, BlinkStateMachine
from .gaze import GazeClassifier, GazeDirection, GazePoint


@dataclass
class ControlState:
    gaze_direction: str = "CENTER"
    selected_target: str = "TV"
    scan_step: int = 0
    connection_state: str = "DISCONNECTED"
    last_blink_event: str = BlinkEventType.NONE.value
    last_gaze_point_x: float = 0.5
    last_gaze_point_y: float = 0.5


app = FastAPI(title="EyeCan Room API", version="0.1.0")
state = ControlState()
blink_machine = BlinkStateMachine()
gaze_classifier = GazeClassifier()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/state")
def get_state() -> dict[str, object]:
    return asdict(state)


@app.post("/state/ready")
def mark_ready() -> dict[str, object]:
    state.connection_state = "READY"
    return asdict(state)


@app.post("/events/blink")
def receive_blink_event(is_closed: bool, now_ms: int) -> dict[str, object]:
    event = blink_machine.update(is_closed=is_closed, now_ms=now_ms)
    state.last_blink_event = event.value
    return {"event": event.value, "state": asdict(state)}


@app.post("/events/gaze")
def receive_gaze_event(x: float, y: float) -> dict[str, object]:
    point = GazePoint(x=x, y=y)
    direction = gaze_classifier.classify(point)
    state.gaze_direction = direction.value
    state.last_gaze_point_x = x
    state.last_gaze_point_y = y
    return {"direction": direction.value, "state": asdict(state)}


@app.websocket("/ws/state")
async def ws_state(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(asdict(state))
    await websocket.close()
