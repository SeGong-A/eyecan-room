from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from collections import deque


class BlinkEventType(str, Enum):
    NONE = "NONE"
    SHORT = "SHORT"
    SELECT = "SELECT"
    CANCEL = "CANCEL"


@dataclass
class BlinkThresholds:
    short_min_ms: int = 100
    short_max_ms: int = 250
    select_min_ms: int = 500
    cancel_min_ms: int = 2000


class BlinkStateMachine:
    def __init__(self, thresholds: BlinkThresholds | None = None) -> None:
        self.thresholds = thresholds or BlinkThresholds()
        self._closed_since_ms: int | None = None

    def update(self, *, is_closed: bool, now_ms: int) -> BlinkEventType:
        if is_closed:
            if self._closed_since_ms is None:
                self._closed_since_ms = now_ms
            return BlinkEventType.NONE

        if self._closed_since_ms is None:
            return BlinkEventType.NONE

        duration_ms = now_ms - self._closed_since_ms
        self._closed_since_ms = None

        if duration_ms >= self.thresholds.cancel_min_ms:
            return BlinkEventType.CANCEL
        if duration_ms >= self.thresholds.select_min_ms:
            return BlinkEventType.SELECT
        if self.thresholds.short_min_ms <= duration_ms <= self.thresholds.short_max_ms:
            return BlinkEventType.SHORT
        return BlinkEventType.NONE

    def reset(self) -> None:
        self._closed_since_ms = None


class EmergencyBlinkDetector:
    def __init__(self, required_count: int = 4, window_ms: int = 2000, cooldown_ms: int = 3000) -> None:
        self.required_count = required_count
        self.window_ms = window_ms
        self.cooldown_ms = cooldown_ms
        self._short_blinks: deque[int] = deque()
        self._cooldown_until_ms = 0

    def register(self, event: BlinkEventType, now_ms: int) -> bool:
        if event != BlinkEventType.SHORT:
            if event in (BlinkEventType.SELECT, BlinkEventType.CANCEL):
                self._short_blinks.clear()
            return False
        if now_ms < self._cooldown_until_ms:
            return False
        self._short_blinks.append(now_ms)
        while self._short_blinks and now_ms - self._short_blinks[0] > self.window_ms:
            self._short_blinks.popleft()
        if len(self._short_blinks) < self.required_count:
            return False
        self._short_blinks.clear()
        return True

    def reset(self, now_ms: int = 0, with_cooldown: bool = False) -> None:
        self._short_blinks.clear()
        if with_cooldown:
            self._cooldown_until_ms = now_ms + self.cooldown_ms
