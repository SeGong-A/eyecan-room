from __future__ import annotations

from queue import Queue
from threading import Thread
import unittest

from app.vision import VisionGazeTracker


class AliveProcess:
    def is_alive(self) -> bool:
        return True


class VisionControlTest(unittest.TestCase):
    def test_control_waits_for_matching_worker_result(self) -> None:
        tracker = VisionGazeTracker()
        tracker._process = AliveProcess()
        tracker._command_queue = Queue()
        result: list[dict[str, object] | None] = []

        thread = Thread(target=lambda: result.append(
            tracker.send_control_and_wait("learning", timeout=1.0, enabled=False)
        ))
        thread.start()
        command = tracker._command_queue.get(timeout=1.0)
        request_id = command["request_id"]
        response = {"type": "control", "request_id": request_id, "action": "learning", "ok": True}
        with tracker._lock:
            tracker._control_results[request_id] = response
            waiter = tracker._control_waiters[request_id]
        waiter.set()
        thread.join(timeout=1.0)

        self.assertFalse(thread.is_alive())
        self.assertEqual(result, [response])
        self.assertFalse(command["enabled"])

    def test_control_timeout_reports_failure(self) -> None:
        tracker = VisionGazeTracker()
        tracker._process = AliveProcess()
        tracker._command_queue = Queue()
        result = tracker.send_control_and_wait("learning", timeout=0.01, enabled=True)
        self.assertEqual(result["ok"], False)
        self.assertIn("timeout", str(result["error"]).lower())


if __name__ == "__main__":
    unittest.main()
