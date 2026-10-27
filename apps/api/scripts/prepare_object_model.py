"""Explicit model provisioning, never invoked by the API at runtime."""
import hashlib
import json
import os
import urllib.request
from pathlib import Path

DEST = Path(__file__).resolve().parents[1] / 'models' / 'objects'
SOURCE = 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt'
EXPECTED_SHA256 = '0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1'


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    target = DEST / 'yolo11n.pt'
    temp = target.with_suffix('.download')
    try:
        urllib.request.urlretrieve(SOURCE, temp)
        digest = hashlib.sha256(temp.read_bytes()).hexdigest()
        if digest != EXPECTED_SHA256:
            raise ValueError('Official model differs from the verified SHA-256; existing model was not replaced')
        os.replace(temp, target)
        manifest = {'file': target.name, 'source': SOURCE, 'release': 'v8.3.0',
                    'sha256': digest, 'validated_tissue_box': False, 'license': 'AGPL-3.0 / Ultralytics Enterprise'}
        manifest_path = DEST / 'manifest.json'
        pending = manifest_path.with_suffix('.tmp')
        pending.write_text(json.dumps(manifest, indent=2) + '\n')
        os.replace(pending, manifest_path)
        print(json.dumps(manifest, indent=2))
    finally:
        temp.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
