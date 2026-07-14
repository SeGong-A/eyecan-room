# Architecture

## Runtime split

1. `apps/web`
   - React UI
   - Calibration flow
   - Scan menus
   - Room camera presentation
   - TV mock screen

2. `apps/api`
   - Camera capture and gaze/blink analysis
   - Command state machine
   - WebSocket updates to the UI
   - Serial communication to Arduino or ESP32

3. `firmware`
   - Pan and tilt servo control
   - Fan PWM control
   - Light PWM control
   - Curtain motor control

## Shared data

- Calibration presets
- Command names
- Device presets
- Scan timing
