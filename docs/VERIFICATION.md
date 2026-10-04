# Verification and handoff

Evidence snapshot: **October 3, 2026**, local macOS ARM64. Core redesign and both external integration flows have real runtime and browser evidence. Patient/developer desktop and narrow-screen checks, credential-modal inspection, and source publication are complete. These checks demonstrate a local prototype, not clinical accuracy, universal de-identification, or public-hosting readiness.

## Completed baseline

| Check | Recorded result | Scope |
| --- | --- | --- |
| `npm test` | 60 passed | Real temporary SQLite stores and HTTP/service behavior; provider responses injected in legacy chat tests |
| `npm run typecheck` | Passed | Current TypeScript sources |
| `npm run build` | Passed | Next.js production build, including PDF.js 6 canvas previews |
| Fictional fixture generation | Five files, 233,743 bytes | Reproducible PDFs/photo, visible fictional labeling, source consistency |
| NIH sample acquisition | Three PNGs, 1,161,436 bytes | Bounded HTTP ZIP ranges, CRC/size/SHA checks, distinct research participants and preserved metadata |
| Real document benchmark | Six fixtures passed specified extraction/export checks | Native/scanned/mixed/photo/header documents, cold/warm timings, independent export inspection |
| Worker test suite | 22 passed with `CAREVAULT_RUN_MODEL_TESTS=1` | Includes three real runtime cases, not skipped model checks |
| X-ray module tests | 14 passed | Injected boundary tests including the in-page authentication flow |
| Medicine module tests | 21 passed | Injected vault/provider and temporary HTTP boundary including in-page login |
| Real X-ray adapter evaluation | 30 executions passed | Three NIH originals and three actual worker renditions; finite 18-label outputs and repeatability |
| Live external integration flows | Passed for both apps | Real free-model draft, v2 writeback, worker ready, unshared arrival, repeat save, and revocation |
| Live worker restart | Passed | Queued valid scan became ready; corrupt PDF failed; failed redacted read returned 409 |

## Minimal UI and Playwright follow-up

The October 3 UI follow-up installed `@playwright/test` 1.63.0 and Chromium. Final `npm run test:browser` passed **30/30 cases in 24.4 seconds**, after its production build passed. Typecheck and whitespace checks passed. The 52 Node tests and the 21 medicine / 14 X-ray Python tests also passed during this change. Worker code was unchanged; its 22-test real-runtime result above was not rerun for this UI-only follow-up.

- **14 vault browser cases:** seven journeys at desktop 1280×900 and mobile 390×844. Actual role login/logout and denied role access; search; valid PDF canvas pixels, paging, keyboard tabs and downloads; image preview; queued/failed states; invalid/oversized uploads and preset persistence; independent representation grants; real v2 report writeback and future-access revocation; developer registration/edit, credential reveal/hide/rotation/revocation; API disclosures; Trial Explorer preview, one-use approval/use, denial and revocation. Dialog focus return and horizontal overflow are checked. A failed initial dashboard request now has a tested Retry action.
- **16 integration browser cases:** eight journeys at both sizes using shipped static files and fully mocked APIs. Login errors, credential clearing, no browser storage, source selection/preview, escaped model text, explicit save, denied/revoked context, empty grants, unavailable free model, logout/reload, and data-usage disclosures. These tests make no model or inference calls.
- The test server creates its own temporary SQLite store, synthetic passwords, valid two-page PDF, tiny PNG, and prepared text/redacted outputs. It clears its provider key and refuses an existing server on 3140. Uploads persist through browser reload but deliberately remain queued without the worker. This establishes UI and HTTP behavior, not new OCR/redaction accuracy evidence.
- Text was reduced across patient/developer workspaces, Trial Explorer, and both separate apps. Descriptions and reference material now expand from Info controls or API sections. Permission labels, exact facts awaiting approval, and unverified status remain available. Icons have accessible names; dialog openers regain focus.
- Browser checks caught a mobile X-ray Info panel covering its own toggle; its position was corrected and opening/closing passed afterward. They also guard against an incorrect Retry accessible name. Final screenshots of PDF views, Apps, developer setup, Trial Explorer, and both app workspaces were retained under ignored `test-results/` for visual inspection.

Scope: Chromium desktop and emulated mobile only, not Firefox/WebKit or a complete screen-reader/accessibility audit. Earlier real classifier/provider evidence remains separate from these mocked integration browser tests. The repeatable command and report viewer are documented in README.md.

Node verification used Node 26.8.1; Node 24 is recommended but was not separately established by these runs. The worker benchmark used Python 3.12.14 on macOS 15.5 ARM64. Do not infer coverage of other operating systems or deployment configurations.

## Node behavior covered

The current test files cover:

- **Accounts/developer lifecycle:** patient/developer/integration identity separation; password hashes absent from responses; session persistence/expiry/logout; Origin validation; generic bad-login responses and persistent throttling; developer ownership; registration without injected grants; token rotation/revocation; additive migration; capability removal that does not silently restore old permissions.
- **Records and HTTP:** private queued uploads; MIME signature and size/profile/path validation; persistence; status-gated output; independent text/redacted/original permissions; generic integration descriptors; redacted text release; failed/missing/symlinked/cross-patient output refusal; quotas and no orphan jobs; actual role/Origin/upload/receipt route behavior.
- **Reports and revocation:** app-bound current receipts; server attribution; new unshared reports; inherited source representations; missing/cyclic provenance refusal; dependencies from prior v2 disclosures even when omitted by the writer; legacy disconnect parity; legacy reports owner-only due incomplete history.
- **Compatibility:** existing structured-memory privacy ordering, source/summary inheritance, isolation, legacy scopes, saved data, current-policy prepared text exports, and legacy chat provider boundaries remain covered. The retained tests do not mean that the old chat/inspector UI is still part of the product.

Most record service tests use constructed processed outputs to isolate authorization/persistence. They do not by themselves demonstrate Docling, OCR, real identifier detection, or actual export construction. Those are separate worker checks.

## Document processing evidence

The real benchmark and detailed metrics live in [worker/README.md](../worker/README.md#measured-local-run-2026-10-03); raw results and rendered exports are ignored at `worker/benchmark-results.json` and `worker/verification-output/`.

Six generated fictional inputs were tested: one-page and five-page native PDFs, scanned PDF, mixed native/scanned PDF, rotated photograph, and a nonclinical image with an identifier header. The retained benchmark records cold-process time, median of three warm jobs, peak RSS, output size, and extraction/page-mode metrics. Do not substitute invented timings for those measurements.

The recorded fixture checks found all selected expected identifiers and clinical phrases; numeric `37.0` was retained. All 53 tested identifier occurrences had black coverage at independently located OCR word boxes, with no tested identifier left in redacted text or independent OCR of the exported pixels. Redacted PDFs had no searchable text, annotations, or attachments. Selected image exports were also visually inspected.

Known limits: the benchmark rotated photograph's unit `C` became `Cc` in extracted text; Presidio also redacted an adjacent `Email` label. Additional processed demo text over-redacted `Allergies` and `Oxygen` labels. Much of the intended clinical text remained, but no clinical transcription-accuracy guarantee follows. This is targeted fixture evidence, not character-perfect OCR, clinical data extraction validation, a measured population-wide redaction accuracy, or HIPAA compliance. The worker preserves actual extraction instead of silently correcting medical values.

Worker unit tests exercise job claims/leases, bounded recovery, safe output publication/failure, identifiers, coordinates, and raster construction. Injected parser/detector tests remain distinct from the optional real runtime checks enabled by `CAREVAULT_RUN_MODEL_TESTS=1`. The final run enabled that flag: all 22 tests passed, including three real runtime cases. Consult worker/README.md for exact commands; do not collapse skipped optional cases into claimed passes in later runs.

## Fixture evidence

`scripts/demo-fixtures.py` generated three native PDFs, one raster-only scanned PDF, and one rotated intake JPEG. All PDFs contain one page; native files contain selectable text and fictional labels, while the scan has zero extractable text. PDF pages and the photo were rendered/visually inspected without clipping. Repeated generation with the same dependency versions produced identical hashes. The manifest and importer keep the scan/photo as variants of one fictional encounter.

`scripts/fetch-nih-samples.py` acquired these original 1024×1024 PNGs:

| Original filename | Research subject | Text-mined label |
| --- | --- | --- |
| `00000002_000.png` | 2 | No Finding |
| `00000013_024.png` | 13 | Mass |
| `00000008_002.png` | 8 | Nodule |

The script pins Hugging Face revision `36778e3b0e4f4b4fad31d1728d6190f3eda5b543`, retrieves only bounded ZIP ranges and a bounded metadata prefix, and records exact provenance and hashes in [nih-manifest.json](../demo/nih-manifest.json). Actual images decoded successfully and matched hashes. A mocked HTTP 200 archive response was rejected before reading its body. No full archive was downloaded. These research subjects are not fictional Alex Morgan; the selected labels are not confirmed diagnoses or a classifier accuracy benchmark.

`npm run demo:seed` imported all eight manifest records, which completed real worker processing. A second run imported zero, confirming filename/hash deduplication in the running vault. Original legacy grants remained unchanged. Two new example-app grants were limited to demonstration files.

## Real classifier and provider evidence

[The X-ray evaluation](../examples/xray-app/EVALUATION.md) records 30 actual adapter runs: one cold and four repeated calls for each of three originals and three worker renditions. All returned 18 finite scores in range with consistent exposed six-decimal outputs. The original/rendition pixel values and scores were identical for these particular images; no pixels were masked, so this does not establish robustness to redaction masks. NIH training overlap cannot be ruled out, and the three label-selected subjects are not a clinical validation set.

Both integrations completed a first direct live workflow and a second browser-driven workflow against **`stealth/space-bunny-alpha`**, with zero-price checks and no paid fallback. The first X-ray draft took approximately **8.73 seconds**; the first medicine draft took **25.1 seconds**. These individual observations include their respective request work and do not establish latency guarantees. Model availability is temporary; the selected model was announced to retire October 5, 2026.

For both apps, the actual v2 report was saved, processed by the worker, and remained unshared. Repeating a successful save returned its existing result, and revoking access denied a later request. The browser then exercised separate actual provider calls: in-page sign-in, authorized image/text preview, generation, and report saving. X-ray provider input uses classifier scores; Medicine Review uses selected redacted text. Generated language remains unverified and was not evaluated for clinical recommendation quality.

The two example apps now use an in-page login. Their local username/password authorization is held only in JavaScript memory, sent explicitly through Basic headers, and not written to browser storage. The server does not trigger native `WWW-Authenticate` prompts. Integration tokens and provider keys stay server-side. This fixes the embedded-browser login path without making the loopback demo servers suitable for public exposure.

Injected tests separately cover grant/content changes during asynchronous work, draft expiry, bounds, failure responses, and receipt-aware saving. Live post-revocation denial is distinct from a real mid-provider-call race test; the latter was not claimed.

## Browser, restart, and migration evidence

- Both seeded CareVault role logins worked. Developer registration, edit fields, credential modal, and API setup were inspected in the initial manual pass. The Playwright follow-up above now also verifies credential issue/rotate/revoke through the browser.
- Patient PDF Original, Extracted text, and Redacted copy were inspected. PDF.js 6 rendered the original and redacted pages on canvas. A browser-uploaded PDF moved from queued to ready.
- Both external apps' source/image previews, live generation, and save flows succeeded in the browser.
- Patient and developer layouts at a 390-pixel viewport were inspected without horizontal overflow. NIH image previews displayed their research provenance; the five-page PDF viewer advanced to page two. Login errors, sign-out, Escape-to-close, processing failure, selected permissions, and browser revocation were exercised. A full accessibility or cross-browser audit is not claimed.
- A stopped-worker test submitted a valid scanned PDF and a corrupt PDF through HTTP; both were observed queued. Restarting the worker produced ready and failed respectively. The valid redacted attachment was a PDF; the failed record's redacted route returned 409 without original fallback. Retained evidence is ignored at `test-results/restart-verified.json`.
- An isolated backup restore/migration preserved 96 existing stored records. This validates that local restore/migration case, not an automated operational backup service. The active vault retained prior data/grants while eight demo records and two demo-only app grants were added.

Final acceptance checks:

- [x] Patient NIH/image preview, 390-pixel layout, dialogs, sign-out, and failure states inspected.
- [x] Developer credential modal and issue/rotate/revoke verified through browser and API tests.
- [x] Source/secret/diff review completed and feature branch published to the authorized remote (`19c8d02`, followed by this documentation update).

Earlier owner-code/chat-era browser evidence is not used to prove the redesign. New live checks above are recorded separately.
## Storage, migration, and deployment limits

Accounts and document records are added without resetting legacy memory, credentials, grants, or restrictions. New developer apps are v2-only. Old authenticated APIs remain compatible, and legacy report restrictions intentionally remain conservative. The redesigned UI does not expose the old owner inspector/chat workflow.

The private vault includes `credentials.json`, `vault.sqlite`, SQLite sidecars, and `documents/`. Stop all writers before a consistent directory backup; preserve credentials and ownership with the files. An isolated local restore/migration was tested as described above; deployment-specific restore and operational backup procedures still require validation. Initial demo passwords are deliberately retained in the private operator credentials file; the app does not claim encryption at rest or secret-manager lifecycle.

This is local operation, not a public deployment. HTTPS proxy behavior, Secure cookies in that deployment, operating-system ownership, backups, monitoring, account recovery, multi-tenant identity, and applicable healthcare/compliance operations are not established by these local checks. Do not put the vault on ephemeral Vercel storage. Source publication to the authorized GitHub remote does not publish or deploy local patient data.

## Concurrent remote work and branch delivery

The teammate Trial Explorer contribution from `origin/main` (`397f9bc`, `e2e0072`) is preserved on the feature branch. Its APIs and two tests remain intact; the patient-only `/trials` compatibility page uses its original legacy permission and one-use approval behavior. Browser checks verified developer exclusion and patient sign-in/page rendering. A focused review and additional authorization probes found no v2/legacy bypass. The combined 52-test Node suite, typecheck, and production build passed. Publication targets only `carevault-records-and-integrations`, as requested; remote main is not changed by this work.

## Handoff verdict

Ready for the local synthetic-data hackathon demo, with the documented OCR/redaction/model limitations. All 109 automated tests passed (52 Node, 22 worker, 14 X-ray, 21 medicine), together with typecheck and production build. Configured credentials, private vault data, generated files, and weights were excluded from source publication. Both example servers are configured against the preserved local vault; their current read scopes include three fictional text documents and one attributed research X-ray respectively. Public hosting and clinical validation remain outside this delivery.

## Patient profile and demo login follow-up — October 3, 2026

- `npm test`: **60/60 passed**, including eight new profile cases covering validation, immutable snapshots, unknown defaults, restart, role/Origin/session boundaries, concurrent saves, all representation grants, old receipts and report ancestry, quota limits, and transaction/filesystem rollback.
- `npm run test:browser`: production build passed, then **36/36 Chromium cases passed in 40.8 seconds**. Six new desktop/mobile cases cover all editable fields, saved identity, reload persistence, explicit sharing, retained drafts, cancel, queued previews, validation, and conflicting sessions. Desktop/mobile profile screenshots were inspected. Browser processing fixtures remain injected.
- `CAREVAULT_RUN_MODEL_TESTS=1 worker/.venv/bin/python -m unittest discover -s worker -p 'test_*.py' -v`: **26/26 passed**, including three real runtime cases and four added snapshot-hint/supersession cases.
- `node --experimental-strip-types scripts/verify-profile-processing.ts`: passed with the actual worker and a temporary synthetic vault. Verified extraction, selected identifier redaction, preserved allergy text, redacted PDF output, explicit text sharing, old-context denial, and rejection of a stale report receipt after an edit. No provider call was made.
- `worker/.venv/bin/python worker/benchmark.py`: all six real document fixtures passed the extraction, text/export redaction, and pixel checks again. The ignored benchmark artifact retains fresh timings.
- Restarted CareVault returned HTTP 200; authenticated GET of the live profile returned all eleven fields without changing the preserved patient data.
- Existing X-ray and medicine source code was unchanged. Their locally configured passwords were normalized to the current patient password, both servers restarted, and accepted/rejected HTTP authentication checked without printing credentials. Developer credentials remain unchanged. No automatic cross-app account synchronization was added.

Earlier test totals and timing sections above are historical evidence. Current fresh profile checks are the results in this section. Known limits: identifier detection remains best effort, retained snapshots count toward record quotas, legacy facts and historical documents do not synchronize with profile edits, and reports may remain owner-only when any historical source was superseded. Deploy the updated gateway and worker together; rollback requires a consistent pre-change vault backup or a forward fix, since the old gateway lacks supersession enforcement.
