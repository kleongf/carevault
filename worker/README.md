# Local document worker

This persistent Python worker processes CareVault uploads privately on the host. It extracts PDF text, uses local Tesseract OCR for scanned pages and images, detects identifiers with Presidio plus explicit patterns and patient identity values, and creates a new image-only redacted PDF or PNG. It does not extract proposed medical facts, call an LLM, or transmit document contents to a model service.

## Setup

Use Python 3.12 and reserve at least 3 GB of free disk space for the environment, model, and temporary processing. Tesseract with English language data must already be available on `PATH` (`tesseract --list-langs`). On macOS, install it with your package manager; on Debian/Ubuntu use the `tesseract-ocr` and `tesseract-ocr-eng` packages. These are separate from the Python requirements.

From the repository root:

```sh
python3.12 -m venv worker/.venv
worker/.venv/bin/python -m pip install --no-cache-dir -r worker/requirements.txt
worker/.venv/bin/python worker/setup_models.py
worker/.venv/bin/python -m pip check
```

The setup command downloads exactly three files from the pinned `docling-project/docling-layout-heron` revision `8f39ad3c0b4c58e9c2d2c84a38465abf757272d8`: configuration, preprocessor configuration, and a 171,658,996-byte layout checkpoint. It creates Docling's expected local artifact directory. It does not download table, VLM, enrichment, or alternate OCR models. The small English spaCy model is installed explicitly through `requirements.txt`.

When using `uv`, the equivalent environment installation is:

```sh
UV_CACHE_DIR=worker/.models/uv uv venv worker/.venv --python python3.12
UV_CACHE_DIR=worker/.models/uv uv pip install --python worker/.venv/bin/python --no-cache -r worker/requirements.txt
worker/.venv/bin/python worker/setup_models.py
UV_CACHE_DIR=worker/.models/uv uv pip check --python worker/.venv/bin/python
```

The worker defaults `HF_HOME`, `TORCH_HOME`, and `XDG_CACHE_HOME` to ignored subdirectories of `worker/.models`. Runtime model access is offline; missing dependencies or model files cause processing failure. The explicit setup command needs network access. Presidio's email recognizer is replaced with the same pattern recognizer without its Public Suffix List network refresh, which also handles fictional `.test` email addresses.

## Run

Start CareVault and initialize its database first, then start one worker from the repository root:

```sh
worker/.venv/bin/python worker/run.py --data-dir data
```

Use `--data-dir "$CAREVAULT_DATA_DIR"` if the app uses a custom location. `--once` processes at most one job and exits. A per-vault process lock prevents two CLI workers running simultaneously. The Python environment can also host the separate X-ray example's dependencies; its NumPy pin must remain compatible with Presidio's `<2.5` requirement.

The worker reads the existing `records` table in `vault.sqlite`, claims `processingJob` rows, and processes files in `documents/{uuid}`. It publishes `extracted.txt`, `redacted.txt`, and `redacted.pdf` or `redacted.png`. The API exposes renditions only when the document status is `ready`; all files must exist before that status changes. Originals remain available to the owner while queued. Failed processing never substitutes an original for a redacted rendition.

There is no review gate or fact-proposal workflow. New uploads and integration reports are unshared until the owner grants access in CareVault. Authorization is implemented by the app, not this worker.

## Processing behavior and limits

- Native PDF pages without bitmap content use Docling's native parser without layout inference or OCR. Pages containing any embedded image receive full-page OCR even when native text exists, so an identifier in an embedded scan is not silently skipped.
- Scanned PDFs and PNG/JPEG uploads use the pinned Docling layout model and Tesseract CLI in English. Table structure and all enrichment models are disabled; redaction reads retained raw OCR cells, including text that layout assembly might omit from tables.
- Images are EXIF-corrected and normalized to a private RGB PNG before OCR. The normalized image has no source DPI metadata, so unusual DPI cannot inflate or downsample OCR; it is deleted after conversion. The original upload is preserved unchanged.
- `identifiers` detects names, contact and account identifiers, locations, and patient identity values. `healthcare` additionally detects dates. These presets are best-effort automatic redaction, **not HIPAA Safe Harbor certification or a guarantee that all identifiers were removed**. Poor scans, handwriting, unusual layouts, and detector false negatives require independent evaluation before real healthcare use.
- Exports are new raster documents. They do not retain original PDF text layers, attachments, annotations, EXIF, or original metadata. Black rectangles cover detected text cells; some surrounding text may be lost.
- Image records can complete with no recognized text. `processing.textCharacters` is then zero; this is a useful UI signal, not proof that the image contains no identifiers. Scanned PDF pages with no extracted text fail closed.
- Limits: 20 MiB input; 30 pages; 12 million rendered pixels per page; 100 million pixels total; 1 million extracted characters; 100 MiB output; 256 MiB minimum free disk. PDFs render at 200 DPI. Processing one job has a 180-second supervisor deadline and a 90-second Docling conversion timeout.
- The supervisor renews a 30-second lease without holding a database transaction during processing. Interrupted jobs have at most three claims. Corruption, missing dependencies, partial conversion, and exceeded limits become safe error codes. Child logs are suppressed so parser messages cannot expose document text.
- A warm child process retains loaded models between jobs. Staging and OCR temporary files stay inside the private record directory and are removed on completion or failure. Output files use mode `0600` and private staging uses `0700`.

## Verification

```sh
worker/.venv/bin/python -m unittest discover -s worker -p 'test_*.py' -v
worker/.venv/bin/python worker/benchmark.py --generate
worker/.venv/bin/python worker/benchmark.py
```

The unit tests exercise leases, bounded restart recovery, exclusive claims, status-gated publication, partial output failure, safe errors, patient-scoped identifiers, coordinate handling, and pixel-only export construction. Tests that inject a parser or detector are explicitly not OCR/model quality evidence.

The real benchmark processes six generated fictional inputs: one-page native PDF, five-page native PDF, scanned PDF, mixed native/scanned PDF, rotated image, and a nonclinical image with an identifier header. It records separate cold-process and repeated warm-process latency, cumulative process peak RSS, page modes, output sizes, and extracted character counts. It also verifies expected identifiers and clinical values, independently OCRs redacted exports, checks black coverage at source OCR word coordinates, and checks PDFs contain no text layer or attachments. The image fixture is not an NIH image and does not evaluate a disease classifier.

Results and retained exports are ignored at `worker/benchmark-results.json` and `worker/verification-output/`. Fixture success is a narrow regression check, not a de-identification accuracy estimate on real medical records. Timings and observed limitations are recorded below after a complete local run.

### Measured local run (2026-10-03)

Python 3.12.14 on macOS 15.5 ARM64. The installed shared Python environment occupied 1.1 GiB, and the Docling layout cache occupied 164 MiB; this excludes any X-ray classifier checkpoint. `uv pip check` confirmed all 99 installed packages were compatible. `verified-environment.txt` records this exact shared worker/X-ray environment; `requirements.txt` remains the minimal worker installation entry point.

| Fixture | Cold process, including startup | Warm median of 3 jobs | Cold process peak RSS |
| --- | ---: | ---: | ---: |
| Native PDF, 1 page | 5.79 s | 0.090 s | 576 MiB |
| Native PDF, 5 pages | 6.46 s | 0.280 s | 591 MiB |
| Scanned PDF, 1 page | 9.33 s | 1.639 s | 966 MiB |
| Mixed PDF, 2 pages | 7.45 s | 1.628 s | 1,149 MiB |
| Rotated photograph | 7.22 s | 1.377 s | 1,141 MiB |
| Image with identifier header | 7.34 s | 0.865 s | 1,053 MiB |

All six fixtures passed the specified checks: all expected identifier values and clinical phrases were extracted, the numeric measurement `37.0` was preserved, all 53 tested identifier occurrences had 100% black coverage at independently located source OCR word boxes, and no tested identifier remained in redacted text or independent OCR of the exported pixels. PDF exports had no searchable text, annotations, or attachments. The rotated photograph and header image exports were also inspected visually.

These results do not establish perfect OCR: the rotated photograph's temperature unit `C` was transcribed as `Cc`, although its numeric value was correct and the visible export preserved the original unit. Presidio also over-redacted the adjacent `Email` label in these fixtures. We preserve the actual extracted text instead of silently rewriting medical values. The benchmark tests selected known fields and phrases, not exact transcription of every character or accuracy on representative clinical data.

Real optional runtime tests are separate from injected unit tests:

```sh
CAREVAULT_RUN_MODEL_TESTS=1 worker/.venv/bin/python -m unittest discover -s worker -p 'test_*.py' -v
```

All 22 tests passed with the flag enabled. They block Python socket connections while exercising real identifier detection and OCR, check a 1200-DPI EXIF image and empty-image metrics, and exercise the real persistent child process publishing a report and rejecting corrupt image data. The ordinary unit-test command skips these model-dependent cases when the environment flag is absent. Timings are observations on a shared development machine, not service-level guarantees.

Primary implementation references: [Docling](https://github.com/docling-project/docling), the [pinned Heron model files](https://huggingface.co/docling-project/docling-layout-heron/tree/8f39ad3c0b4c58e9c2d2c84a38465abf757272d8), [Presidio](https://github.com/microsoft/presidio), and [Tesseract](https://github.com/tesseract-ocr/tesseract). Runtime options and raw-cell APIs were verified against the installed, pinned Docling version, not inferred from an older example.
