# CareVault implementation plan

Updated October 3, 2026. This is the approved redesign, not a claim that every acceptance check is complete. [VERIFICATION.md](VERIFICATION.md) separates evidence from remaining work.

## Product boundary

CareVault is a private record store and permission gateway. The patient uploads documents, sees originals/extracted text/redacted exports, selects what apps may read, and receives attributed reports. Medical analysis and chat belong to separate integration apps.

The patient workspace has **Records, Apps, Activity**. The separate developer workspace has **My apps, API setup**, with registration, app editing, and credential management. Two seeded username/password accounts have distinct server-enforced roles. Public signup, password-reset UI, and a recovery command are excluded from this implementation.

Uploads support text PDFs, scanned PDFs, PNGs, and JPEGs. There is no DICOM ingestion, fact proposal, extraction LLM, review workflow, manual redaction editor, or new clinical-topic redaction feature. The extracted text is an unverified transcription, not a normalized clinical knowledge graph.

## Architecture and state

Keep Next.js/React/TypeScript/shadcn, SQLite, private filesystem storage, and one persistent Python worker. Avoid adding a graph/vector database or hosting abstraction for this local demo.

- **Identity:** patient/developer account hashes, persisted expiring sessions, separate app bearer credentials.
- **Developer app:** owner, directory description, URL, declared capabilities, credential state. App registration does not grant patient access. Changing destination disconnects existing grants; removing capabilities narrows grants.
- **Document:** UUID, fixed patient owner, title, MIME, kind, processing status, redaction profile, private original, generated renditions, provenance, source dependencies.
- **Job:** persisted queued/processing/ready/failed state, attempts, lease and recovery. File publication completes before `ready` is exposed.
- **Grant:** connected state, version, report-write permission, selected record IDs with independent text/redacted/original booleans.
- **Receipt:** app, patient, grant version, record, representation, timestamp. The backend creates receipts only after authorized content reads.
- **Report:** attributed unverified text record, receipt references, and conservative dependencies. It is processed like a document and starts unshared.

The private server/worker can read plaintext. This is ordinary trusted-server access control, not end-to-end encryption or a system that can govern data after an external recipient receives it.

## Processing

Native PDF text uses Docling's native path. Scanned/image-containing pages use OCR with local Tesseract and pinned Docling layout artifacts. Automatic identifier detection uses Presidio plus explicit patterns/known patient values. It generates separate redacted text and pixel-only PDF/PNG exports. Original hidden PDF content and metadata must not survive redacted export construction.

`identifiers` covers identifier categories; `healthcare` additionally detects dates. Neither is labeled a HIPAA-compliance mode. Detection and OCR have false negatives and false positives. The owner can inspect the actual extracted text and redacted file, without an acceptance checklist or manual editor.

Benchmark native, scanned, mixed, and photo inputs before claiming latency. Keep warm models in a persistent child to avoid repeating startup per upload. Bound file size, page/pixel counts, output size, memory/time exposure, job retries, and disk capacity. Missing models, corrupt input, empty scanned-page extraction, or partial conversion fail safely. See [worker behavior, measurements, and known transcription limits](../worker/README.md).

## Permission semantics

1. The developer registers an app and obtains a credential once.
2. The patient connects it from the app directory and selects specific records/representations. New records are never automatically included.
3. The API checks the app's capability and the current patient grant on every read. Integration text always comes from `redacted.txt`; explicit original-file access is separate.
4. The API returns only authorized record descriptors, without private titles or counts of hidden records.
5. Each content read produces a receipt. Report writes require current app-bound receipts and report permission.
6. Report dependencies include all known historical v2 disclosures to that app, preventing the app from removing source restrictions by omitting a receipt. A receiving app must have corresponding source-representation access too.
7. New reports are unshared and unverified. Saving a report is not clinical approval or fact acceptance.
8. Revocation stops later reads/writes. It cannot recall copies held by an integration or provider.

Conservative dependency inheritance can keep a report inaccessible even if its visible wording appears harmless. Report provenance that is missing, cyclic, cross-patient, or dependent on incomplete legacy history fails closed.

## Demo data and external apps

The fictional Alex Morgan respiratory story has an intake, visit note, illustrative lab report, scanned-PDF variant, and photo variant. Existing legacy facts and their restrictions are preserved. The new demo importer is explicit, additive, hash-aware, and does not modify grants.

Three NIH research images are downloaded individually through bounded ZIP byte ranges, not a full archive. Preserve subject IDs, original filenames, revision, labels, hashes, and attribution in `demo/nih-manifest.json`. They are not images of Alex Morgan. Labels are text-mined research annotations, and the samples do not establish clinical model accuracy.

**Chest X-ray Review (3041):** a separately authenticated local app retrieves an authorized image, runs the official pretrained TorchXRayVision model, sends classifier scores to an explicitly selected free OpenRouter model, rechecks current access, and saves a source-linked unverified report on request. Evaluate real preprocessing/runtime/output and original-versus-redacted behavior before claiming the demo works. Scores are not calibrated probabilities or cancer diagnoses.

**Medicine app (3043):** a separate OpenRouter wrapper reads selected authorized text and drafts a medicine-related response/report. It uses `text:read` and `reports:create`, with its own server-side token, provider key, and local app login. No medicine chatbot belongs in CareVault navigation. Its implementation/test status must be recorded separately from the X-ray app.

No app may silently fall back to paid models, fictional inference, or another provider model. Provider-free availability is a runtime constraint, not a guarantee from an old price listing.

## Migration

Store initialization adds role accounts and new registrations without resetting existing data. Old fact/source records, grants, and restrictions remain in place; they are not silently converted into uploaded PDFs. Authenticated legacy APIs remain for compatibility, including old chat code, while the new UI omits them.

New developer apps are marked v2-only. Disconnecting an app must disable both API generations. Reports written by legacy apps stay owner-only because earlier file/report disclosures were not fully receipted; do not manufacture provenance to widen them.

## Delivery ledger

| Area | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Roles, sessions, developer lifecycle | 52 Node tests; both role logins and developer registration/edit fields/API setup in browser | Credential modal inspected; lifecycle API-tested |
| Uploads, grants, receipts, reports | Eight seeded records processed; real browser PDF upload; both apps' report/save/revoke flow; queued-job restart passed | Image preview verified |
| Patient/developer UI split | PDF.js original/redacted canvas and text verified; developer 390px view has no horizontal overflow | Patient 390px view and final interaction checks passed |
| Docling/OCR/redaction | 22 tests including real runtime; six benchmark fixtures; restart/corrupt-input check passed; known over-redaction documented | No general accuracy claim; final handoff |
| Demo documents and NIH images | Provenance/hash evidence; second seeding run imported zero | Patient NIH image/provenance preview verified |
| X-ray integration | 14 tests, 30 real inferences, live free-model/browser writeback and revocation | Local demo verified; no clinical validation |
| Medicine integration | 21 tests, live free-model/browser writeback and revocation | Local demo verified; no clinical validation |
| Migration and restore | Isolated restore/migration preserved 96 existing stored records | Preserve final private backup; no automated backup claim |
| Publishing | Authorized source remote | Final secret/diff checks and normal push |

Do not treat this table as completion evidence for future changes. Update it only after examining the relevant current output.

## Later persistent-server deployment

A simple single-host deployment can retain this architecture:

1. Provision a persistent Linux host with adequate disk/RAM for Node, SQLite, document/model artifacts, and processing scratch space. Install the pinned Python dependencies, English OCR, and explicit models; verify a representative workload.
2. Run Next.js and one worker as supervised services under a dedicated unprivileged account. Keep the vault and secrets outside any public web directory. Use restrictive directory/file ownership; loopback listeners remain behind the proxy.
3. Put an HTTPS reverse proxy in front of the intended app. Configure and test scheme/Host forwarding so Origin checks and Secure session cookies behave correctly. The example apps are loopback demo servers, not public production servers; harden/replace their Basic-auth hosting before exposing them.
4. Set consistent absolute data/model paths through the service environment. Next `.env.local` behavior does not automatically configure Python processes. Keep app/provider secrets separate from patient-facing code and public assets.
5. Add disk monitoring, job failure monitoring, access/credential operations, dependency updates, and a documented operator recovery procedure. Two shared demo accounts are not a multi-tenant healthcare identity system.
6. Back up consistently: stop web/worker/integration writers, copy the entire private vault (credentials, SQLite plus sidecars, documents), preserve ownership, and restart. Test restore into an isolated private directory. Keep backup encryption, retention, and access controls under operator management; they are not implemented by the app.
7. Re-run upload/extraction/export/permission/report/revocation tests after restore and after proxy configuration. Confirm restart recovery and actual persistence.

Do not run this vault on ephemeral Vercel filesystem storage. Horizontal scaling, durable managed object storage, distributed jobs, automated backups, account recovery, and healthcare operations are separate future work. Before any identifiable healthcare deployment, assess applicable legal roles, vendor contracts, threat/security controls, redaction quality, clinical risks, and incident procedures. Current filesystem permissions are not an encryption-at-rest or compliance claim.

## Concurrent Trial Explorer contribution

Remote commits `397f9bc` and `e2e0072` introduced Trial Explorer during redesign verification. Preserve its synthetic matching, one-use fact approvals, APIs, tests, and styles. Its UI lives separately at `/trials` with patient-role authentication and the existing legacy permission editor; Records/Apps/Activity remain the main patient navigation. Trial Explorer continues to use legacy structured facts, not uploaded document text.
