"""Run separately: uvicorn app.object_api:app --host 127.0.0.1 --port 8001."""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request

from .object_detection import ObjectDetector, decode_jpeg

MAX_BODY = 1024 * 1024


def create_app(detector=None):
    detector = detector or ObjectDetector(**({'manifest_path': os.environ['OBJECT_MODEL_MANIFEST']} if os.getenv('OBJECT_MODEL_MANIFEST') else {}))

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(asyncio.to_thread(detector.load))
        yield
        await task

    app = FastAPI(lifespan=lifespan)
    app.state.busy = False

    @app.get('/objects/health')
    async def health():
        return {'status': detector.status, 'supportedTypes': detector.supported,
                'modelId': detector.model_id, 'error': detector.error}

    @app.post('/objects/detect')
    async def detect(request: Request, session_id: str = Query(min_length=1, max_length=128),
                     frame_id: int = Query(ge=0), captured_at_ms: float = Query(ge=0, allow_inf_nan=False)):
        if detector.status != 'READY':
            raise HTTPException(503, detector.error or 'Model loading')
        if app.state.busy:
            raise HTTPException(429, 'Inference busy')
        app.state.busy = True
        try:
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > MAX_BODY:
                    raise HTTPException(413, 'JPEG exceeds 1MB')
            try:
                image = await asyncio.to_thread(decode_jpeg, bytes(body))
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            # Shield the thread so disconnect/cancellation cannot release the busy
            # slot while native inference is still running.
            task = asyncio.create_task(asyncio.to_thread(detector.detect, image))
            try:
                detections, elapsed = await asyncio.shield(task)
            except asyncio.CancelledError:
                await task
                raise
            except Exception as exc:
                detector.status, detector.error = 'ERROR', str(exc)
                raise HTTPException(503, 'Object inference failed') from exc
            return {'sessionId': session_id, 'frameId': frame_id, 'capturedAtMs': captured_at_ms,
                    'inferenceMs': elapsed, 'detections': detections}
        finally:
            app.state.busy = False

    @app.post('/objects/reload')
    async def reload_model():
        if app.state.busy or detector.status == 'LOADING':
            raise HTTPException(429, 'Detector busy')
        app.state.busy = True
        detector.status = 'LOADING'
        task = asyncio.create_task(asyncio.to_thread(detector.load))
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise
        finally:
            app.state.busy = False
        return await health()

    return app


app = create_app()
