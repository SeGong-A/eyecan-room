"""Real CPU inference on cup/bottle/phone COCO128 images (not a mocked test)."""
import argparse
import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.object_detection import ObjectDetector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('coco128_zip')
    args = parser.parse_args()
    detector = ObjectDetector()
    detector.load()
    if detector.status != 'READY':
        raise RuntimeError(detector.error)
    checked = []
    classes = {'41': 'cup', '39': 'bottle', '67': 'cell_phone'}
    observed = set()
    counts = {kind: 0 for kind in classes.values()}
    with zipfile.ZipFile(args.coco128_zip) as dataset:
        for name in dataset.namelist():
            if '/labels/' not in name or not name.endswith('.txt'):
                continue
            labels = [line.split() for line in dataset.read(name).decode().splitlines()]
            expected = {classes[row[0]] for row in labels if row[0] in classes and float(row[3]) * float(row[4]) >= .01}
            if not expected or all(counts[kind] >= 5 for kind in expected):
                continue
            image_name = name.replace('/labels/', '/images/').replace('.txt', '.jpg')
            image = Image.open(io.BytesIO(dataset.read(image_name))).convert('RGB')
            detections, elapsed = detector.detect(image)
            observed.update(d['type'] for d in detections if d['type'] in expected)
            for kind in expected:
                counts[kind] += 1
            checked.append({'image': image_name, 'expected': sorted(expected), 'inferenceMs': elapsed, 'detections': detections})
    report = {'modelId': detector.model_id, 'supportedTypes': detector.supported, 'observedTypes': sorted(observed),
        'dataset': 'https://github.com/ultralytics/assets/releases/download/v0.0.0/coco128.zip', 'results': checked}
    print(json.dumps(report, indent=2))
    target = Path(__file__).resolve().parents[1] / '.test-artifacts' / 'object-smoke.json'
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + '\n')
    assert set(classes.values()) <= observed, f'Missing real detections: {set(classes.values()) - observed}'


if __name__ == '__main__':
    main()
