#!/usr/bin/env python3
"""Explicit one-time setup: fetch only the pinned Docling layout checkpoint."""
import os
from pathlib import Path

from processor import LAYOUT_REVISION


def main():
    root = Path(__file__).resolve().parent / ".models"
    os.environ["HF_HOME"] = str(root / "huggingface")
    os.environ["XDG_CACHE_HOME"] = str(root / "cache")
    os.environ["TORCH_HOME"] = str(root / "torch")
    os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ.pop("TRANSFORMERS_OFFLINE", None)
    from huggingface_hub import snapshot_download
    snapshot = Path(snapshot_download("docling-project/docling-layout-heron", revision=LAYOUT_REVISION,
                                     allow_patterns=["config.json", "preprocessor_config.json", "model.safetensors"],
                                     token=False, max_workers=2))
    artifacts = root / "docling"
    artifacts.mkdir(parents=True, exist_ok=True)
    link = artifacts / "docling-project--docling-layout-heron"
    if link.exists() and link.resolve() != snapshot.resolve():
        raise RuntimeError("An existing layout model differs; preserve it before changing the pinned revision.")
    if not link.exists():
        link.symlink_to(snapshot, target_is_directory=True)
    print(f"Pinned layout model ready: {LAYOUT_REVISION}")


if __name__ == "__main__":
    main()
