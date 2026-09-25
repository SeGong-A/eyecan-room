from __future__ import annotations

import pathlib
import sys
import unittest


API_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.blink import BlinkEventType, BlinkStateMachine, EmergencyBlinkDetector


class BlinkControlTest(unittest.TestCase):
    def test_four_short_blinks_trigger_emergency_inside_two_seconds(self) -> None:
        detector = EmergencyBlinkDetector()
        results = [detector.register(BlinkEventType.SHORT, timestamp) for timestamp in (100, 500, 900, 1300)]
        self.assertEqual(results, [False, False, False, True])

    def test_three_short_blinks_do_not_trigger_emergency(self) -> None:
        detector = EmergencyBlinkDetector()
        self.assertFalse(any(detector.register(BlinkEventType.SHORT, timestamp) for timestamp in (100, 500, 900)))

    def test_long_close_is_selection_not_short_blink(self) -> None:
        machine = BlinkStateMachine()
        self.assertEqual(machine.update(is_closed=True, now_ms=100), BlinkEventType.NONE)
        self.assertEqual(machine.update(is_closed=False, now_ms=700), BlinkEventType.SELECT)

    def test_cooldown_blocks_immediate_retrigger(self) -> None:
        detector = EmergencyBlinkDetector()
        for timestamp in (100, 400, 700, 1000):
            detector.register(BlinkEventType.SHORT, timestamp)
        detector.reset(1000, with_cooldown=True)
        self.assertFalse(any(detector.register(BlinkEventType.SHORT, timestamp) for timestamp in (1200, 1500, 1800, 2100)))


if __name__ == '__main__':
    unittest.main()
