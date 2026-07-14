from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class GazeDirection(str, Enum):
    LEFT = "LEFT"
    RIGHT = "RIGHT"
    UP = "UP"
    DOWN = "DOWN"
    CENTER = "CENTER"


@dataclass(frozen=True)
class GazePoint:
    x: float
    y: float


@dataclass
class GazeCalibration:
    center: GazePoint = GazePoint(x=0.5, y=0.5)
    left: GazePoint = GazePoint(x=0.32, y=0.5)
    right: GazePoint = GazePoint(x=0.68, y=0.5)
    up: GazePoint = GazePoint(x=0.5, y=0.32)
    down: GazePoint = GazePoint(x=0.5, y=0.68)


class GazeClassifier:
    def __init__(self, calibration: GazeCalibration | None = None) -> None:
        self.calibration = calibration or GazeCalibration()

    @staticmethod
    def _distance(a: GazePoint, b: GazePoint) -> float:
        return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5

    def classify(self, point: GazePoint) -> GazeDirection:
        candidates = {
            GazeDirection.CENTER: self.calibration.center,
            GazeDirection.LEFT: self.calibration.left,
            GazeDirection.RIGHT: self.calibration.right,
            GazeDirection.UP: self.calibration.up,
            GazeDirection.DOWN: self.calibration.down,
        }

        return min(candidates, key=lambda direction: self._distance(point, candidates[direction]))
