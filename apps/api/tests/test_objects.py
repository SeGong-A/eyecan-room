import asyncio
import hashlib
import io
import json
import sys
import threading
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from apps.api.app.object_api import create_app
from apps.api.app.object_detection import ObjectDetector, decode_jpeg


def jpeg():
    stream = io.BytesIO()
    Image.new('RGB', (64, 48)).save(stream, format='JPEG')
    return stream.getvalue()


def detector():
    d = Mock(status='READY', error=None, supported=['cup'], model_id='test')
    d.detect.return_value = ([{'type': 'cup', 'confidence': .9, 'bbox': {'x': .1, 'y': .2, 'width': .3, 'height': .4}}], 12)
    return d


QUERY = '?session_id=s1&frame_id=2&captured_at_ms=123.5'


def test_jpeg_and_echo():
    with TestClient(create_app(detector())) as client:
        assert client.get('/objects/health').json()['supportedTypes'] == ['cup']
        r = client.post('/objects/detect' + QUERY, content=jpeg())
        assert r.status_code == 200
        assert r.json()['capturedAtMs'] == 123.5
        assert r.json()['sessionId'] == 's1'
        assert r.json()['detections'][0]['type'] == 'cup'


@pytest.mark.parametrize('body, status', [(b'broken', 422), (b'X' * (1024 * 1024 + 1), 413)])
def test_invalid_body(body, status):
    with TestClient(create_app(detector())) as client:
        assert client.post('/objects/detect' + QUERY, content=body).status_code == status


def test_non_jpeg():
    data = io.BytesIO()
    Image.new('RGB', (10, 10)).save(data, format='PNG')
    with pytest.raises(ValueError):
        decode_jpeg(data.getvalue())


def test_missing_model(tmp_path):
    d = ObjectDetector(tmp_path / 'missing.json')
    d.load()
    assert d.status == 'ERROR'
    assert d.supported == []
    with TestClient(create_app(d)) as client:
        assert client.post('/objects/detect' + QUERY, content=jpeg()).status_code == 503


def test_inference_failure_isolated():
    d = detector()
    d.detect.side_effect = RuntimeError('native failure')
    with TestClient(create_app(d)) as client:
        assert client.post('/objects/detect' + QUERY, content=jpeg()).status_code == 503
        assert client.get('/objects/health').json()['status'] == 'ERROR'


def test_no_inference_queue():
    d = detector()
    entered, release = threading.Event(), threading.Event()
    def predict(_):
        entered.set()
        assert release.wait(5)
        return [], 1
    d.detect.side_effect = predict
    async def run():
        transport = httpx.ASGITransport(app=create_app(d))
        async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
            first = asyncio.create_task(client.post('/objects/detect' + QUERY, content=jpeg()))
            await asyncio.to_thread(entered.wait, 2)
            try:
                second = await client.post('/objects/detect' + QUERY, content=jpeg())
                assert second.status_code == 429
                assert (await client.get('/objects/health')).status_code == 200
            finally:
                release.set()
            assert (await first).status_code == 200
    asyncio.run(run())


def test_class_filter_and_normalized_boxes():
    def tensor(value):
        return Mock(item=lambda: value)
    def box(cls, confidence, coords):
        b = Mock(cls=tensor(cls), conf=tensor(confidence))
        b.xyxyn = [Mock(tolist=lambda: coords)]
        return b
    d = ObjectDetector()
    d.classes = {41: 'cup', 39: 'bottle', 67: 'cell_phone'}
    d.model = Mock()
    d.model.predict.return_value = [Mock(boxes=[box(41, .9, [-.1, .2, .6, 1.1]), box(0, .9, [0, 0, 1, 1]), box(41, .5, [0, 0, 1, 1]),
        box(39, .8, [.1, .1, .4, .8]), box(39, .59, [.1, .1, .4, .8]),
        box(67, .45, [.5, .2, .8, .8]), box(67, .44, [.5, .2, .8, .8])])]
    result, _ = d.detect(Image.new('RGB', (100, 100)))
    assert [d['type'] for d in result] == ['cup', 'bottle', 'cell_phone']
    assert result[0]['bbox'] == {'x': 0.0, 'y': .2, 'width': .6, 'height': .8}
    assert d.model.predict.call_args.kwargs['classes'] == [41, 39, 67]
    assert d.model.predict.call_args.kwargs['conf'] == .45


@pytest.mark.parametrize('validated_tissue', [False, True])
def test_load_maps_model_names_without_assuming_class_ids(tmp_path, monkeypatch, validated_tissue):
    weights = b'test model'
    (tmp_path / 'test.pt').write_bytes(weights)
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps({'file': 'test.pt', 'sha256': hashlib.sha256(weights).hexdigest(),
        'validated_tissue_box': validated_tissue}))
    model = Mock()
    model.names = {1: 'cup', 3: 'bottle', 5: 'cell phone', 7: 'tissue_box', 9: 'person'}
    monkeypatch.setitem(sys.modules, 'torch', Mock())
    monkeypatch.setitem(sys.modules, 'ultralytics', Mock(YOLO=Mock(return_value=model)))
    d = ObjectDetector(manifest)
    d.load()
    assert d.status == 'READY'
    assert d.classes == {1: 'cup', 3: 'bottle', 5: 'cell_phone', **({7: 'tissue_box'} if validated_tissue else {})}
    with TestClient(create_app(d)) as client:
        assert client.get('/objects/health').json()['supportedTypes'] == sorted(d.classes.values())
