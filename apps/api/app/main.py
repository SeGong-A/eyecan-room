from __future__ import annotations

from dataclasses import dataclass, asdict

from fastapi import FastAPI, WebSocket

from .blink import BlinkEventType, BlinkStateMachine


@dataclass
class ControlState:
    gaze_direction: str = "CENTER"
    selected_target: str = "TV"
    scan_step: int = 0
    connection_state: str = "DISCONNECTED"
    last_blink_event: str = BlinkEventType.NONE.value


app = FastAPI(title="EyeCan Room API", version="0.1.0")
state = ControlState()
blink_machine = BlinkStateMachine()


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


@app.websocket("/ws/state")
async def ws_state(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(asdict(state))
    await websocket.close()
