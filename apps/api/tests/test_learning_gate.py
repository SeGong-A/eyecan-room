import asyncio
import json
from unittest.mock import patch

from fastapi import WebSocketDisconnect

from app.learning_gate import RoomLearningGate
from app import main


def test_learning_requires_live_video_and_user_preference():
    gate = RoomLearningGate(requested=True)
    assert not gate.active(10)  # Eye setup cannot train.
    gate.refresh(13, 10)
    assert gate.active(10)
    gate.requested = False
    assert not gate.active(11)
    gate.requested = True
    assert gate.active(12)
    assert not gate.active(13)  # A lost connection expires without another message.
    gate.refresh(12, 20)
    assert not gate.active(20)  # Delayed queue message cannot revive a lease.
    gate.refresh(1000, 20)
    assert not gate.active(23)  # Bound even malformed future expirations.
    assert gate.requested is True  # Visibility never changes saved preference.


class FakeSocket:
    def __init__(self, messages):
        self.messages = iter(messages)

    async def accept(self):
        pass

    async def send_json(self, payload):
        pass

    async def receive_text(self):
        try:
            return next(self.messages)
        except StopIteration:
            raise WebSocketDisconnect()


def test_visibility_messages_and_disconnect_revoke_worker_lease():
    socket = FakeSocket(['bad-json', '[]', json.dumps({'type': 'room_video_visibility', 'visible': True}),
                         json.dumps({'type': 'room_video_visibility', 'visible': False})])
    with patch.object(main.vision_tracker, 'send_control') as send:
        asyncio.run(main.ws_state(socket))
    assert send.call_count == 3
    assert send.call_args_list[0].kwargs['expires_at'] > 0
    assert send.call_args_list[1].kwargs['expires_at'] == 0
    assert send.call_args_list[2].kwargs['expires_at'] == 0
    assert socket not in main.active_websockets
    assert socket not in main.room_video_leases


def test_display_only_window_disconnect_does_not_stop_another_room():
    other_room = object()
    main.room_video_leases[other_room] = 123.0
    try:
        with patch.object(main.vision_tracker, 'send_control') as send:
            asyncio.run(main.ws_state(FakeSocket([])))
        assert send.call_args.kwargs['expires_at'] == 123.0
    finally:
        main.room_video_leases.pop(other_room)
