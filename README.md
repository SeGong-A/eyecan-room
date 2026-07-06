# EyeCan Room

EyeCan Room is a gaze- and blink-driven room control system for bedbound users.

This repository is organized as a small monorepo with separate concerns:

- `apps/web`: React + TypeScript UI for calibration, scanning menus, and the TV mock screen
- `apps/api`: Python backend for vision state, device commands, and WebSocket/HTTP coordination
- `firmware`: Arduino/ESP32 firmware for camera motion, fan, light, and curtain control
- `configs`: shared calibration and device presets

## MVP stack

- Frontend: React, TypeScript, Vite, Zustand
- Vision: Python, OpenCV, MediaPipe, NumPy
- Backend: FastAPI or Flask, pySerial
- Firmware: Arduino C++

## Notes

The first implementation will favor a local web app running on the laptop browser.
The UI is web-based, while camera processing and hardware control stay in Python and firmware.
