from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from multiprocessing import get_context
from queue import Empty
import os
import platform
from threading import Event, Lock, Thread
import time
import uuid

from .adaptive_gaze import AdaptiveGazeController


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
    error_x: float = 0.0
    error_y: float = 0.0
    deadzone: float = 0.03
    calibration_active: bool = False
    is_blinking: bool = False
    saccade_braking: bool = False
    sample_sequence: int = 0
    tracking_session_id: str = ""


@dataclass(frozen=True)
class GazeModelPaths:
    task_path: str
    model_path: str
    personalized_model_path: str


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


def _face_area(landmarks: list[object]) -> float:
    xs = [landmark.x for landmark in landmarks]
    ys = [landmark.y for landmark in landmarks]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))


def _find_face_camera_index(
    cv2,
    mp,
    landmarker,
    max_index: int = 4,
    warmup_frames: int = 10,
    sample_frames: int = 15,
    min_face_hits: int = 3,
) -> int | None:
    best_index = None
    best_score = (0, 0.0)

    for candidate_index in range(max_index + 1):
        candidate = cv2.VideoCapture(candidate_index)
        if not candidate.isOpened():
            candidate.release()
            continue
        try:
            # UVC and FaceTime cameras often return dark or stale frames just
            # after opening. Discard those frames before judging which camera
            # is the user's gaze camera.
            for _ in range(warmup_frames):
                candidate.read()

            face_hits = 0
            total_area = 0.0
            for _ in range(sample_frames):
                ok, frame = candidate.read()
                if not ok or frame is None:
                    continue
                frame = cv2.flip(frame, 1)
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                result = landmarker.detect(mp_image)
                if not result.face_landmarks:
                    continue
                area = _face_area(result.face_landmarks[0])
                face_hits += 1
                total_area += area

            # Detection persistence is more reliable than a single large
            # false positive from the room camera. Area only breaks ties.
            score = (face_hits, total_area / max(face_hits, 1))
            if face_hits >= min_face_hits and score > best_score:
                best_score = score
                best_index = candidate_index
        finally:
            candidate.release()

    return best_index


def _vision_worker(camera_index: int, tracking_session_id: str, sample_queue, command_queue) -> None:
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
        controller = AdaptiveGazeController(
            base_model_path=model_paths.model_path,
            personalized_model_path=model_paths.personalized_model_path,
        )

        selected_camera_index = camera_index
        if camera_index < 0:
            selected_camera_index = _find_face_camera_index(cv2, mp, landmarker)
            if selected_camera_index is None:
                sample_queue.put({
                    "type": "error",
                    "error": "얼굴이 보이는 카메라를 찾지 못했습니다. 내장 카메라 앞에서 다시 시도해주세요.",
                })
                return

        cap = cv2.VideoCapture(selected_camera_index)
        if not cap.isOpened():
            sample_queue.put({"type": "error", "error": f"Camera {selected_camera_index} open failed"})
            return

        sample_queue.put({"type": "status", "status": "RUNNING"})
        sample_sequence = 0
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
                    elif action == "recenter":
                        controller.recenter()
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
            sample_sequence += 1

            if not result.face_landmarks:
                controller.handle_face_lost()
                sample_queue.put({"type": "sample", "sample": GazeSample(
                    x=0.5,
                    y=0.5,
                    ear=0.0,
                    face_detected=False,
                    sample_sequence=sample_sequence,
                    tracking_session_id=tracking_session_id,
                )})
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
                error_x=output.error_x,
                error_y=output.error_y,
                deadzone=output.deadzone,
                calibration_active=output.calibration_active,
                is_blinking=output.is_blinking,
                saccade_braking=output.saccade_braking,
                sample_sequence=sample_sequence,
                tracking_session_id=tracking_session_id,
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
        self.tracking_session_id = ""

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
            self.tracking_session_id = uuid.uuid4().hex
            context = get_context("spawn")
            sample_queue = context.Queue()
            self._command_queue = context.Queue()
            self._process = context.Process(
                target=_vision_worker,
                args=(camera_index, self.tracking_session_id, sample_queue, self._command_queue),
                daemon=True,
            )
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
