# EyeCan Room API

FastAPI service for the EyeCan Room control loop.

## Responsibilities

- Track the current control state
- Expose health and state endpoints
- Serve as the place for gaze, blink, and scan events
- Forward serial commands to Arduino or ESP32 hardware

## Next steps

- Add camera processing pipeline
- Add serial command queue
- Keep WebSocket state synchronized with the React UI
