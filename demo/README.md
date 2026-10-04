# Fictional respiratory-care fixtures

Generate five small documents for upload, text extraction, OCR, and identifier-redaction testing:

```sh
python3 scripts/demo-fixtures.py generate
```

Requires ReportLab, Pillow, and pypdfium2. The script does not install dependencies, download models, contact a provider, or change the vault. Use an existing Python environment containing these packages. `--output-dir PATH` changes the output directory; the default is `demo/files/`, which is ignored by Git. Run from any directory. Total generated files must be below 1 MB or generation reports an error.

`manifest.json` provides each filename, title, MIME type, redaction profile, and provenance for the application importer. Generated files are reproducible within the same package versions: PDF timestamps and IDs use ReportLab's invariant mode; no randomness or current dates are used. The script prints sizes and SHA-256 hashes for verification.

| File | Purpose |
| --- | --- |
| `respiratory-intake.pdf` | Native PDF text with fictional contact information, cough history, and care preferences |
| `respiratory-visit.pdf` | Native PDF narrative and illustrative encounter observations |
| `respiratory-labs.pdf` | Native PDF table with invented laboratory values and preserved units |
| `respiratory-intake-scanned.pdf` | Raster-only intake PDF with no selectable text; exercises OCR |
| `respiratory-intake-photo.jpg` | Slightly rotated document image; exercises photo OCR |

The files consistently use the existing fictional Alex Morgan profile: age 34, intermittent cough for two weeks, reported peanut allergy, difficulty swallowing large tablets, `alex.morgan@example.test`, `+1 202-555-0148`, and `100 Example Lane, San Diego`. The existing "Medication A" entry is explicitly identified as incomplete illustrative data; no actual drug or dose is invented. The intake is dated September 29, 2026; the laboratory example is dated September 30.

Every page visibly identifies the content as fictional. The scan and photo are variants of the intake, not separate encounters. Laboratory and observation values are invented software fixtures; they are not diagnoses, reference standards, medical advice, or actual measurements. No treatment recommendation is included. Document text has no fact-extraction or review workflow.

These documents contain deliberately recognizable fictional identifiers for redaction tests. A successful OCR run does not prove successful redaction. Verify both the extracted text and the pixels/text layers of exported redacted files. Keep originals private unless explicitly authorized for an integration.

NIH chest X-rays must be acquired separately with their real dataset provenance. They are research images of other subjects and must never be described as images of Alex Morgan or as evidence for this fictional history. This generator does not produce, synthesize, or bundle chest X-rays.

## Attributed NIH research samples

Fetch just three original PNGs from the selected Hugging Face mirror:

```sh
python3 scripts/fetch-nih-samples.py
```

This script requires only Python's standard library and network access. It pins revision `36778e3b0e4f4b4fad31d1728d6190f3eda5b543`, reads the ZIP central directory with bounded HTTP byte ranges, and extracts selected members. It refuses a server that returns a full archive instead of HTTP 206. It checks ZIP CRC32, PNG signatures, file lengths, and records SHA-256 hashes. Metadata is read from only the first 524,288 bytes of the upstream CSV. The complete multi-gigabyte archive is never downloaded.

The PNGs total 1,161,436 bytes, separate from the 233,743-byte fictional document set. Generated/downloaded binaries remain ignored under `demo/files/`. `nih-manifest.json` preserves download URLs, original filenames, archive members, research subject IDs, dataset labels, demographics, view positions, hashes, and attribution. It is not a patient-vault mapping.

| PNG | Research subject | Original dataset label |
| --- | --- | --- |
| `nih-00000002_000.png` | 2 | No Finding |
| `nih-00000013_024.png` | 13 | Mass |
| `nih-00000008_002.png` | 8 | Nodule |

These three distinct subjects are selected by their dataset labels for a software demonstration, not randomly sampled for clinical evaluation. The labels were mined from reports and are not confirmed diagnoses. In particular, Mass or Nodule does not establish cancer. Do not treat this tiny, selected set as a performance benchmark or connect its demographics to the fictional Alex Morgan history.

Credit the **NIH Clinical Center** as the original provider and cite Wang et al., *ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on Weakly-Supervised Classification and Localization of Common Thorax Diseases*, CVPR 2017, pp. 3462-3471 ([paper](https://arxiv.org/abs/1705.02315)). The [Hugging Face dataset card](https://huggingface.co/datasets/alkzar90/NIH-Chest-X-ray-dataset) identifies the source mirror; the [original NIH dataset](https://nihcc.app.box.com/v/ChestXray-NIHCC) remains the upstream source. The mirror labels its license as unknown; no additional redistribution license is asserted here. Original binary images are not committed.

### Verified locally

- All four generated PDFs have exactly one page and were rendered and visually inspected, along with the document-photo JPEG.
- Native PDFs contain selectable text and fictional labeling; the scanned PDF has zero selectable text.
- Regeneration produces identical file hashes with the same bundled dependency versions.
- All three NIH PNGs decode at 1024 by 1024 pixels and match manifest byte counts and SHA-256 hashes.
- HTTP range rejection was tested with a mocked HTTP 200 response: the fetcher refuses it before reading a body.

These checks establish artifact integrity and layout, not OCR quality, successful redaction, or classifier accuracy. The app's processing and integration tests must verify those separately.
