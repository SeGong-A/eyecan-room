from __future__ import annotations

from collections import deque
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np


API_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.adaptive_gaze import AdaptiveGazeController


class FakeTrainer:
    update_count = 0

    def __init__(self) -> None:
        self.stored: list[tuple] = []

    def sample_action(self, obs, deterministic: bool):
        return np.zeros(4, dtype=np.float32), 0.0, 0.0

    def store(self, *transition) -> None:
        self.stored.append(transition)

    def reset(self) -> None:
        self.stored.clear()


def make_controller(samples: list[tuple[tuple[float, float], float]]) -> AdaptiveGazeController:
    controller = AdaptiveGazeController.__new__(AdaptiveGazeController)
    controller.np = np
    controller.trainer = FakeTrainer()
    controller.learning_enabled = True
    controller.c = np.zeros(2, dtype=np.float32)
    controller.initial_calib_done = False
    controller.base_d = 0.03
    controller.base_kp = 1.0
    controller.d = controller.base_d
    controller.kp = controller.base_kp
    controller.u_filtered = np.zeros(2, dtype=np.float32)
    controller.obs_buffer = deque(maxlen=15)
    controller.prev_u = np.zeros(2, dtype=np.float32)
    controller.prev_v = np.zeros(2, dtype=np.float32)
    controller.prev_omega = np.zeros(2, dtype=np.float32)
    controller.zero_crossings = 0.0
    controller.last_time = 0.0
    queued = list(samples)

    def get_iris_center(self, _landmarks):
        point, ear = queued.pop(0)
        return np.asarray(point, dtype=np.float32), ear

    controller.get_iris_center = types.MethodType(get_iris_center, controller)
    return controller


class AdaptiveGazeControllerTest(unittest.TestCase):
    def test_initial_zero_uses_fifteen_open_eye_samples(self) -> None:
        samples = [((0.1, -0.05), 0.3)] * 10 + [((9.0, 9.0), 0.1)] * 4 + [((0.1, -0.05), 0.3)] * 5
        controller = make_controller(samples)
        with patch('app.adaptive_gaze.time.time', side_effect=[index / 30 for index in range(1, 20)]):
            outputs = [controller.update(None) for _ in range(19)]

        self.assertFalse(outputs[17].ready)
        self.assertTrue(outputs[18].ready)
        np.testing.assert_allclose(controller.c, controller.u_filtered, atol=1e-7)
        self.assertEqual(len(controller.obs_buffer), 15)

    def test_reference_ema_deadzone_and_proportional_output(self) -> None:
        samples = [((0.0, 0.0), 0.3)] * 15 + [((0.4, 0.0), 0.3)]
        controller = make_controller(samples)
        with patch('app.adaptive_gaze.time.time', side_effect=[index / 30 for index in range(1, 17)]):
            outputs = [controller.update(None) for _ in range(16)]

        moving = outputs[-1]
        filtered_x = 0.6 * 0.4
        attention = np.exp(-(filtered_x**2) / (2 * 0.08**2))
        expected_error = filtered_x - (0.08 * attention * filtered_x)
        self.assertAlmostEqual(moving.error_x, expected_error, places=6)
        self.assertAlmostEqual(moving.deadzone, 0.03, places=5)
        self.assertAlmostEqual(moving.omega_x, expected_error - 0.03, places=6)
        self.assertAlmostEqual(moving.omega_y, 0.0, places=5)
        self.assertFalse(moving.calibration_active)

    def test_fast_vertical_change_brakes_motor(self) -> None:
        samples = [((0.0, 0.0), 0.3)] * 15 + [((0.0, 0.5), 0.3)]
        controller = make_controller(samples)
        with patch('app.adaptive_gaze.time.time', side_effect=[index / 30 for index in range(1, 17)]):
            outputs = [controller.update(None) for _ in range(16)]

        self.assertTrue(outputs[-1].saccade_braking)
        self.assertEqual(outputs[-1].omega_x, 0.0)
        self.assertEqual(outputs[-1].omega_y, 0.0)

    def test_face_loss_preserves_zero_and_clears_temporal_state(self) -> None:
        controller = make_controller([((0.1, 0.2), 0.3)] * 15)
        with patch('app.adaptive_gaze.time.time', side_effect=[index / 30 for index in range(1, 16)]):
            for _ in range(15):
                controller.update(None)
        zero = controller.c.copy()

        with patch('app.adaptive_gaze.time.time', return_value=10.0):
            controller.handle_face_lost()

        np.testing.assert_allclose(controller.c, zero)
        self.assertEqual(len(controller.obs_buffer), 0)
        np.testing.assert_array_equal(controller.prev_omega, np.zeros(2))


if __name__ == '__main__':
    unittest.main()
