from __future__ import annotations

from dataclasses import dataclass, asdict

from fastapi import FastAPI, WebSocket


@dataclass
class ControlState:
    gaze_direction: str = "CENTER"
    selected_target: str = "TV"
    scan_step: int = 0
    connection_state: str = "DISCONNECTED"


app = FastAPI(title="EyeCan Room API", version="0.1.0")
state = ControlState()


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


@app.websocket("/ws/state")
async def ws_state(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(asdict(state))
    await websocket.close()
