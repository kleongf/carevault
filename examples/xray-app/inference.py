"""Real TorchXRayVision inference; receives one image on stdin, JSON on stdout."""
import contextlib
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import warnings

MODEL = "densenet121-res224-all"
WEIGHTS_BYTES = 28_382_008
MAX_IMAGE_BYTES = 20 * 1024 * 1024


def image_array(image_bytes):
    import numpy as np
    from PIL import Image, ImageOps
    if not 0 < len(image_bytes) <= MAX_IMAGE_BYTES:
        raise ValueError("image_size_limit")
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    Image.MAX_IMAGE_PIXELS = 12_000_000
    with Image.open(io.BytesIO(image_bytes)) as image:
        if image.format not in ("PNG", "JPEG") or image.width * image.height > 12_000_000 or getattr(image, "n_frames", 1) != 1:
            raise ValueError("unsupported_image")
        # This model expects 8-bit chest radiographs. Do not silently quantize a
        # high-bit-depth study or accept DICOM as if it were a normal PNG.
        if image.mode not in ("L", "RGB", "RGBA"):
            raise ValueError("unsupported_image_depth")
        normalized = ImageOps.exif_transpose(image)
        array = np.asarray(normalized, dtype=np.float32)
        if array.ndim == 3:
            array = array[:, :, :3].mean(axis=2)
        normalized.close()
    return array


def classify(image_bytes):
    import torch
    import torchxrayvision as xrv

    weights_path = Path(os.environ.get("XRAY_WEIGHTS_PATH", ""))
    expected = os.environ.get("XRAY_WEIGHTS_SHA256", "")
    if not weights_path.is_file() or weights_path.stat().st_size != WEIGHTS_BYTES or len(expected) != 64:
        raise ValueError("weights_not_configured")
    weights = weights_path.read_bytes()
    if hashlib.sha256(weights).hexdigest() != expected.lower():
        raise ValueError("weights_checksum_mismatch")
    array = image_array(image_bytes)
    normalized = xrv.datasets.normalize(array, 255)[None, ...]
    normalized = xrv.datasets.XRayCenterCrop()(normalized)
    normalized = xrv.datasets.XRayResizer(224)(normalized)
    torch.set_num_threads(2)
    model = xrv.models.DenseNet(weights=None, apply_sigmoid=True)
    # Upstream's official checkpoint serializes a module. Only load explicitly
    # provisioned official bytes after a configured SHA256 check; never uploads.
    saved = torch.load(io.BytesIO(weights), map_location="cpu", weights_only=False)
    for module in saved.modules():
        if not hasattr(module, "_non_persistent_buffers_set"):
            module._non_persistent_buffers_set = set()
    model.load_state_dict(saved.state_dict())
    model.eval()
    with torch.inference_mode():
        values = model(torch.from_numpy(normalized).unsqueeze(0)).numpy()[0]
    labels = xrv.models.model_urls[MODEL]["labels"]
    scores = [{"label": label, "score": round(float(score), 6)} for label, score in zip(labels, values)]
    if len(scores) != 18 or any(not math.isfinite(item["score"]) or not 0 <= item["score"] <= 1 for item in scores):
        raise ValueError("invalid_model_output")
    return {"classifier": MODEL, "weightsSha256": expected.lower(), "scores": sorted(scores, key=lambda item: item["score"], reverse=True)}


if __name__ == "__main__":
    try:
        content = sys.stdin.buffer.read(MAX_IMAGE_BYTES + 1)
        with contextlib.redirect_stdout(sys.stderr):
            output = classify(content)
        print(json.dumps(output))
    except Exception:
        # Parent provides a concise error; no patient bytes, secrets or traceback.
        sys.exit(1)
