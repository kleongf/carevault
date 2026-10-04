# Verification and handoff

Verified on 2026-10-03, macOS arm64, Node 26.8.1. Node 24 is the recommended team runtime; this run did not separately validate Node 24. Runtime requirement is Node 22.13+ with built-in SQLite.

## Completed checks

- `npm test`: 29 passed, none failed or skipped. Tests use temporary on-disk SQLite stores and the actual HTTP handler.
- `npm run typecheck`: passed.
- `npm run build`: passed using Next.js 16.3.8 and webpack; no external fonts or model calls.
- `git diff --check`: passed.
- Headless Chrome against the production server on `127.0.0.1:3040`: owner login, permission preview, connection save, actual read/redaction, prepared report save, reload persistence, revoke, denied subsequent read, and activity view passed.
- Browser viewports: 1440×1050 and 390×844. Desktop hub, permission panel, and mobile hub screenshots inspected; no horizontal mobile overflow or browser page errors. Keyboard/screen-reader and cross-browser accessibility audits were not performed.
- Independent focused security review: no actionable findings within the local synthetic-data scope. This does not constitute a production security assessment or compliance certification.

The browser run exposed Next.js URL hostname normalization interfering with same-origin checks. The fix checks Origin against the actual Host and request protocol; two regression tests cover legitimate normalized requests and mismatched origins. The corrected flow was rerun successfully.

## Behaviors proven by tests

Owner/integration credential separation; session integrity and CSRF checks; structured and partial-note redaction; private-topic omission; individual restrictions; inheritance through source references and summaries; malformed/cyclic/cross-patient dependencies; patient isolation; independent read/file/write scopes; server-assigned report authorship; untrusted reports kept private; receipt ownership and source validation; prepared report inheritance; preview parity; revocation; historical activity retention; SQLite restart persistence; current-policy plain-text downloads; refusal to serve unsupported originals; bounded input; and prompts unable to change deterministic policy.

## Chat verification

Ten additional tests use injected provider responses to verify owner/CSRF protection, memory-only keys, additive registration migration, projected context, the fixed requested model, bounded conversation history, reset after changed permissions, rejection of stale replies after mid-request revocation, explicit sanitized provider failures, and concurrent-request limits. No API key or real provider is used by the test suite.

The shadcn refresh was rebuilt successfully. The browser retained the demo owner session after restart, displayed the in-app key form, and previewed 14 permitted companion records with redacted identifiers and no private-topic text. The user connected Health companion in the UI and saved an OpenRouter key in ignored .env.local through TextEdit. A live developer-inspector read returned the expected 14 records. Before the requested model switch, a real chat call returned a concise answer about the synthetic care preferences, attributed to nvidia/nemotron-3-ultra-550b-a55b:free.

The initial live response exposed a provider reasoning draft; the initial router fix disabled/excluded reasoning, asked for a final answer, and rejected truncated completions. One subsequent request encountered free-model unavailability before a successful retry. The original free router was variable; this demonstrates an operational integration, not clinical validation. Automated provider-boundary tests continue to use fake transport.

The requested switch to `stealth/space-bunny-alpha` was verified with a live browser reply about the four synthetic care preferences, attributed to that exact model, using 14 permitted memory items. The provider requires reasoning to be enabled; the request enables it but excludes reasoning from the response. The 29 tests, type check, and production build passed after this adjustment. The model listing announces retirement on October 5, 2026; no automatic fallback is configured.

Config files reverted during the session while iCloud reported sync errors. With user approval, newer duplicate versions were restored to canonical filenames and both versions preserved in the adjacent carevault-config-backup-20261003-152643 folder. Type checks and the 29 tests were rerun after reconciliation.

## Storage and deployment

Fresh setup seeds the local database and creates credentials. There is no existing production schema migration. Keep `data/` out of Git and retain its credentials and database together when backing up. Stop the server before copying the entire directory. To start a fresh synthetic demo, stop the server and move `data/` to a private backup location, then rerun setup. Do not erase it if you want to retain grants or reports.

This handoff runs locally. Public hosting, hosted storage, multi-instance consistency, account recovery, production token rotation, encrypted backups, and operations are not implemented. Do not deploy the SQLite store on an ephemeral Vercel filesystem. The requested source remote is https://github.com/kleongf/carevault.git; source publication does not deploy the application.

## Deliberate limits

- Three medical application slots plus a live Health companion chatbot registration and a shared API. The imaging, trial, and formulation applications remain unimplemented.
- Prepared sensitivity labels, source relationships, text spans, and medical examples. No arbitrary-file ingestion, OCR, DICOM processing, general PII detection, validated clinical inference, or autonomous memory learning. The chatbot generates unverified educational responses using authorized context.
- Conservative report inheritance uses every item in its read receipt. A report can be withheld even when its visible text seems harmless. External reports always remain private pending a review workflow that is not yet implemented.
- The activity UI shows reference IDs and policy versions. Exact historical payload replay is not implemented.
- The vault prevents future releases after revocation; it cannot delete copies already held by an integration.
- Local authentication and permissions demonstrate the boundary. No HIPAA compliance claim; the production assessment path remains in PLAN.md.
- Browser test artifacts and the disk audit are in the parent `outputs/` directory. The browser check left one prepared report and revocation history in the local synthetic vault; a fresh clone seeds a clean vault.

## Trial Explorer update

Verified on 2026-10-03 on Windows with Node 24.21.0 after adding the synthetic Trial Explorer workflow:

- `npm test`: 31 passed, none failed or skipped.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- An isolated production-server HTTP check used a temporary SQLite vault and verified: a private medication fact starts unknown; an owner approves a single-use request; the bearer-authenticated use returns that fact once; a second use returns 409; later matching reports the criterion as unknown; and the saved medication grant remains Private.
- Authenticated desktop/mobile screenshots were not captured for this update. The browser session was left at owner login rather than passing the private owner access code into browser automation.

The new comparisons are deterministic predicates over current shared facts and three synthetic study entries. They do not use an LLM, external trial registry, or real eligibility criteria. The explicit one-time owner approval is bound to the integration, study, fact version, and policy version, expires after 15 minutes, and does not modify the saved grant.
