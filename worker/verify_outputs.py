"""Independent checks for the six fictional benchmark fixtures, not clinical validation."""
import csv
import io
from pathlib import Path
import re
import subprocess
import tempfile


IDENTIFIERS = ["Alex Morgan", "alex.morgan@example.test", "202-555-0148", "DEMO-12345", "2026-10-03"]


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def pages(path):
    from PIL import Image, ImageOps
    if path.suffix == ".pdf":
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(path)
        try:
            for index in range(len(pdf)):
                page = pdf[index]
                bitmap = page.render(scale=200 / 72)
                try:
                    yield bitmap.to_pil().convert("RGB")
                finally:
                    bitmap.close()
                    page.close()
        finally:
            pdf.close()
    else:
        with Image.open(path) as image:
            yield ImageOps.exif_transpose(image).convert("RGB")


def ocr(image, directory, name):
    path = directory / (name + ".png")
    image.save(path)
    result = subprocess.run(["tesseract", str(path), "stdout", "--psm", "6", "tsv"],
                            capture_output=True, text=True, check=True, timeout=30)
    return [row for row in csv.DictReader(io.StringIO(result.stdout), delimiter="\t") if row["text"].strip()]


def verify(source, output):
    from PIL import ImageStat
    from pypdf import PdfReader
    expected = IDENTIFIERS if source.name != "image-with-header.png" else [IDENTIFIERS[index] for index in (0, 3, 4)]
    extracted = normalized((output / "extracted.txt").read_text())
    redacted = normalized((output / "redacted.txt").read_text())
    result = {
        "missingExtractedIdentifiers": [value for value in expected if normalized(value) not in extracted],
        "identifiersRemainingInText": [value for value in expected if normalized(value) in redacted],
        "missingClinicalText": [], "pixelChecks": [], "identifiersRemainingInExportOcr": [],
    }
    if source.name != "image-with-header.png":
        for value in ["Patient reports cough for two weeks", "No known drug allergies reported", "37.0"]:
            if normalized(value) not in extracted or normalized(value) not in redacted:
                result["missingClinicalText"].append(value)
    export = output / ("redacted.pdf" if source.suffix == ".pdf" else "redacted.png")
    if export.suffix == ".pdf":
        reader = PdfReader(export)
        result["pageCountsMatch"] = len(reader.pages) == len(PdfReader(source).pages)
        result["pixelsOnlyPdf"] = not any(page.extract_text() or "/Annots" in page for page in reader.pages) and not reader.attachments
    with tempfile.TemporaryDirectory(prefix="carevault-quality-") as folder:
        for number, (original, hidden) in enumerate(zip(pages(source), pages(export)), start=1):
            try:
                rows = ocr(original, Path(folder), "original")
                hidden_rows = ocr(hidden, Path(folder), "hidden")
                hidden_text = normalized(" ".join(row["text"] for row in hidden_rows))
                result["identifiersRemainingInExportOcr"].extend(value for value in expected if normalized(value) in hidden_text)
                for value in expected:
                    found = []
                    target = normalized(value)
                    for start in range(len(rows)):
                        text = ""
                        for end in range(start, min(start + 8, len(rows))):
                            text += normalized(rows[end]["text"])
                            if text == target:
                                found = rows[start:end + 1]
                                break
                            if len(text) >= len(target):
                                break
                        if found:
                            break
                    ratios = []
                    for row in found:
                        x, y, width, height = (int(row[key]) for key in ("left", "top", "width", "height"))
                        crop = hidden.crop((x, y, x + width, y + height)).convert("L")
                        black = crop.point(lambda pixel: 255 if pixel < 15 else 0)
                        ratios.append(round(ImageStat.Stat(black).mean[0] / 255, 5))
                        black.close()
                        crop.close()
                    result["pixelChecks"].append({"page": number, "identifier": value,
                                                  "sourceOcrLocated": bool(found), "minimumBlackFraction": min(ratios, default=0)})
            finally:
                original.close()
                hidden.close()
    result["passed"] = not any(result[key] for key in ["missingExtractedIdentifiers", "identifiersRemainingInText", "missingClinicalText", "identifiersRemainingInExportOcr"])
    result["passed"] &= result.get("pageCountsMatch", True) and result.get("pixelsOnlyPdf", True) and all(check["sourceOcrLocated"] and check["minimumBlackFraction"] >= 0.985 for check in result["pixelChecks"])
    return result
