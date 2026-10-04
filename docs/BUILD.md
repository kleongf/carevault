# Implementation and acceptance board

The current target is the approved record-based CareVault redesign plus separate X-ray and medicine example apps. The old 12-hour/chat/owner-inspector plan is superseded. Local implementation and verification are complete; [VERIFICATION.md](VERIFICATION.md) records completed checks.

## Build sequence

| Step | Deliverable | Acceptance evidence |
| --- | --- | --- |
| 1 | Two seeded accounts, role sessions, developer app/credential lifecycle | Wrong-role denial, expiry/logout/restart tests, one-time token rotation/revocation |
| 2 | Records/Apps/Activity patient UI and separate developer portal | Browser role separation, useful loading/errors, keyboard/dialog behavior, mobile layout |
| 3 | Private PDF/PNG/JPEG ingestion and durable jobs | Real valid upload, malformed/oversized rejection, restart persistence, safe file paths |
| 4 | Docling/OCR/identifier-redaction worker | Cold/warm benchmark, native/scanned/photo extraction, actual pixel/text/metadata export checks |
| 5 | Selected-record representation grants | Independent text/redacted/original results; failed output never serves original; new records unshared |
| 6 | Report receipts and dependencies | Current receipt validation, server authorship, unverified/private arrival, inherited source restrictions |
| 7 | Fictional documents plus attributed NIH images | Reproducible generation, provenance/hashes, explicit additive import without consent changes |
| 8 | Separate X-ray and medicine apps | Real configured inference/provider calls, fresh reads, report writeback, revoked access denial |
| 9 | Documentation and source publication | Final checks, secret exclusions, accurate unfinished-work notes, normal authorized Git push |

## Required automated checks

From the repository root, using a Python environment with the documented dependencies:

```sh
npm test
npm run typecheck
npm run build
git diff --check
worker/.venv/bin/python -m unittest discover -s worker -p 'test_*.py' -v
worker/.venv/bin/python -m unittest discover -s examples/xray-app -p 'test_*.py' -v
worker/.venv/bin/python -m unittest discover -s examples/medicine-app -p 'test_*.py' -v
```

No lint script or CI workflow is configured. Tests that inject classifier/provider/parser outputs prove boundaries, not actual model execution.

For worker/runtime changes, also use:

```sh
worker/.venv/bin/python worker/benchmark.py --generate
worker/.venv/bin/python worker/benchmark.py
CAREVAULT_RUN_MODEL_TESTS=1 worker/.venv/bin/python -m unittest discover -s worker -p 'test_*.py' -v
```

Follow each example app's README for real model/provider verification. Use free providers only; a failed live call must not be replaced with a fabricated successful result.

## Live acceptance checklist

Run against a separate synthetic validation vault where practical. Never reset the user's vault to get a clean test. If testing the actual demo vault, record any intentionally added records/grants and do not erase existing state.

- [x] Patient and developer sign-in verified; wrong-role/session/logout/persistence behavior covered by API tests.
- [x] Developer registration, edit fields, and API setup inspected in the browser. Credential issue/rotate/revoke and restart behavior covered by API tests.
- [x] Browser credential modal inspected without exposing a token; credential lifecycle remains API-tested.
- [x] All eight seeded PDF/scan/photo/NIH records processed. Second seeding run added zero. A real browser PDF upload reached ready.
- [x] Original/extracted/redacted PDF tabs inspected, including PDF.js canvas previews. Actual export checks cover selected identifiers, pixels, text layers, and metadata.
- [x] Patient NIH image preview/provenance and narrow-screen layout inspected.
- [x] Independent representation grants, redacted text release, failed-rendition refusal, and new unshared records/reports covered by tests and live integration reads/writes.
- [x] Thirty real X-ray adapter calls evaluated three original and worker-rendition pairs; model/checkpoint, outputs, timing, and limitations recorded.
- [x] Both apps generated real free-model drafts, saved source-linked reports through v2, and reached processed/unshared state. Repeat save and post-revocation denial verified.
- [x] Both app browser login, source/image preview, generation, and save worked with actual provider calls. They use in-page login rather than native browser auth prompts.
- [x] Permission changes during async generation covered by injected boundary tests; live post-revocation denial passed. Do not conflate these two evidence types.
- [x] Developer workspace at 390px had no horizontal overflow; role-separated navigation omits CareVault chat/inspector.
- [x] Isolated restore/migration preserved 96 existing stored records. Real-vault demo import added eight records and two example-app grants limited to demo files without changing existing grants.
- [x] Live stopped-worker test queued a valid scan and corrupt PDF; after restart they became ready/failed respectively. Valid redacted attachment succeeded and failed redacted read returned 409.
- [x] Patient mobile, login error, dialog Escape, failed processing, page navigation, selected grants, and browser revocation checked.
- [x] Secret/diff review complete; published `carevault-records-and-integrations` without updating remote main.

## Five-minute demonstration

1. Patient opens an uploaded fictional PDF, extracted text, and the actual redacted export.
2. Developer briefly shows app registration and API setup; no secret is shown in a shared screen.
3. Patient connects the separate X-ray app and selects one attributed image with explicit file access and report permission.
4. X-ray app classifies it, drafts an unverified report, and saves it back. CareVault displays the report as a new unshared record.
5. Optionally use the medicine app with selected redacted document text to demonstrate a different integration.
6. Patient revokes access; the integration's next request fails. Explain that previously copied data cannot be recalled.

Only rehearse this as a live demonstration after every dependent step is verified. Keep a clearly labeled recording/prepared artifact if needed; do not misrepresent it as a current live result.
