from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
import os
from threading import Event, Lock, Thread
import time


@dataclass(frozen=True)
class GazeSample:
    x: float
    y: float
    ear: float
    face_detected: bool


LEFT_EYE_LEFT, LEFT_EYE_RIGHT = 33, 133
LEFT_EYE_TOP, LEFT_EYE_BOTTOM = 159, 145

RIGHT_EYE_LEFT, RIGHT_EYE_RIGHT = 362, 263
RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM = 386, 374


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _calculate_ear(landmarks: list[object]) -> float:
    l_eye_w = max(1e-6, landmarks[LEFT_EYE_RIGHT].x - landmarks[LEFT_EYE_LEFT].x)
    r_eye_w = max(1e-6, landmarks[RIGHT_EYE_RIGHT].x - landmarks[RIGHT_EYE_LEFT].x)

    l_h1 = abs(landmarks[159].y - landmarks[145].y)
    l_h2 = abs(landmarks[160].y - landmarks[144].y)
    l_h3 = abs(landmarks[158].y - landmarks[153].y)
    r_h1 = abs(landmarks[386].y - landmarks[374].y)
    r_h2 = abs(landmarks[385].y - landmarks[380].y)
    r_h3 = abs(landmarks[387].y - landmarks[373].y)

    ear_left = ((l_h1 + l_h2 + l_h3) / 3.0) / l_eye_w
    ear_right = ((r_h1 + r_h2 + r_h3) / 3.0) / r_eye_w
    return float((ear_left + ear_right) / 2.0)


class AdaptiveGazeController:
    def __init__(self, model_path: str) -> None:
        import numpy as np

        self.np = np
        self.model = self._load_model(model_path)
        self.c = np.zeros(2, dtype=np.float32)
        self.initial_calib_done = False
        self.base_d = 0.03
        self.base_kp = 1.0
        self.d = self.base_d
        self.kp = self.base_kp
        self.alpha_ema = 0.6
        self.u_filtered = np.zeros(2, dtype=np.float32)
        self.obs_buffer: deque[list[float]] = deque(maxlen=15)
        self.prev_u = np.zeros(2, dtype=np.float32)
        self.prev_v = np.zeros(2, dtype=np.float32)
        self.prev_omega = np.zeros(2, dtype=np.float32)
        self.zero_crossings = 0.0
        self.max_gaze_speed_y = 1.6
        self.max_pointer_speed = 1.5
        self.last_time = time.time()

    def _load_model(self, model_path: str) -> object | None:
        if not os.path.exists(model_path):
            return None
        try:
            from stable_baselines3 import PPO

            return PPO.load(model_path)
        except Exception:
            return None

    def get_iris_center(self, landmarks: list[object]):
        np = self.np

        p_l_inner = np.array([landmarks[133].x, landmarks[133].y])
        p_l_outer = np.array([landmarks[33].x, landmarks[33].y])
        p_l_iris = np.array([landmarks[468].x, landmarks[468].y])

        p_r_inner = np.array([landmarks[362].x, landmarks[362].y])
        p_r_outer = np.array([landmarks[263].x, landmarks[263].y])
        p_r_iris = np.array([landmarks[473].x, landmarks[473].y])

        l_width = np.linalg.norm(p_l_outer - p_l_inner) + 1e-6
        r_width = np.linalg.norm(p_r_outer - p_r_inner) + 1e-6

        l_ear = abs(landmarks[159].y - landmarks[145].y) / l_width
        r_ear = abs(landmarks[386].y - landmarks[374].y) / r_width
        ear = float((l_ear + r_ear) / 2.0)

        l_dx = (p_l_iris[0] - (p_l_inner[0] + p_l_outer[0]) / 2) / l_width
        l_dy = (p_l_iris[1] - (p_l_inner[1] + p_l_outer[1]) / 2) / l_width
        r_dx = (p_r_iris[0] - (p_r_inner[0] + p_r_outer[0]) / 2) / r_width
        r_dy = (p_r_iris[1] - (p_r_inner[1] + p_r_outer[1]) / 2) / r_width

        return np.array([((l_dx + r_dx) / 2.0) * 4.5, ((l_dy + r_dy) / 2.0) * 9.0], dtype=np.float32), ear

    def update(self, landmarks: list[object]) -> tuple[float, float, float]:
        np = self.np

        current_time = time.time()
        dt = max(1e-3, current_time - self.last_time)
        self.last_time = current_time

        u_raw, ear = self.get_iris_center(landmarks)
        is_blinking = ear < 0.2
        if not is_blinking:
            self.u_filtered = self.alpha_ema * u_raw + (1 - self.alpha_ema) * self.u_filtered
        u = self.u_filtered.copy()
        v = u - self.prev_u
        gaze_speed_y = abs(float(v[1])) / dt

        if abs(v[0]) > 0.025 or abs(v[1]) > 0.025:
            if (v[0] * self.prev_v[0] < 0) or (v[1] * self.prev_v[1] < 0):
                self.zero_crossings = min(10.0, self.zero_crossings + 1.0)
            else:
                self.zero_crossings = max(0.0, self.zero_crossings - 0.4)
            self.prev_v = v.copy()
        else:
            self.zero_crossings = max(0.0, self.zero_crossings - 0.5)

        self.prev_u = u.copy()
        self.obs_buffer.append([float(u[0]), float(u[1])])

        omega = np.zeros(2, dtype=np.float32)
        if len(self.obs_buffer) == self.obs_buffer.maxlen:
            buf_np = np.array(self.obs_buffer)
            var = np.var(buf_np, axis=0)
            variance_sum = float(np.sum(var))

            if not self.initial_calib_done:
                self.c = u.copy()
                self.initial_calib_done = True

            x_err_raw = u - self.c
            obs = np.concatenate([x_err_raw, v, var, [float(self.zero_crossings)]]).astype(np.float32)
            action = np.zeros(4, dtype=np.float32)
            if self.model is not None:
                try:
                    action, _ = self.model.predict(obs, deterministic=True)
                    action = np.asarray(action, dtype=np.float32)
                except Exception:
                    self.model = None
                    action = np.zeros(4, dtype=np.float32)

            self.d = float(np.clip(self.base_d + action[0] * 0.02, 0.02, 0.12))
            self.kp = float(np.clip(self.base_kp + action[1] * 0.5, 0.7, 3.5))
            calib_rate = float(np.clip(0.08 + action[2] * 0.04, 0.02, 0.15))
            dynamic_var_thresh = float(np.clip(0.0007 + action[3] * 0.0002, 0.0001, 0.0011))

            gaze_dist = float(np.hypot(x_err_raw[0], x_err_raw[1]))
            att_weight = float(np.exp(-(gaze_dist**2) / (2 * (0.08**2))))
            effective_calib_rate = calib_rate * att_weight

            if (variance_sum < dynamic_var_thresh) and (att_weight > 0.25):
                self.c = (1 - effective_calib_rate) * self.c + effective_calib_rate * u
                self.d = 0.15
            else:
                self.c = (1 - effective_calib_rate) * self.c + effective_calib_rate * u

            x_err = u - self.c
            if not is_blinking and gaze_speed_y <= self.max_gaze_speed_y:
                for i in range(2):
                    if x_err[i] > self.d:
                        omega[i] = self.kp * (x_err[i] - self.d)
                    elif x_err[i] < -self.d:
                        omega[i] = self.kp * (x_err[i] + self.d)
                omega = np.clip(omega, -self.max_pointer_speed, self.max_pointer_speed)

        self.prev_omega = omega.copy()
        point_x = _clip(0.5 + float(omega[0]) * 0.32, 0.0, 1.0)
        point_y = _clip(0.5 + float(omega[1]) * 0.32, 0.0, 1.0)
        return point_x, point_y, ear


class VisionGazeTracker:
    def __init__(self) -> None:
        self._thread: Thread | None = None
        self._stop_event = Event()
        self._lock = Lock()
        self.status = "STOPPED"
        self.error: str | None = None

    def start(self, camera_index: int, on_sample: Callable[[GazeSample], None]) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self.status = "STARTING"
            self.error = None
            self._thread = Thread(target=self._run, args=(camera_index, on_sample), daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        with self._lock:
            self.status = "STOPPED"

    def _set_error(self, message: str) -> None:
        with self._lock:
            self.status = "ERROR"
            self.error = message

    def _set_status(self, status: str) -> None:
        with self._lock:
            self.status = status

    def _run(self, camera_index: int, on_sample: Callable[[GazeSample], None]) -> None:
        os.environ.setdefault("MPLCONFIGDIR", "/tmp")
        try:
            import cv2
            import mediapipe as mp
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
        except Exception as exc:
            self._set_error(f"Adaptive gaze dependencies import failed: {exc}")
            return

        base_dir = os.path.dirname(__file__)
        repo_root = os.path.abspath(os.path.join(base_dir, "..", "..", ".."))
        gaze_rl_dir = os.path.join(repo_root, "Gaze_control_RL")
        task_path = os.path.join(gaze_rl_dir, "face_landmarker.task")
        if not os.path.exists(task_path):
            task_path = os.path.join(base_dir, "face_landmarker.task")
        model_path = os.path.join(gaze_rl_dir, "residual_gaze_model_v3.zip")
        personalized_model_path = os.path.join(gaze_rl_dir, "residual_gaze_model_v3_personalized.zip")
        if os.path.exists(personalized_model_path):
            model_path = personalized_model_path
        if not os.path.exists(task_path):
            self._set_error(f"Missing FaceLandmarker model: {task_path}")
            return

        landmarker = None
        cap = None
        try:
            base_options = python.BaseOptions(model_asset_path=task_path)
            options = vision.FaceLandmarkerOptions(
                base_options=base_options,
                running_mode=vision.RunningMode.IMAGE,
                num_faces=1,
                min_face_detection_confidence=0.5,
                min_face_presence_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            landmarker = vision.FaceLandmarker.create_from_options(options)
            controller = AdaptiveGazeController(model_path=model_path)

            cap = cv2.VideoCapture(camera_index)
            if not cap.isOpened():
                self._set_error(f"Camera {camera_index} open failed")
                return

            self._set_status("RUNNING")
            while not self._stop_event.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    self._set_error("Camera frame read failed")
                    break

                frame = cv2.flip(frame, 1)
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                result = landmarker.detect(mp_image)

                if not result.face_landmarks:
                    on_sample(GazeSample(x=0.5, y=0.5, ear=0.0, face_detected=False))
                    time.sleep(0.03)
                    continue

                x, y, ear = controller.update(result.face_landmarks[0])
                on_sample(GazeSample(x=x, y=y, ear=ear, face_detected=True))
                time.sleep(0.03)
        except Exception as exc:
            self._set_error(str(exc))
        finally:
            if cap is not None:
                cap.release()
            if landmarker is not None:
                landmarker.close()
            if self.status != "ERROR":
                self._set_status("STOPPED")
