"""Independent CPU detector. Only explicitly prepared local models are loaded."""
import hashlib
import io
import json
import time
from pathlib import Path

from PIL import Image, UnidentifiedImageError

MODEL_DIR = Path(__file__).resolve().parents[1] / 'models' / 'objects'
MIN_CONFIDENCE_BY_TYPE = {
    'cup': 0.60,
    'bottle': 0.60,
    'cell_phone': 0.45,
    'tissue_box': 0.60,
}
MODEL_MIN_CONFIDENCE = min(MIN_CONFIDENCE_BY_TYPE.values())


def decode_jpeg(body: bytes):
    try:
        with Image.open(io.BytesIO(body)) as image:
            if image.format != 'JPEG' or max(image.size) > 4096 or min(image.size) < 1:
                raise ValueError('Expected JPEG with dimensions at most 4096px')
            image.load()
            return image.convert('RGB')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError('Invalid JPEG image') from exc


class ObjectDetector:
    def __init__(self, manifest_path=MODEL_DIR / 'manifest.json'):
        self.manifest_path = Path(manifest_path)
        self.status = 'LOADING'
        self.error = None
        self.model_id = None
        self.supported = []
        self.model = None
        self.classes = {}

    def load(self):
        try:
            manifest = json.loads(self.manifest_path.read_text())
            path = self.manifest_path.parent / manifest['file']
            if not path.is_file():
                raise FileNotFoundError('Run scripts/prepare_object_model.py first')
            if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['sha256']:
                raise ValueError('Model SHA-256 mismatch')
            import torch
            from ultralytics import YOLO
            torch.set_num_threads(2)
            self.model = YOLO(str(path), task='detect')
            allowed = {'cup': 'cup', 'bottle': 'bottle', 'cell phone': 'cell_phone'}
            if manifest.get('validated_tissue_box') is True:
                allowed['tissue_box'] = 'tissue_box'
            self.classes = {int(i): allowed[name] for i, name in self.model.names.items() if name in allowed}
            if 'cup' not in self.classes.values():
                raise ValueError('Model must contain cup class')
            self.supported = sorted(set(self.classes.values()))
            self.model_id = f"{manifest['file']}:{manifest['sha256'][:12]}"
            self.status = 'READY'
            self.error = None
        except Exception as exc:
            self.status, self.error = 'ERROR', str(exc)

    def detect(self, image):
        start = time.perf_counter()
        results = self.model.predict(
            image,
            imgsz=640,
            device='cpu',
            classes=list(self.classes),
            conf=MODEL_MIN_CONFIDENCE,
            verbose=False,
        )
        detections = []
        for result in results:
            for box in result.boxes:
                kind = self.classes.get(int(box.cls.item()))
                confidence = float(box.conf.item())
                x1, y1, x2, y2 = [max(0.0, min(1.0, float(v))) for v in box.xyxyn[0].tolist()]
                if kind and confidence >= MIN_CONFIDENCE_BY_TYPE.get(kind, .60) and x2 > x1 and y2 > y1:
                    detections.append({'type': kind, 'confidence': confidence, 'bbox': {
                        'x': x1, 'y': y1, 'width': x2 - x1, 'height': y2 - y1}})
        return detections, (time.perf_counter() - start) * 1000
