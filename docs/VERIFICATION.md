# Verification and handoff

Verified on 2026-10-03, macOS arm64, Node 26.8.1. Node 24 is the recommended team runtime; this run did not separately validate Node 24. Runtime requirement is Node 22.13+ with built-in SQLite.

## Completed checks

- `npm test`: 19 passed, none failed or skipped. Tests use temporary on-disk SQLite stores and the actual HTTP handler.
- `npm run typecheck`: passed.
- `npm run build`: passed using Next.js 16.3.8 and webpack; no external fonts or model calls.
- `git diff --check`: passed.
- Headless Chrome against the production server on `127.0.0.1:3040`: owner login, permission preview, connection save, actual read/redaction, prepared report save, reload persistence, revoke, denied subsequent read, and activity view passed.
- Browser viewports: 1440×1050 and 390×844. Desktop hub, permission panel, and mobile hub screenshots inspected; no horizontal mobile overflow or browser page errors. Keyboard/screen-reader and cross-browser accessibility audits were not performed.
- Independent focused security review: no actionable findings within the local synthetic-data scope. This does not constitute a production security assessment or compliance certification.

The browser run exposed Next.js URL hostname normalization interfering with same-origin checks. The fix checks Origin against the actual Host and request protocol; two regression tests cover legitimate normalized requests and mismatched origins. The corrected flow was rerun successfully.

## Behaviors proven by tests

Owner/integration credential separation; session integrity and CSRF checks; structured and partial-note redaction; private-topic omission; individual restrictions; inheritance through source references and summaries; malformed/cyclic/cross-patient dependencies; patient isolation; independent read/file/write scopes; server-assigned report authorship; untrusted reports kept private; receipt ownership and source validation; prepared report inheritance; preview parity; revocation; historical activity retention; SQLite restart persistence; current-policy plain-text downloads; refusal to serve unsupported originals; bounded input; and prompts unable to change deterministic policy.

## Storage and deployment

Fresh setup seeds the local database and creates credentials. There is no existing production schema migration. Keep `data/` out of Git and retain its credentials and database together when backing up. Stop the server before copying the entire directory. To start a fresh synthetic demo, stop the server and move `data/` to a private backup location, then rerun setup. Do not erase it if you want to retain grants or reports.

This handoff runs locally. Public hosting, hosted storage, multi-instance consistency, account recovery, production token rotation, encrypted backups, and operations are not implemented. Do not deploy the SQLite store on an ephemeral Vercel filesystem. The repository has no configured Git remote.

## Deliberate limits

- Three registered application slots and a shared API, not functioning imaging, trial, or formulation integrations.
- Prepared sensitivity labels, source relationships, text spans, and medical examples. No arbitrary-file ingestion, OCR, DICOM processing, general PII detection, clinical inference, or autonomous memory learning.
- Conservative report inheritance uses every item in its read receipt. A report can be withheld even when its visible text seems harmless. External reports always remain private pending a review workflow that is not yet implemented.
- The activity UI shows reference IDs and policy versions. Exact historical payload replay is not implemented.
- The vault prevents future releases after revocation; it cannot delete copies already held by an integration.
- Local authentication and permissions demonstrate the boundary. No HIPAA compliance claim; the production assessment path remains in PLAN.md.
- Browser test artifacts and the disk audit are in the parent `outputs/` directory. The browser check left one prepared report and revocation history in the local synthetic vault; a fresh clone seeds a clean vault.
