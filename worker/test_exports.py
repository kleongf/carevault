"""Real raster/export verification with injected PII/parser fixtures, NOT model quality tests."""
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from processor import DocumentProcessor, ProcessingError


class FixtureDetector:
    def spans(self, text, profile, known):
        return [(match.start(), match.end()) for match in re.finditer("Alex Morgan", text)]


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.out = self.root / "output"
        self.out.mkdir()
        self.processor = DocumentProcessor()
        self.processor.detector = FixtureDetector()
        self.space = patch("processor.MIN_FREE", 0)
        self.space.start()

    def tearDown(self):
        self.space.stop()
        self.temp.cleanup()

    def test_report_export_is_pixels_only_with_no_source_metadata(self):
        from pypdf import PdfReader
        (self.root / "input.txt").write_text("Alex Morgan\nPatient reports cough.", "utf8")
        result = self.processor.process(dict(mime="text/plain", kind="report", profile="healthcare"), self.root, self.out, [])
        self.assertEqual(result["modes"], ["report"])
        self.assertIn("Alex Morgan", (self.out / "extracted.txt").read_text())
        self.assertNotIn("Alex Morgan", (self.out / "redacted.txt").read_text())
        reader = PdfReader(self.out / "redacted.pdf")
        self.assertEqual("".join(page.extract_text() for page in reader.pages), "")
        self.assertFalse(reader.attachments)
        self.assertNotIn("Alex", str(reader.metadata))
        self.assertNotIn("/Annots", reader.pages[0])
        self.assertTrue(reader.pages[0].images)

    def test_image_redaction_removes_identifier_pixels_and_drops_metadata(self):
        from PIL import Image, ImageDraw, PngImagePlugin
        image = Image.new("RGB", (400, 200), (220, 230, 240))
        ImageDraw.Draw(image).text((20, 20), "Alex Morgan", fill="black")
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("Patient", "Alex Morgan")
        image.save(self.root / "input.png", pnginfo=metadata)
        fake = SimpleNamespace(document=SimpleNamespace(pages={1: SimpleNamespace(size=SimpleNamespace(width=400, height=200))}))
        self.processor._convert = lambda *args, **kwargs: fake
        self.processor._cells = lambda *args, **kwargs: [("Alex Morgan", (20, 20, 120, 35))]
        self.processor.process(dict(mime="image/png", kind="image", profile="identifiers"), self.root, self.out, [])
        with Image.open(self.out / "redacted.png") as result:
            self.assertEqual(result.size, image.size)
            self.assertEqual(result.getpixel((30, 25)), (0, 0, 0))
            self.assertEqual(result.getpixel((300, 150)), image.getpixel((300, 150)))
            self.assertNotIn("Patient", result.info)
        image.close()

    def test_mixed_pdf_uses_ocr_for_bitmap_pages_even_with_native_text(self):
        from reportlab.pdfgen.canvas import Canvas
        canvas = Canvas(str(self.root / "input.pdf"))
        for _ in range(2):
            canvas.drawString(40, 700, "Alex Morgan")
            canvas.showPage()
        canvas.save()
        pages = {index: SimpleNamespace(size=SimpleNamespace(width=595, height=842)) for index in (1, 2)}
        fake = SimpleNamespace(document=SimpleNamespace(pages=pages, pictures=[SimpleNamespace(prov=[SimpleNamespace(page_no=2)])]))
        calls = []
        def convert(path, ocr=False, page=None):
            calls.append((ocr, page))
            return fake
        self.processor._convert = convert
        self.processor._cells = lambda *args, **kwargs: [("Alex Morgan", (40, 132, 120, 148))]
        result = self.processor.process(dict(mime="application/pdf", kind="document", profile="identifiers"), self.root, self.out, [])
        self.assertEqual(calls, [(False, None), (True, 2)])
        self.assertEqual(result["modes"], ["native", "ocr"])
        self.assertEqual(result["pages"], 2)

    def test_phone_photo_uses_the_same_exif_orientation_as_ocr(self):
        from PIL import Image
        image = Image.new("RGB", (400, 200), "white")
        metadata = Image.Exif()
        metadata[274] = 6
        image.save(self.root / "input.jpg", exif=metadata)
        fake = SimpleNamespace(document=SimpleNamespace(pages={1: SimpleNamespace(size=SimpleNamespace(width=200, height=400))}))
        self.processor._convert = lambda *args, **kwargs: fake
        self.processor._cells = lambda *args, **kwargs: [("Alex Morgan", (20, 20, 120, 35))]
        self.processor.process(dict(mime="image/jpeg", kind="image", profile="identifiers"), self.root, self.out, [])
        with Image.open(self.out / "redacted.png") as result:
            self.assertEqual(result.size, (200, 400))
            self.assertEqual(result.getpixel((30, 25)), (0, 0, 0))
            self.assertFalse(result.getexif())
        image.close()

    def test_ocr_reads_raw_cells_even_when_layout_omits_table_text(self):
        box = SimpleNamespace(l=10, t=20, r=100, b=35)
        rectangle = SimpleNamespace(to_bounding_box=lambda: SimpleNamespace(to_top_left_origin=lambda **kwargs: box))
        cell = SimpleNamespace(text="Alex Morgan", rect=rectangle)
        result = SimpleNamespace(document=SimpleNamespace(iterate_items=lambda: []), pages=[
            SimpleNamespace(page_no=1, parsed_page=object(), cells=[cell], size=SimpleNamespace(height=200))])
        self.assertEqual(self.processor._cells(result, 1, ocr=True), [("Alex Morgan", (10, 20, 100, 35))])
        result.pages[0].parsed_page = None
        with self.assertRaisesRegex(ProcessingError, "missing_ocr_coordinates"):
            self.processor._cells(result, 1, ocr=True)

    def test_partial_docling_status_is_rejected(self):
        self.processor._converter = lambda *args: SimpleNamespace(convert=lambda *args, **kwargs: SimpleNamespace(status=SimpleNamespace(value="partial_success"), errors=[]))
        with self.assertRaisesRegex(ProcessingError, "incomplete_conversion"):
            self.processor._convert(self.root / "input.pdf")

    def test_empty_image_extraction_reports_zero_recognized_characters(self):
        from PIL import Image
        with Image.new("RGB", (100, 100), "gray") as image:
            image.save(self.root / "input.png")
        fake = SimpleNamespace(document=SimpleNamespace(pages={1: SimpleNamespace(size=SimpleNamespace(width=100, height=100))}))
        self.processor._convert = lambda *args, **kwargs: fake
        self.processor._cells = lambda *args, **kwargs: []
        result = self.processor.process(dict(mime="image/png", kind="image", profile="identifiers"), self.root, self.out, [])
        self.assertEqual(result["textCharacters"], 0)


if __name__ == "__main__":
    unittest.main()
