# Object model provisioning

Run `../../scripts/prepare_object_model.py` with the isolated detector Python environment.
The default file is the official Ultralytics YOLO11n release v8.3.0. Its source and
SHA-256 are recorded in manifest.json. Weights are ignored by git; the manifest is
versioned. Runtime verifies the SHA before importing the model. No camera is opened.

The model uses COCO `cup`, `bottle`, and `cell phone`, looked up by name, not a
hardcoded class ID. The API maps `cell phone` to `cell_phone`. These are generic
object categories: the model cannot verify that cups or bottles contain water.
Tissue is
disabled until a custom model containing both `cup` and `tissue_box` has been
validated. A custom manifest has the same file/source/release/sha256 fields and
`validated_tissue_box: true`. Point `OBJECT_MODEL_MANIFEST` to its absolute path.
Do not mark an untested model validated. Preserve the original default weights.

P1 validation: annotate actual deployment photos; split by capture session rather
than adjacent frames; test cups and tissue boxes on held-out lighting/placement
conditions. Record precision/recall and cup regressions before enabling tissue.
No dataset or tissue-trained weights have been supplied with this implementation.

Ultralytics weights/software: AGPL-3.0 or an appropriate Enterprise license.
Review redistribution/commercial obligations before deployment.
