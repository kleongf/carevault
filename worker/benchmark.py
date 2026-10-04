#!/usr/bin/env python3
"""Generate fictional fixtures or benchmark real installed processing (no fake fallback)."""
import argparse
import json
from pathlib import Path
import resource
import shutil
import subprocess
import sys
import tempfile
import time

from processor import DocumentProcessor


def fixtures(directory):
    from PIL import Image, ImageDraw, ImageFont
    import pypdfium2 as pdfium
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen.canvas import Canvas
    directory.mkdir(parents=True, exist_ok=True)
    native = directory / "native-one.pdf"
    for name, count in [("native-one.pdf", 1), ("native-five.pdf", 5)]:
        canvas = Canvas(str(directory / name), pagesize=(612, 792))
        for index in range(count):
            for row, line in enumerate(["FICTIONAL CAREVAULT BENCHMARK", "Patient: Alex Morgan", "Email: alex.morgan@example.test",
                                        "Phone: 202-555-0148", "MRN: DEMO-12345", "Visit date: 2026-10-03", "Patient reports cough for two weeks.",
                                        "No known drug allergies reported.", "Measurement            Value       Units", "Temperature            37.0        C"]):
                canvas.drawString(40, 740 - row * 25, line)
            canvas.showPage()
        canvas.save()
    pdf = pdfium.PdfDocument(native)
    page = pdf[0]
    bitmap = page.render(scale=200 / 72)
    image = bitmap.to_pil().copy()
    bitmap.close()
    page.close()
    pdf.close()
    image.save(directory / "scan-one.pdf", "PDF", resolution=200)
    photo = image.rotate(3, expand=True, fillcolor="white")
    photo.save(directory / "photo-rotated.jpg", quality=90)
    photo.close()
    image.close()
    writer = PdfWriter()
    writer.add_page(PdfReader(native).pages[0])
    writer.add_page(PdfReader(directory / "scan-one.pdf").pages[0])
    with (directory / "mixed-two.pdf").open("wb") as output:
        writer.write(output)
    # Deliberately not a clinical image or a purported NIH sample. This validates
    # image-header redaction only; clinical classifier evaluation uses real NIH data.
    image = Image.new("L", (1024, 1024), 80)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=25)
    for row, line in enumerate(["SYNTHETIC NONCLINICAL IMAGE FIXTURE", "Alex Morgan", "MRN: DEMO-12345", "2026-10-03"]):
        draw.text((25, 25 + row * 40), line, fill=240, font=font)
    draw.rectangle((180, 280, 840, 900), fill=130)
    image.save(directory / "image-with-header.png")
    image.close()
    (directory / "ground-truth.json").write_text(json.dumps({"identifiers": ["Alex Morgan", "alex.morgan@example.test", "202-555-0148", "DEMO-12345", "2026-10-03"], "clinical_text": "Patient reports cough for two weeks.", "image": "Synthetic nonclinical image fixture, not NIH data"}, indent=2))


def execute(path, repeats, verification_directory=None):
    suffixes = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg"}
    mime = suffixes[path.suffix]
    processor = DocumentProcessor()
    results = []
    with tempfile.TemporaryDirectory(prefix="carevault-benchmark-") as folder:
        root = Path(folder)
        source = root / ("input" + path.suffix)
        shutil.copyfile(path, source)
        for index in range(repeats):
            output = root / str(index)
            output.mkdir()
            started = time.monotonic()
            metrics = processor.process({"mime": mime, "kind": "image" if mime.startswith("image/") else "document", "profile": "healthcare"}, root, output, ["Alex Morgan", "alex.morgan@example.test", "+1 202-555-0148"])
            metrics.update(wallSeconds=round(time.monotonic() - started, 3), outputBytes=sum(file.stat().st_size for file in output.iterdir()), peakRss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                           identifiersRemaining=[value for value in ["Alex Morgan", "alex.morgan@example.test", "DEMO-12345"] if value in (output / "redacted.txt").read_text()])
            results.append(metrics)
            if index == repeats - 1 and verification_directory is not None:
                from verify_outputs import verify
                saved = verification_directory / path.stem
                saved.mkdir(parents=True, exist_ok=True)
                for file in output.iterdir():
                    shutil.copyfile(file, saved / file.name)
                metrics["quality"] = verify(path, saved)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).parent / "fixtures")
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--single", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "benchmark-results.json")
    args = parser.parse_args()
    if args.generate:
        fixtures(args.fixtures)
        print("Generated six fictional benchmark inputs; no processing models were run.")
        return
    if args.single:
        print(json.dumps(execute(args.single, 1)))
        return
    results = {"python": sys.version, "rssUnits": "bytes on macOS; KiB on Linux", "fixtures": []}
    for path in sorted(args.fixtures.iterdir()):
        if path.suffix not in (".pdf", ".png", ".jpg"):
            continue
        started = time.monotonic()
        cold = subprocess.run([sys.executable, __file__, "--single", str(path.resolve())], capture_output=True, text=True, timeout=200, check=True)
        # Model logs can be printed before metrics. Read only the final JSON line;
        # this benchmark operates on generated fictional fixtures only.
        cold_metrics = json.loads(cold.stdout.strip().splitlines()[-1])[0]
        cold_metrics["processSeconds"] = round(time.monotonic() - started, 3)
        results["fixtures"].append({"name": path.name, "cold": cold_metrics, "sameProcess": execute(path, 4, Path(__file__).parent / "verification-output")})
    args.output.write_text(json.dumps(results, indent=2))
    print(f"Saved benchmark measurements to {args.output}")
    if not all(item["sameProcess"][-1]["quality"]["passed"] for item in results["fixtures"]):
        raise SystemExit("Fixture quality checks failed; inspect the saved measurements and exports.")


if __name__ == "__main__":
    main()
