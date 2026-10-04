#!/usr/bin/env python3
"""Offline mechanical evaluation of the three provenance-tracked NIH demo images."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import resource
import sqlite3
import statistics
import subprocess
import sys
import time
import uuid
from unittest.mock import patch

from inference import MODEL, WEIGHTS_BYTES, classify, image_array

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS_SHA256 = "56524913dd16a906422e8d8b66a7a5c46be1d82eb7ac012d8103776f1aa68899"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def measure(content, repeats):
    import torchxrayvision as xrv
    labels = list(xrv.models.model_urls[MODEL]["labels"])
    assert len(labels) == len(set(labels)) == 18, "Unexpected model label contract"
    runs = []
    for _ in range(repeats):
        started = time.perf_counter()
        # The evaluator must not use a provider, key, or implicit download.
        with patch("socket.socket.connect", side_effect=RuntimeError("Evaluation is offline")):
            output = classify(content)
        elapsed = time.perf_counter() - started
        scores = output["scores"]
        assert len(scores) == 18 and {item["label"] for item in scores} == set(labels), "Label mismatch"
        assert output["classifier"] == MODEL and output["weightsSha256"] == WEIGHTS_SHA256, "Model mismatch"
        mapped = {item["label"]: item["score"] for item in scores}
        ordered = [mapped[label] for label in labels]
        assert all(math.isfinite(value) and 0 <= value <= 1 for value in ordered), "Invalid sigmoid output"
        runs.append({"seconds": round(elapsed, 6), "scoresInModelLabelOrder": ordered,
                     "peakRss": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
    return {"labelOrder": labels, "runs": runs}


def vault_rendition(directory, record):
    if directory is None:
        return None
    directory = directory.resolve()
    database = directory / "vault.sqlite"
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        rows = connection.execute("SELECT body FROM records WHERE kind='document' AND json_extract(body,'$.title')=?", (record["title"],)).fetchall()
    if not rows:
        return None
    assert len(rows) == 1, "Ambiguous demo document title"
    document = json.loads(rows[0][0])
    identifier = str(uuid.UUID(document["id"]))
    folder = directory / "documents" / identifier
    assert not folder.is_symlink() and folder.resolve().parent == (directory / "documents").resolve(), "Invalid document directory"
    original = folder / "input.png"
    assert original.is_file() and not original.is_symlink(), "Missing original demo image"
    assert digest(original.read_bytes()) == record["sha256"], "Vault original does not match NIH manifest"
    if document.get("status") != "ready":
        return {"status": document.get("status"), "available": False}
    redacted = folder / "redacted.png"
    assert redacted.is_file() and not redacted.is_symlink(), "Ready document has no redacted image"
    return {"status": "ready", "available": True, "path": redacted,
            "textCharacters": document.get("processing", {}).get("textCharacters")}


def evaluate_image(content, repeats, environment):
    started = time.perf_counter()
    cold = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--single"], input=content,
                          capture_output=True, timeout=60, check=True, env=environment)
    cold_total = time.perf_counter() - started
    result = json.loads(cold.stdout)
    result["coldProcessSeconds"] = round(cold_total, 6)
    warm = measure(content, repeats)
    assert result["labelOrder"] == warm["labelOrder"], "Cold/warm label ordering differs"
    vectors = [result["runs"][0]["scoresInModelLabelOrder"]] + [run["scoresInModelLabelOrder"] for run in warm["runs"]]
    maximum = max(abs(value - vectors[0][index]) for vector in vectors[1:] for index, value in enumerate(vector))
    assert maximum == 0, "Reported scores were not deterministic"
    return {"cold": result, "sameProcess": warm["runs"], "reportedScoreMaxRepeatDifference": maximum,
            "warmMedianSeconds": round(statistics.median(run["seconds"] for run in warm["runs"][1:]), 6)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "demo" / "nih-manifest.json")
    parser.add_argument("--images", type=Path, default=ROOT / "demo" / "files")
    parser.add_argument("--weights", type=Path, default=Path(__file__).parent / ".weights" / "densenet121-res224-all.pt")
    parser.add_argument("--vault-dir", type=Path, help="Optional explicitly selected synthetic test vault; opened read-only")
    parser.add_argument("--repeats", type=int, default=4)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "evaluation-results.json")
    parser.add_argument("--single", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.single:
        print(json.dumps(measure(sys.stdin.buffer.read(20 * 1024 * 1024 + 1), 1)))
        return
    if not 2 <= args.repeats <= 10:
        parser.error("--repeats must be between 2 and 10")
    weights = args.weights.resolve()
    assert weights.is_file() and weights.stat().st_size == WEIGHTS_BYTES, "Missing official checkpoint"
    assert digest(weights.read_bytes()) == WEIGHTS_SHA256, "Checkpoint hash mismatch"
    os.environ["XRAY_WEIGHTS_PATH"] = str(weights)
    os.environ["XRAY_WEIGHTS_SHA256"] = WEIGHTS_SHA256
    environment = {name: value for name, value in os.environ.items()
                   if name in {"PATH", "HOME", "VIRTUAL_ENV", "DYLD_LIBRARY_PATH", "XRAY_WEIGHTS_PATH", "XRAY_WEIGHTS_SHA256"}}
    environment["PYTHONHASHSEED"] = "0"
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    records = manifest["records"]
    assert len(records) == 3 and len({record["patientId"] for record in records}) == 3, "Expected three distinct demo subjects"
    results = {"classifier": MODEL, "weightsSha256": WEIGHTS_SHA256, "weightsBytes": WEIGHTS_BYTES,
               "manifestSha256": digest(manifest_bytes), "python": sys.version, "platform": platform.platform(),
               "rssUnits": "bytes on macOS; KiB on Linux", "scorePrecision": "six decimal places, as exposed by inference.py",
               "warmMeaning": "Same Python process and warm imports; classify still rebuilds and loads the model for every call.",
               "clinicalValidation": False, "images": []}
    for record in records:
        filename = record["filename"]
        assert Path(filename).name == filename, "Invalid manifest filename"
        source = args.images / filename
        content = source.read_bytes()
        assert len(content) == record["bytes"] and digest(content) == record["sha256"], "NIH image hash/size mismatch"
        original = evaluate_image(content, args.repeats, environment)
        item = {"filename": filename, "datasetLabels": record["labels"], "patientId": record["patientId"],
                "viewPosition": record["viewPosition"], "originalSha256": digest(content), "original": original}
        results.setdefault("labelOrder", original["cold"]["labelOrder"])
        rendition = vault_rendition(args.vault_dir, record)
        if rendition and rendition["available"]:
            redacted_bytes = rendition["path"].read_bytes()
            redacted = evaluate_image(redacted_bytes, args.repeats, environment)
            original_array, redacted_array = image_array(content), image_array(redacted_bytes)
            assert original_array.shape == redacted_array.shape, "Unexpected rendition dimensions"
            before = original["cold"]["runs"][0]["scoresInModelLabelOrder"]
            after = redacted["cold"]["runs"][0]["scoresInModelLabelOrder"]
            item["redacted"] = redacted
            item["renditionComparison"] = {"redactedSha256": digest(redacted_bytes), "textCharacters": rendition["textCharacters"],
                "pixelCount": int(original_array.size), "changedPixelCount": int((original_array != redacted_array).sum()),
                "maximumPixelDifference": float(abs(original_array - redacted_array).max()),
                "scoreDifferencesInLabelOrder": [round(b - a, 6) for a, b in zip(before, after)],
                "maximumScoreDifference": round(max(abs(a - b) for a, b in zip(before, after)), 6)}
        else:
            item["renditionComparison"] = {"available": False, "reason": rendition["status"] if rendition else "not found or no test vault selected"}
        results["images"].append(item)
        print(f"Verified {filename}: 18 finite scores, deterministic repeats; redacted comparison={bool(rendition and rendition['available'])}", flush=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n")
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
