"""Keep the saved learning preference separate from a live room-video lease."""
from dataclasses import dataclass


ROOM_LEASE_SECONDS = 3.0


@dataclass
class RoomLearningGate:
    requested: bool = True
    visible_until: float = 0.0

    def active(self, now: float) -> bool:
        return self.requested and now < self.visible_until

    def refresh(self, expires_at: float, now: float) -> None:
        # Use the producer's timestamp: a delayed queue message must not revive
        # visibility after a window has disappeared.
        self.visible_until = min(expires_at, now + ROOM_LEASE_SECONDS)
