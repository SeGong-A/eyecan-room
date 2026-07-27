# EyeCan Room Firmware

Arduino or ESP32 firmware for the EyeCan Room demo hardware.

## Responsibilities

- Parse serial command strings from the laptop
- Move the pan and tilt servos
- Control fan speed with PWM
- Control light brightness with PWM
- Control curtain motion
- Receive window commands (motor pins will be assigned after hardware selection)

Pin assignments and the reasoning behind them live in [PINS.md](./PINS.md).
Per-device wiring instructions live in [WIRING.md](./WIRING.md).

## Command examples

- `CAM_LEFT`
- `CAM_RIGHT`
- `CAM_UP`
- `CAM_DOWN`
- `CAM_STOP`
- `FAN_ON`
- `FAN_OFF`
- `FAN_LOW`
- `FAN_MID`
- `FAN_HIGH`
- `LIGHT_ON`
- `LIGHT_OFF`
- `LIGHT_UP`
- `LIGHT_DOWN`
- `CURTAIN_OPEN`
- `CURTAIN_CLOSE`
- `CURTAIN_STOP`
- `WINDOW_OPEN`
- `WINDOW_CLOSE`
- `WINDOW_STOP`

TV commands (`TV_POWER`, `TV_CH_UP`, `TV_CH_DOWN`, `TV_VOL_UP`, `TV_VOL_DOWN`) are not
controlled by this firmware — they're handled by the web/iPad mockup.

## Response format

Every recognized command echoes back `ACK:<COMMAND_NAME>` over Serial once handled,
e.g. `ACK:FAN_HIGH`.
