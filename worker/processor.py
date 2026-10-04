"""Local document conversion. Automatic detection is not a de-identification guarantee."""
from __future__ import annotations

import math
import os
from pathlib import Path
import re
import shutil
import time
import warnings

MAX_PAGES = 30
MAX_PIXELS = 12_000_000
MAX_TOTAL_PIXELS = 100_000_000
MAX_TEXT = 1_000_000
MAX_OUTPUT = 100 * 1024 * 1024
MIN_FREE = 256 * 1024 * 1024
EXTENSIONS = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "text/plain": "txt"}
LAYOUT_REVISION = "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8"


class ProcessingError(Exception):
    """Public error code; never store parser exceptions or document content in logs."""


def merge_spans(spans):
    merged = []
    for start, end in sorted(spans):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def redact_text(text, spans):
    pieces, cursor = [], 0
    for start, end in merge_spans(spans):
        pieces.extend((text[cursor:start], "[REDACTED]"))
        cursor = end
    pieces.append(text[cursor:])
    return "".join(pieces)


class IdentifierDetector:
    def __init__(self):
        # Check the explicit small model before constructing Presidio: do not let
        # its default engine silently fetch a large language model at runtime.
        import importlib.util
        if importlib.util.find_spec("en_core_web_sm") is None:
            raise ProcessingError("nlp_model_missing")
        from presidio_analyzer import AnalyzerEngine, PatternRecognizer
        from presidio_analyzer.predefined_recognizers import EmailRecognizer
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        engine = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }).create_engine()
        self.analyzer = AnalyzerEngine(nlp_engine=engine, supported_languages=["en"])
        # Presidio's default email validator refreshes the Public Suffix List
        # over the network. Pattern matching also protects private/.test domains
        # and avoids that runtime network call entirely.
        self.analyzer.registry.remove_recognizer("EmailRecognizer")
        self.analyzer.registry.add_recognizer(PatternRecognizer(
            supported_entity="EMAIL_ADDRESS", patterns=EmailRecognizer.PATTERNS,
            context=["email"], name="OfflineEmailRecognizer"))

    def spans(self, text, profile, known):
        entities = ["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "US_SSN", "US_DRIVER_LICENSE",
                    "US_PASSPORT", "CREDIT_CARD", "IP_ADDRESS", "URL", "IBAN_CODE", "LOCATION"]
        if profile == "healthcare":
            entities.append("DATE_TIME")
        hits = self.analyzer.analyze(text=text, language="en", entities=entities, score_threshold=0.35)
        # A symptom duration is clinical context, not a calendar date. Presidio
        # labels both DATE_TIME; retain durations while removing actual dates.
        duration = r"(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|a|an)\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)[.,]?"
        spans = [(hit.start, hit.end) for hit in hits
                 if hit.entity_type != "DATE_TIME" or not re.fullmatch(duration, text[hit.start:hit.end], re.I)]
        # Explicit identifiers supplement statistical recognition, including demo
        # .test addresses and medical record numbers often missed by generic NER.
        patterns = [r"[\w+-]+(?:\s*\.\s*[\w+-]+)*\s*@\s*[\w-]+(?:\s*\.\s*[\w-]+)+", r"\b\d{3}-\d{2}-\d{4}\b",
                    r"(?i)\b(?:MRN|medical\s+record|patient\s+ID|member\s+ID)\s*[:#]?\s*[A-Z0-9-]{3,}",
                    r"(?<!\w)(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)"]
        if profile == "healthcare":
            patterns += [r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", r"\b\d{4}-\d{2}-\d{2}\b"]
        for value in known:
            if 3 <= len(value) <= 300:
                patterns.append(r"(?i)(?<!\w)" + r"\s+".join(re.escape(word) for word in value.split()) + r"(?!\w)")
        for pattern in patterns:
            spans.extend((match.start(), match.end()) for match in re.finditer(pattern, text))
        return merge_spans(spans)


class DocumentProcessor:
    """Retain converters/detector for the life of the supervised child process."""
    def __init__(self):
        cache = Path(__file__).resolve().parent / ".models"
        for name, value in {"HF_HOME": cache / "huggingface", "TORCH_HOME": cache / "torch", "XDG_CACHE_HOME": cache / "cache"}.items():
            os.environ.setdefault(name, str(value))
        # Presidio imports optional Transformers support; set offline flags
        # before either library can cache Hugging Face environment settings.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        self.native = None
        self.ocr = None
        self.detector = None

    def _converter(self, ocr=False):
        # Set before importing HF/Docling: hub constants may be cached on import.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        from docling.document_converter import DocumentConverter, NativePdfFormatOption, PdfFormatOption, ImageFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import NativePdfPipelineOptions, PdfPipelineOptions, TesseractCliOcrOptions, OcrMode
        from docling_core.types.doc.page import TextCellUnit
        if not ocr:
            if self.native is None:
                options = NativePdfPipelineOptions(text_cell_unit=TextCellUnit.WORD, parser_threads=2,
                                                   generate_page_images=False, document_timeout=90)
                self.native = DocumentConverter(allowed_formats=[InputFormat.PDF], format_options={InputFormat.PDF: NativePdfFormatOption(pipeline_options=options)})
            return self.native
        if self.ocr is None:
            command = shutil.which("tesseract")
            if not command:
                raise ProcessingError("tesseract_missing")
            artifacts = Path(__file__).resolve().parent / ".models" / "docling"
            model_directory = artifacts / "docling-project--docling-layout-heron"
            if not all((model_directory / name).is_file() for name in ("config.json", "preprocessor_config.json", "model.safetensors")):
                raise ProcessingError("layout_model_missing")
            options = PdfPipelineOptions(do_ocr=True, do_table_structure=False,
                                         do_picture_classification=False, do_picture_description=False,
                                         do_code_enrichment=False, do_formula_enrichment=False,
                                         enable_remote_services=False, generate_page_images=False, generate_parsed_pages=True,
                                         artifacts_path=artifacts,
                                         document_timeout=90,
                                         ocr_options=TesseractCliOcrOptions(lang=["eng"], tesseract_cmd=command, mode=OcrMode.FULL_PAGE, scale=200 / 72))
            options.layout_options.model_spec = options.layout_options.model_spec.model_copy(update={"revision": LAYOUT_REVISION})
            # Suppress automatic Hugging Face network access. Model installation
            # is an explicit setup step after storage has been checked.
            os.environ["HF_HUB_OFFLINE"] = "1"
            image_options = options.model_copy(deep=True)
            # Image coordinates are pixels, whereas PDF coordinates are points.
            # Upscaling a photograph 3x wastes memory and can reduce OCR accuracy.
            image_options.ocr_options.scale = 1
            self.ocr = DocumentConverter(allowed_formats=[InputFormat.PDF, InputFormat.IMAGE], format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=options),
                InputFormat.IMAGE: ImageFormatOption(pipeline_options=image_options),
            })
        return self.ocr

    def _convert(self, path, ocr=False, page=None):
        converter = self._converter(ocr)
        # Re-encoding an already pixel-limited JPEG as a private lossless PNG
        # can exceed the original upload's compressed size.
        size_limit = MAX_OUTPUT if path.name == ".ocr-input.png" else 20 * 1024 * 1024
        kwargs = {"max_num_pages": MAX_PAGES, "max_file_size": size_limit}
        if page is not None:
            kwargs["page_range"] = (page, page)
        result = converter.convert(path, **kwargs)
        status = getattr(result.status, "value", str(result.status))
        if status != "success" or result.errors:
            raise ProcessingError("incomplete_conversion")
        return result

    @staticmethod
    def _cells(result, page, ocr=False):
        cells = []
        if ocr:
            # Layout assembly can omit table/form text when table structure is
            # disabled. Redaction must inspect the retained OCR cells themselves.
            parsed = next((item for item in result.pages if item.page_no == page), None)
            if parsed is None or parsed.parsed_page is None:
                raise ProcessingError("missing_ocr_coordinates")
            for cell in parsed.cells:
                if cell.text:
                    box = cell.rect.to_bounding_box().to_top_left_origin(page_height=parsed.size.height)
                    values = (box.l, box.t, box.r, box.b)
                    if not all(math.isfinite(value) for value in values):
                        raise ProcessingError("invalid_coordinates")
                    cells.append((cell.text, values))
            return cells
        document = result.document
        for item, _level in document.iterate_items():
            text = getattr(item, "text", "")
            if not text:
                continue
            for provenance in item.prov:
                if provenance.page_no == page:
                    height = document.pages[page].size.height
                    box = provenance.bbox.to_top_left_origin(page_height=height)
                    values = (box.l, box.t, box.r, box.b)
                    if not all(math.isfinite(value) for value in values):
                        raise ProcessingError("invalid_coordinates")
                    cells.append((text, values))
        return cells

    @staticmethod
    def _pixels(width, height):
        if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
            raise ProcessingError("page_pixel_limit")

    def process(self, doc, directory, output, known, progress=lambda *_: None):
        from PIL import Image, ImageDraw, ImageFont, ImageOps
        import pypdfium2 as pdfium
        from reportlab.pdfgen import canvas
        from reportlab.lib.utils import ImageReader

        start = time.monotonic()
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        Image.MAX_IMAGE_PIXELS = MAX_PIXELS
        if doc["mime"] not in EXTENSIONS or doc.get("profile") not in ("identifiers", "healthcare"):
            raise ProcessingError("unsupported_input")
        path = directory / ("input." + EXTENSIONS[doc["mime"]])
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 20 * 1024 * 1024:
            raise ProcessingError("invalid_input")
        if shutil.disk_usage(output).free < MIN_FREE:
            raise ProcessingError("insufficient_disk")
        self.detector = self.detector or IdentifierDetector()
        pdf = None
        native = None
        image = None
        report_pages = None
        generated_pdf = None
        try:
            if doc["mime"] == "application/pdf":
                pdf = pdfium.PdfDocument(path)
                count = len(pdf)
                if not 1 <= count <= MAX_PAGES:
                    raise ProcessingError("page_limit")
                for index in range(count):
                    page = pdf[index]
                    try:
                        width, height = page.get_size()
                        self._pixels(math.ceil(width * 200 / 72), math.ceil(height * 200 / 72))
                    finally:
                        page.close()
                native = self._convert(path)
                image_pages = {prov.page_no for picture in native.document.pictures for prov in picture.prov}
            elif doc["mime"].startswith("image/"):
                with Image.open(path) as opened:
                    self._pixels(*opened.size)
                    if getattr(opened, "n_frames", 1) != 1:
                        raise ProcessingError("animated_image_unsupported")
                    opened.load()
                    image = ImageOps.exif_transpose(opened).convert("RGB")
                image.info.clear()
                count = 1
            else:
                import textwrap
                text = path.read_text("utf8")
                if len(text) > MAX_TEXT:
                    raise ProcessingError("text_limit")
                # Render internal integration reports anew, never as trusted HTML.
                lines = [line for paragraph in text.splitlines() for line in (textwrap.wrap(paragraph, 85, replace_whitespace=False) or [""])]
                report_pages = [lines[index:index + 55] for index in range(0, len(lines), 55)] or [[""]]
                count = len(report_pages)
                if count > MAX_PAGES:
                    raise ProcessingError("page_limit")
            if doc["kind"] != "image":
                generated_pdf = canvas.Canvas(str(output / "redacted.pdf"), pageCompression=1, invariant=1)
                generated_pdf.setTitle("")
                generated_pdf.setAuthor("")
                generated_pdf.setSubject("")
                generated_pdf.setCreator("CareVault redacted rendition")
            extracted, redacted, modes = [], [], []
            total_pixels = 0
            text_characters = 0
            for number in range(1, count + 1):
                if shutil.disk_usage(output).free < MIN_FREE:
                    raise ProcessingError("insufficient_disk")
                if pdf is not None:
                    page = pdf[number - 1]
                    try:
                        bitmap = page.render(scale=200 / 72)
                        try:
                            rendered = bitmap.to_pil().copy()
                        finally:
                            bitmap.close()
                    finally:
                        page.close()
                    cells = self._cells(native, number)
                    # Native text does not prove that embedded scanned identifiers
                    # were read. Every page with a bitmap receives full-page OCR.
                    use_ocr = number in image_pages or not cells
                    parsed = self._convert(path, ocr=True, page=number) if use_ocr else native
                    cells = self._cells(parsed, number, ocr=use_ocr)
                    if use_ocr and not cells:
                        raise ProcessingError("no_text_extracted")
                    size = parsed.document.pages[number].size
                    width, height = size.width, size.height
                    modes.append("ocr" if use_ocr else "native")
                elif image is not None:
                    rendered = image.copy()
                    # Docling applies DPI metadata to image geometry. Normalize
                    # the already checked/oriented pixels so a hostile or simply
                    # unusual DPI cannot inflate or downsample the OCR raster.
                    normalized = output / ".ocr-input.png"
                    try:
                        image.save(normalized, format="PNG")
                        parsed = self._convert(normalized, ocr=True)
                    finally:
                        normalized.unlink(missing_ok=True)
                    cells = self._cells(parsed, 1, ocr=True)
                    size = parsed.document.pages[1].size
                    width, height = size.width, size.height
                    modes.append("ocr")
                else:
                    import reportlab
                    font = ImageFont.truetype(str(Path(reportlab.__file__).parent / "fonts" / "Vera.ttf"), 21)
                    rendered = Image.new("RGB", (1275, 1650), "white")
                    draw = ImageDraw.Draw(rendered)
                    cells = []
                    for index, line in enumerate(report_pages[number - 1]):
                        y = 45 + index * 27
                        draw.text((45, y), line, font=font, fill="black")
                        cells.append((line, (45, y, 1230, y + 27)))
                    width, height = rendered.size
                    modes.append("report")
                try:
                    self._pixels(*rendered.size)
                    total_pixels += rendered.width * rendered.height
                    if total_pixels > MAX_TOTAL_PIXELS:
                        raise ProcessingError("document_pixel_limit")
                    text = ""
                    positions = []
                    previous = None
                    for value, box in cells:
                        if previous is not None:
                            overlap = min(previous[3], box[3]) - max(previous[1], box[1])
                            same_line = overlap > min(previous[3] - previous[1], box[3] - box[1]) / 2 and box[0] >= previous[0]
                            text += " " if same_line else "\n"
                        positions.append((len(text), len(text) + len(value), box))
                        text += value
                        previous = box
                    text += "\n" if text else ""
                    if sum(map(len, extracted)) + len(text) > MAX_TEXT:
                        raise ProcessingError("text_limit")
                    spans = self.detector.spans(text, doc["profile"], known)
                    text_characters += len(text.strip())
                    drawer = ImageDraw.Draw(rendered)
                    hit_index = 0
                    for start_pos, end_pos, box in positions:
                        while hit_index < len(spans) and spans[hit_index][1] <= start_pos:
                            hit_index += 1
                        if hit_index < len(spans) and spans[hit_index][0] < end_pos:
                            x0, y0, x1, y1 = box
                            left, right = sorted((x0 * rendered.width / width, x1 * rendered.width / width))
                            top, bottom = sorted((y0 * rendered.height / height, y1 * rendered.height / height))
                            drawer.rectangle((max(0, math.floor(left) - 2), max(0, math.floor(top) - 2), min(rendered.width, math.ceil(right) + 2), min(rendered.height, math.ceil(bottom) + 2)), fill=0)
                    extracted.append(f"--- Page {number} ---\n{text}")
                    redacted.append(f"--- Page {number} ---\n{redact_text(text, spans)}")
                    rendered.info.clear()
                    if generated_pdf:
                        # New document of pixels only. No original objects,
                        # searchable text layer, attachments or annotations survive.
                        page_width, page_height = rendered.width * 72 / 200, rendered.height * 72 / 200
                        generated_pdf.setPageSize((page_width, page_height))
                        generated_pdf.drawImage(ImageReader(rendered), 0, 0, width=page_width, height=page_height)
                        generated_pdf.showPage()
                    else:
                        rendered.save(output / "redacted.png", format="PNG")
                    progress(number, count)
                finally:
                    rendered.close()
            if generated_pdf:
                generated_pdf.save()
            (output / "extracted.txt").write_text("\n".join(extracted), "utf8")
            (output / "redacted.txt").write_text("\n".join(redacted), "utf8")
            files = list(output.iterdir())
            if sum(file.stat().st_size for file in files) > MAX_OUTPUT:
                raise ProcessingError("output_limit")
            for file in files:
                file.chmod(0o600)
            return {"seconds": round(time.monotonic() - start, 3), "pages": count, "modes": modes, "textCharacters": text_characters}
        finally:
            if pdf is not None:
                pdf.close()
            if image is not None:
                image.close()
