"""Opt-in real local model/supervisor tests; no parser or detector substitutes."""
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import uuid

from processor import DocumentProcessor, IdentifierDetector, redact_text
from run import Queue, Worker, put, read


@unittest.skipUnless(os.environ.get("CAREVAULT_RUN_MODEL_TESTS") == "1", "Set CAREVAULT_RUN_MODEL_TESTS=1 after local model setup")
class RuntimeTests(unittest.TestCase):
    def test_real_identifier_detection_needs_no_network(self):
        DocumentProcessor()  # Set offline environment before optional HF imports.
        with patch("socket.socket.connect", side_effect=AssertionError("Unexpected runtime network request")):
            detector = IdentifierDetector()
            text = "Patient Alex Morgan. Email alex.morgan@example.test. Cough for two weeks. Visit 2026-10-03."
            result = redact_text(text, detector.spans(text, "healthcare", ["Alex Morgan"]))
        self.assertNotIn("Alex Morgan", result)
        self.assertNotIn("example.test", result)
        self.assertNotIn("2026-10-03", result)
        self.assertIn("two weeks", result)

    def test_real_ocr_is_offline_handles_exif_and_reports_empty_images(self):
        from PIL import Image, ImageDraw, ImageFont
        import reportlab
        processor = DocumentProcessor()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with Image.new("RGB", (600, 300), "white") as image:
                font = ImageFont.truetype(str(Path(reportlab.__file__).parent / "fonts" / "Vera.ttf"), 30)
                ImageDraw.Draw(image).text((30, 40), "Alex Morgan", font=font, fill="black")
                exif = Image.Exif()
                exif[274] = 6
                with image.rotate(90, expand=True) as rotated:
                    rotated.save(root / "input.jpg", exif=exif, quality=95, dpi=(1200, 1200))
            out = root / "exif"
            out.mkdir()
            with patch("socket.socket.connect", side_effect=AssertionError("Unexpected runtime network request")):
                metrics = processor.process(dict(mime="image/jpeg", kind="image", profile="identifiers"), root, out, ["Alex Morgan"])
            self.assertGreater(metrics["textCharacters"], 0)
            self.assertIn("Alex Morgan", (out / "extracted.txt").read_text())
            self.assertNotIn("Alex Morgan", (out / "redacted.txt").read_text())
            self.assertFalse((out / ".ocr-input.png").exists())
            with Image.open(out / "redacted.png") as result:
                self.assertEqual(result.size, (600, 300))
                self.assertEqual(result.getpixel((65, 60)), (0, 0, 0))
                self.assertFalse(result.getexif())
            with Image.new("RGB", (128, 128), "gray") as image:
                image.save(root / "input.png")
            out = root / "blank"
            out.mkdir()
            metrics = processor.process(dict(mime="image/png", kind="image", profile="identifiers"), root, out, [])
            self.assertEqual(metrics["textCharacters"], 0)
            self.assertNotIn("REDACTED", (out / "redacted.txt").read_text())

    def test_real_warm_worker_publishes_report_and_fails_corrupt_input(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            db = sqlite3.connect(directory / "vault.sqlite")
            db.execute("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))")
            db.close()
            queue = Queue(directory)
            worker = Worker(queue)
            try:
                put(queue.db, "memory", "identity", dict(patientId="patient-demo-001", category="identity", value="Alex Morgan"))
                for mime, kind, extension, content in [
                    ("text/plain", "report", "txt", b"Patient Alex Morgan. Cough for two weeks."),
                    ("image/png", "image", "png", b"not a PNG"),
                ]:
                    identifier = str(uuid.uuid4())
                    doc = dict(id=identifier, patientId="patient-demo-001", kind=kind, mime=mime, status="queued", profile="healthcare")
                    put(queue.db, "document", identifier, doc)
                    put(queue.db, "processingJob", identifier, dict(id=identifier, status="queued", attempts=0))
                    record = directory / "documents" / identifier
                    record.mkdir(parents=True)
                    (record / ("input." + extension)).write_bytes(content)
                    worker.once()
                    saved = read(queue.db, "document", identifier)
                    if kind == "report":
                        self.assertEqual(saved["status"], "ready")
                        self.assertIn("Alex Morgan", (record / "extracted.txt").read_text())
                        self.assertNotIn("Alex Morgan", (record / "redacted.txt").read_text())
                        self.assertIn("two weeks", (record / "redacted.txt").read_text())
                        first_pid = worker.child.pid
                    else:
                        self.assertEqual(saved["status"], "failed")
                        self.assertEqual(saved["error"], "processing_failed")
                        self.assertFalse((record / "redacted.png").exists())
                        self.assertEqual(worker.child.pid, first_pid)
                    self.assertFalse(list(record.glob(".processing-*")))
            finally:
                worker.stop()
                queue.close()


if __name__ == "__main__":
    unittest.main()
