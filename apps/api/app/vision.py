from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from multiprocessing import get_context
from queue import Empty
import os
import platform
from threading import Event, Lock, Thread
import time

from .adaptive_gaze import AdaptiveGazeController as SharedAdaptiveGazeController


@dataclass(frozen=True)
class GazeSample:
    x: float
    y: float
    ear: float
    face_detected: bool
    omega_x: float = 0.0
    omega_y: float = 0.0
    ready: bool = False
    learning_enabled: bool = True
    learning_update_count: int = 0


@dataclass(frozen=True)
class GazeModelPaths:
    task_path: str
    model_path: str
    personalized_model_path: str


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def resolve_gaze_model_paths() -> GazeModelPaths:
    base_dir = os.path.dirname(__file__)
    repo_root = os.path.abspath(os.path.join(base_dir, "..", "..", ".."))
    gaze_rl_dir = os.path.join(repo_root, "Gaze_control_RL")
    task_path = os.path.join(gaze_rl_dir, "face_landmarker.task")
    model_path = os.path.join(gaze_rl_dir, "residual_gaze_model_v3.zip")
    personalized_model_path = os.path.join(gaze_rl_dir, "residual_gaze_model_v3_personalized.zip")
    return GazeModelPaths(
        task_path=task_path,
        model_path=model_path,
        personalized_model_path=personalized_model_path,
    )


def get_face_landmarker_runtime_error() -> str | None:
    if platform.system() != "Darwin":
        return None

    try:
        mediapipe_version = version("mediapipe")
    except PackageNotFoundError:
        return None

    if mediapipe_version.startswith("1.0.1"):
        return (
            "현재 macOS + mediapipe 1.0.1 조합에서 FaceLandmarker가 Python을 종료시켜 "
            "시선 추적을 시작하지 않았습니다. 호환되는 MediaPipe 런타임으로 변경한 뒤 다시 시도해주세요."
        )

    return None


class _LegacyAdaptiveGazeController:
    """Compatibility reference; the worker uses adaptive_gaze.AdaptiveGazeController."""
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

    def update(self, landmarks: list[object]) -> tuple[float, float, float, float, float]:
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
        # omega는 조이스틱형 팬/틸트 속도 지령(P-제어기 출력)이다. point_x/point_y로
        # 뭉개기 전의 원값을 그대로 같이 반환해 실제 카메라 구동(useGazePanTilt.ts)이
        # 비례 제어에 쓸 수 있게 한다.
        return point_x, point_y, ear, float(omega[0]), float(omega[1])


def _vision_worker(camera_index: int, sample_queue, command_queue) -> None:
    os.environ.setdefault("MPLCONFIGDIR", "/tmp")
    try:
        import cv2
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
    except Exception as exc:
        sample_queue.put({"type": "error", "error": f"Adaptive gaze dependencies import failed: {exc}"})
        return

    model_paths = resolve_gaze_model_paths()
    if not os.path.exists(model_paths.task_path):
        sample_queue.put({"type": "error", "error": f"Missing FaceLandmarker model: {model_paths.task_path}"})
        return

    landmarker = None
    cap = None
    try:
        base_options = python.BaseOptions(
            model_asset_path=model_paths.task_path,
            delegate=python.BaseOptions.Delegate.CPU,
        )
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        landmarker = vision.FaceLandmarker.create_from_options(options)
        controller = SharedAdaptiveGazeController(
            base_model_path=model_paths.model_path,
            personalized_model_path=model_paths.personalized_model_path,
        )

        cap = cv2.VideoCapture(camera_index)
        if not cap.isOpened():
            sample_queue.put({"type": "error", "error": f"Camera {camera_index} open failed"})
            return

        sample_queue.put({"type": "status", "status": "RUNNING"})
        while True:
            try:
                while True:
                    command = command_queue.get_nowait()
                    action = command.get("action")
                    if action == "learning":
                        controller.set_learning(bool(command.get("enabled")))
                    elif action == "save":
                        controller.save()
                    elif action == "reset":
                        controller.reset()
                    elif action == "stop":
                        controller.save()
                        return
                    sample_queue.put({"type": "control", "action": action, "ok": True})
            except Empty:
                pass

            ok, frame = cap.read()
            if not ok or frame is None:
                sample_queue.put({"type": "error", "error": "Camera frame read failed"})
                break

            frame = cv2.flip(frame, 1)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            result = landmarker.detect(mp_image)

            if not result.face_landmarks:
                sample_queue.put({"type": "sample", "sample": GazeSample(x=0.5, y=0.5, ear=0.0, face_detected=False, omega_x=0.0, omega_y=0.0)})
                time.sleep(0.03)
                continue

            output = controller.update(result.face_landmarks[0])
            sample_queue.put({"type": "sample", "sample": GazeSample(
                x=output.point_x,
                y=output.point_y,
                ear=output.ear,
                face_detected=True,
                omega_x=output.omega_x,
                omega_y=output.omega_y,
                ready=output.ready,
                learning_enabled=output.learning_enabled,
                learning_update_count=output.update_count,
            )})
            time.sleep(0.03)
    except Exception as exc:
        sample_queue.put({"type": "error", "error": str(exc)})
    finally:
        if cap is not None:
            cap.release()
        if landmarker is not None:
            landmarker.close()
        sample_queue.put({"type": "status", "status": "STOPPED"})


class VisionGazeTracker:
    def __init__(self) -> None:
        self._thread: Thread | None = None
        self._process = None
        self._stop_event = Event()
        self._lock = Lock()
        self.status = "STOPPED"
        self.error: str | None = None
        self._command_queue = None
        self.last_control_result: dict[str, object] | None = None

    def start(self, camera_index: int, on_sample: Callable[[GazeSample], None]) -> None:
        with self._lock:
            if self._process and self._process.is_alive():
                return

            runtime_error = get_face_landmarker_runtime_error()
            if runtime_error:
                self.status = "ERROR"
                self.error = runtime_error
                on_sample(GazeSample(x=0.5, y=0.5, ear=0.0, face_detected=False))
                return

            self._stop_event.clear()
            self.status = "STARTING"
            self.error = None
            context = get_context("spawn")
            sample_queue = context.Queue()
            self._command_queue = context.Queue()
            self._process = context.Process(target=_vision_worker, args=(camera_index, sample_queue, self._command_queue), daemon=True)
            self._process.start()
            self._thread = Thread(target=self._monitor_worker, args=(sample_queue, on_sample), daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        process = self._process
        if process and process.is_alive():
            self.send_control("stop")
            process.join(timeout=3)
            if process.is_alive():
                process.terminate()
                process.join(timeout=1)
        with self._lock:
            self.status = "STOPPED"

    def send_control(self, action: str, **payload: object) -> bool:
        if not self._process or not self._process.is_alive() or self._command_queue is None:
            return False
        self._command_queue.put({"action": action, **payload})
        return True

    def _set_error(self, message: str) -> None:
        with self._lock:
            self.status = "ERROR"
            self.error = message

    def _set_status(self, status: str) -> None:
        with self._lock:
            self.status = status

    def _monitor_worker(self, sample_queue, on_sample: Callable[[GazeSample], None]) -> None:
        while not self._stop_event.is_set():
            process = self._process
            try:
                message = sample_queue.get(timeout=0.2)
            except Empty:
                if process and not process.is_alive():
                    if process.exitcode not in (0, None) and self.status != "ERROR":
                        self._set_error(f"Vision worker exited unexpectedly with code {process.exitcode}")
                        on_sample(GazeSample(x=0.5, y=0.5, ear=0.0, face_detected=False))
                    break
                continue

            message_type = message.get("type")
            if message_type == "sample":
                on_sample(message["sample"])
            elif message_type == "status":
                if self.status != "ERROR":
                    self._set_status(message["status"])
                    on_sample(GazeSample(x=0.5, y=0.5, ear=0.0, face_detected=False))
            elif message_type == "error":
                self._set_error(message["error"])
                on_sample(GazeSample(x=0.5, y=0.5, ear=0.0, face_detected=False))
                break
            elif message_type == "control":
                self.last_control_result = message

        if self.status != "ERROR":
            self._set_status("STOPPED")
