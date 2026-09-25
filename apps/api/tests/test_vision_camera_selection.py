from __future__ import annotations

from dataclasses import dataclass
import pathlib
import sys
import unittest


API_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.vision import _find_face_camera_index


@dataclass
class FakeLandmark:
    x: float
    y: float


class FakeCapture:
    def __init__(self, index: int) -> None:
        self.index = index
        self.read_count = 0

    def isOpened(self) -> bool:
        return True

    def read(self):
        self.read_count += 1
        return True, (self.index, self.read_count)

    def release(self) -> None:
        return None


class FakeCv2:
    COLOR_BGR2RGB = 1

    @staticmethod
    def VideoCapture(index: int) -> FakeCapture:
        return FakeCapture(index)

    @staticmethod
    def flip(frame, _axis: int):
        return frame

    @staticmethod
    def cvtColor(frame, _conversion: int):
        return frame


class FakeMp:
    class ImageFormat:
        SRGB = 1

    @staticmethod
    def Image(*, image_format: int, data):
        del image_format
        return data


class FakeResult:
    def __init__(self, has_face: bool) -> None:
        self.face_landmarks = [[FakeLandmark(0.0, 0.0), FakeLandmark(1.0, 1.0)]] if has_face else []


class FakeLandmarker:
    def detect(self, frame) -> FakeResult:
        camera_index, read_count = frame
        if camera_index == 0:
            return FakeResult(read_count == 3)
        return FakeResult(read_count >= 3)


class CameraSelectionTest(unittest.TestCase):
    def test_prefers_persistent_face_detection_over_single_false_positive(self) -> None:
        selected = _find_face_camera_index(
            FakeCv2,
            FakeMp,
            FakeLandmarker(),
            max_index=1,
            warmup_frames=2,
            sample_frames=5,
            min_face_hits=2,
        )

        self.assertEqual(selected, 1)


if __name__ == '__main__':
    unittest.main()
