# CareVault

A local, patient-controlled record vault for healthcare integrations. Patients upload documents and images, inspect extracted text and redacted copies, and choose exactly which records each external app can use. Apps can return attributed, unverified reports without gaining broader access.

**Verified local prototype — October 3, 2026.** The redesigned accounts/UI, private uploads, document worker, and both external apps are implemented. Real extraction/redacted exports, 30 classifier runs, free-model drafts, report writeback, and revocation have been exercised. Current checks: 52 Node tests, 22 worker tests including real runtime cases, 14 X-ray tests, 21 medicine tests, 30 Playwright browser cases, typecheck, and production build pass. Evidence and deployment limits are recorded in [verification](docs/VERIFICATION.md). These results establish demo mechanics, not clinical accuracy.

Use fictional documents and attributed research images for this demo. This project is not a clinical decision system, universal de-identification tool, or HIPAA certification.

## Start CareVault

Use Node 24 (recommended in `.nvmrc`); Node 22.13+ with `node:sqlite` is required.

```sh
git clone --branch carevault-records-and-integrations https://github.com/kleongf/carevault.git
cd carevault
npm ci
npm run setup
npm run dev
```

Open **http://127.0.0.1:3040**. Setup prints two randomly generated local logins: `patient` and `developer`. Keep the printed passwords private. Re-running setup preserves accounts, grants, documents, and existing credentials. The account passwords are hashed for authentication; initial demo passwords also remain in the private `data/credentials.json` so the local operator can retrieve them. There is no signup, password-reset UI, or reset command.

For the production build locally, run `npm run build` followed by `npm start`. Both app modes bind to loopback port 3040. Do not run competing servers on that port.

`CAREVAULT_DATA_DIR` selects the private data directory; default is `data/` under the repository. Export it consistently before setup, seeding, and starting the server. Next.js loads `.env.local`; standalone Node setup/seeding and Python programs do not automatically load that file.

## Start document processing

The background worker handles native PDF text, scanned PDFs, and PNG/JPEG uploads using Docling, local Tesseract OCR, and Presidio identifier detection. It generates extracted text, identifier-redacted text, and new image-based redacted exports. No extraction LLM, fact proposals, or review checklist is used.

Follow [worker setup](worker/README.md), including Python 3.12, Tesseract, pinned dependencies, and the explicitly provisioned layout model. Check disk space before installation. Once CareVault has initialized its database, start one worker in a second terminal:

```sh
worker/.venv/bin/python worker/run.py --data-dir data
```

If using a custom vault, pass the same directory to `--data-dir`. Processing happens in a persistent warm child process; uploads remain usable in the UI while queued. Failed redaction never serves an original as a substitute. Cold/warm measurements and known OCR errors are recorded in [worker/README.md](worker/README.md#measured-local-run-2026-10-03), rather than treated as universal performance estimates.

## Add demonstration records

The fixture generator requires ReportLab, Pillow, and pypdfium2 in the selected Python environment. The NIH fetcher uses the Python standard library and bounded downloads.

```sh
python3 scripts/demo-fixtures.py generate
python3 scripts/fetch-nih-samples.py
npm run demo:seed
```

Use a Python interpreter with those packages installed for the first command. The generated files stay in ignored `demo/files/`. The seeder imports only available manifest entries, verifies provided hashes, and skips files already imported with the same filename/hash. It adds processing jobs without resetting the vault or changing grants. Missing files are reported and skipped.

The fictional respiratory-care series includes an intake, visit note, illustrative laboratory report, raster-only scanned intake, and document-photo variant. Three separately attributed NIH chest X-rays retain their actual research provenance and are **not** presented as images of fictional patient Alex Morgan. See [demo documentation](demo/README.md) and manifests. No full NIH archive is downloaded.

## Patient and developer workflows

| Patient account | Developer account |
| --- | --- |
| **Records:** upload PDF/PNG/JPEG; open Original, Extracted text, or Redacted copy | **My apps:** register/edit an app, URL, description, and requested capabilities |
| **Apps:** find an app in the directory, select records, save permissions, revoke | **Credentials:** issue/rotate/revoke a server credential; new tokens are shown once |
| **Activity:** see upload, permission, read, and report events | **API setup:** copy integration examples without exposing patient data |

CareVault has no patient-facing chatbot or developer request inspector. The developer role cannot read patient records or set patient consent. External apps do their own medical or conversational work.

The UI keeps primary actions and permission choices visible. Info icons reveal app descriptions, provenance/redaction details, and integration data usage; developer API examples expand on demand. Secondary actions use icons with accessible names and tooltips. Dialogs return keyboard focus to their opening control.

For each selected record, grant **extracted text**, **redacted file**, and/or **original file** independently. Integration text is the identifier-redacted version; the owner can inspect the original extraction. Original-file permission is explicit. New uploads and reports remain unshared until selected. Connecting an app alone does not share future records.

Profiles `identifiers` and `healthcare` run automatic identifier redaction; healthcare additionally detects dates. They do not remove selected clinical topics, guarantee all identifiers are found, or implement HIPAA Safe Harbor certification. Observed OCR/redaction errors include a misread temperature-unit character and over-redaction of labels such as Allergies and Oxygen; inspect the output rather than treating it as exact clinical transcription. There is no manual redaction editor. Readable originals remain in private storage.

Reports arrive as unverified integration-generated records, with server-assigned authorship and source receipts. Their source dependencies remain restrictive when shared later. There is no fact acceptance or clinical-verification workflow.

## Separate example applications

| Application | Local URL | Purpose and status |
| --- | --- | --- |
| CareVault | `http://127.0.0.1:3040` | Patient vault and developer portal |
| Chest X-ray Review | `http://127.0.0.1:3041` | Real local classifier, free-model draft, browser save, and permission/revocation flow verified |
| Medicine Review | `http://127.0.0.1:3043` | Authorized-text discussion, free-model draft, browser save, and permission/revocation flow verified |

The [X-ray example](examples/xray-app/README.md) has its own local login, server-side CareVault token, explicitly provisioned weights, and explicit OpenRouter model. It reads an authorized image, produces classifier scores, drafts an unverified report, rechecks access, and supports an explicit save back to the vault. Scores are not calibrated disease probabilities or cancer diagnoses. The [30-run local evaluation](examples/xray-app/EVALUATION.md) verifies execution and output consistency. NIH demonstration images are not an independent clinical evaluation set.

The [Medicine Review example](examples/medicine-app/README.md) is a separate application under `examples/medicine-app/`, not a restored chat screen inside CareVault. It uses `text:read` and `reports:create`. Export `CAREVAULT_TOKEN`, `OPENROUTER_API_KEY`, an explicit `OPENROUTER_MODEL`, `MEDICINE_APP_USERNAME`, and `MEDICINE_APP_PASSWORD` (at least 12 characters), then run `worker/.venv/bin/python examples/medicine-app/app.py`. `CAREVAULT_URL` defaults to the local vault. Follow its own README for current status; do not assume another app's credentials or data access apply to it.

Both example apps use an in-page login. Local app credentials are kept only in JavaScript memory and sent explicitly in Basic authorization headers; they are not browser-stored. No native Basic-auth prompt is used. Integration tokens and provider keys stay server-side. These loopback HTTP examples are not public hosting servers.

New integrations should be created in the developer portal and use the [v2 API contract](docs/INTEGRATION-CONTRACT.md). Tokens authenticate apps; patient grants authorize records. Keep app tokens and `OPENROUTER_API_KEY` in each app's server environment. Python examples require explicit environment exports or a process supervisor; copying an `.env.example` alone does not load it. There is no automatic paid or replacement-model fallback. The earlier selected `stealth/space-bunny-alpha` was announced to retire October 5, 2026; verify current free availability before a live call.

The teammate-built **Trial Explorer** is preserved at `http://127.0.0.1:3040/trials`, linked from its app card. It is a patient-authenticated compatibility page using legacy structured facts and a synthetic study catalog, including explicit single-use fact approvals. Its legacy permissions are separate from new document grants; no live trial registry or eligibility determination is provided.

## Architecture and files

```text
Patient/developer browser -> Next.js role/session boundary -> SQLite and private files
Patient upload -> persistent processing job -> Python Docling/OCR/redaction worker
External app backend -> bearer token + current record grant -> allowed representation
External report -> validated receipts + inherited dependencies -> private queued record
```

| Path | Responsibility |
| --- | --- |
| `app/page.tsx`, `components/carevault/` | Login, separate workspaces, record/grant UI, PDF.js 6 canvas previews |
| `components/ui/` | shadcn/Radix components and included license |
| `lib/accounts.ts`, `lib/developer.ts` | Role authentication, persisted sessions, app ownership and credentials |
| `lib/http.ts`, `app/api/[...path]/route.ts` | HTTP boundary, Origin checks, body/upload limits, safe responses |
| `lib/records.ts` | Upload persistence, per-record grants, representation reads, receipts, reports |
| `lib/store.ts` | SQLite JSON records and additive migrations |
| `worker/` | Durable job processing, Docling/OCR, identifier detection, exported renditions and benchmarks |
| `examples/xray-app/` | Separate image classification/report application |
| `examples/medicine-app/` | Separate authorized-text medicine discussion/report wrapper |
| `demo/`, `scripts/*fixtures.py`, `scripts/fetch-nih-samples.py` | Reproducible fictional documents and provenance-tracked research samples |
| `scripts/seed-records.ts` | Explicit additive demo import |
| `lib/policy.ts`, `lib/service.ts`, `lib/chat.ts` | Retained legacy policy/API behavior; not the redesigned product UI |
| `tests/` | Temporary-store HTTP, identity, permission, persistence, and compatibility tests |

Local storage uses SQLite WAL and private filesystem directories. No graph database, vector index, semantic search, DICOM support, or autonomous memory-learning agent is implemented. The backend and worker are trusted with readable data; filesystem permissions are not encryption at rest.

## Migration and current limits

Existing vault data, legacy grants, and restrictions are preserved additively. Legacy structured memory is retained; it is not automatically converted into uploaded documents. Older `/api/owner/*` and `/api/v1/*` handlers remain authenticated compatibility paths, including old chat functionality, but are absent from the new navigation. New developer apps are v2-only and cannot use the legacy API to acquire broader access. Disconnecting an existing app stops both paths. Reports from legacy apps remain owner-only because old disclosure history is incomplete.

The v2 gateway inherits **all known historical v2 disclosures** for an app into its reports, not just receipt IDs the caller chooses to submit. This can withhold a seemingly harmless report when a source is no longer shared. It protects known provenance; it cannot inspect or erase information retained outside CareVault. Revocation blocks future requests, not previously copied data.

Current upload limits are 20 MiB per file, 100 records, and 300 MiB of original content per vault. Worker page/pixel/output limits are separate. The prototype has one fixed patient and one developer account; it is not a multi-tenant healthcare platform. There is no public signup, DICOM viewer, diagnosis service, manual redaction editor, automated backup service, or production compliance assessment.

## Verification and later hosting

```sh
npm test
npm run typecheck
npm run build
git diff --check
worker/.venv/bin/python -m unittest discover -s worker -p 'test_*.py' -v
worker/.venv/bin/python -m unittest discover -s examples/xray-app -p 'test_*.py' -v
worker/.venv/bin/python -m unittest discover -s examples/medicine-app -p 'test_*.py' -v
```

Live acceptance steps are tracked in [BUILD.md](docs/BUILD.md). Passing injected tests does not establish real OCR, inference, provider access, or browser behavior. See [VERIFICATION.md](docs/VERIFICATION.md) for completed versus pending checks.

### Repeatable browser checks

```sh
npx playwright install chromium
npm run test:browser
npm run test:browser:report
```

The browser command builds production assets and runs **30 Chromium checks** at desktop (1280×900) and mobile (390×844) sizes. Stop a running production CareVault server before rebuilding its `.next` assets, then restart it afterward. Port 3140 must be free; the test harness refuses to reuse an existing server. It creates and removes a temporary SQLite vault with synthetic credentials and fixtures, never the operator's `data/` directory.

Patient/developer tests use the real HTTP backend for uploads, grants, credential lifecycle, report writes, revocation, and Trial Explorer. Prepared document renditions isolate browser behavior from OCR. External-app tests load the shipped HTML/CSS/JS with every network response intercepted; they cover UI interactions without calling classifiers or model providers. A simulated first-request failure verifies the patient Retry action. HTML results, screenshots, and failure traces stay in ignored `playwright-report/` and `test-results/`.

Local operation is the current deliverable. A later persistent Linux server can host Next.js, a single worker, SQLite, and private durable files behind HTTPS. It needs tested proxy/cookie settings, restrictive ownership, supervised processes, disk monitoring, backup/restore, and appropriate deployment/security review. Do not place this SQLite vault on ephemeral Vercel storage. The full path is in [PLAN.md](docs/PLAN.md#later-persistent-server-deployment).

Source publication to [kleongf/carevault](https://github.com/kleongf/carevault) is authorized. Publishing source does not deploy the app or publish the local vault. Never commit environment secrets, passwords, tokens, uploads, databases, checkpoints, or private backups.

This work is maintained on `carevault-records-and-integrations`; publishing it does not modify remote `main`. The working-machine login guide is private at `data/demo-logins.txt` when provisioned; it is excluded from Git. New checkouts generate their own credentials.
