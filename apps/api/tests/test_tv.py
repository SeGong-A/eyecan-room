from __future__ import annotations

import asyncio
import unittest

from fastapi import HTTPException

from app.main import TVState, control_tv, state


class TVControlTest(unittest.TestCase):
    def setUp(self) -> None:
        state.tv = TVState()
        state.last_command = "NONE"

    def command(self, value: str) -> dict[str, object]:
        return asyncio.run(control_tv(value))

    def test_channel_wraps_and_volume_is_clamped(self) -> None:
        self.command("CHANNEL_PREV")
        self.assertEqual(state.tv.channel, 3)
        self.command("CHANNEL_NEXT")
        self.assertEqual(state.tv.channel, 1)
        for _ in range(8):
            self.command("VOLUME_UP")
        self.assertEqual(state.tv.volume, 100)
        for _ in range(12):
            self.command("VOLUME_DOWN")
        self.assertEqual(state.tv.volume, 0)
        self.assertTrue(state.tv.mute)

    def test_power_off_rejects_channel_and_volume(self) -> None:
        self.command("POWER_TOGGLE")
        self.assertFalse(state.tv.power)
        for command in ("CHANNEL_NEXT", "VOLUME_UP"):
            with self.assertRaises(HTTPException) as error:
                self.command(command)
            self.assertEqual(error.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
