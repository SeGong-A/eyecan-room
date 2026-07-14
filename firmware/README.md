# EyeCan Room Firmware

Arduino or ESP32 firmware for the EyeCan Room demo hardware.

## Responsibilities

- Parse serial command strings from the laptop
- Move the pan and tilt servos
- Control fan speed with PWM
- Control light brightness with PWM
- Control curtain motion

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
