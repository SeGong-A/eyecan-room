from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


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
    cancel_min_ms: int = 1500


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
