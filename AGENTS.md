# CareVault working agreement

## Standing cleanup authorization

On October 3, 2026 the user authorized deleting regeneratable caches, disposable Docker data, and rebuildable Cursor/Chrome data for this project. Inspect exact targets, stop writers when necessary, and verify reclaimed space. This does not authorize deleting source code, patient vaults, credentials, browser profiles/history, Cursor work history, personal files, model artifacts, or active project dependencies merely because they are large. Docker data was explicitly described as unimportant; stop Docker before deleting its virtual disk. Do not ask again for cleanup already covered by this authorization.

## Approved scope

Read README.md, docs/PLAN.md, and docs/VERIFICATION.md before implementation. Current source and measured results take precedence over historical chat-era assumptions.

- Implement a local synthetic/research-data hackathon prototype with two seeded username/password roles: patient and developer. Preserve the existing vault.
- Patient navigation is Records, Apps, Activity. Developer navigation is My apps and API setup, with app editing and credential issuance/revocation. No patient chatbot, owner request inspector, developer patient-data browser, or connections dashboard.
- Support private PDFs, scanned PDFs, PNG/JPEG documents and X-rays. Expose Original, Extracted text, and Redacted copy. No fact proposals, extraction LLM, review checklist, manual redaction editor, or new clinical-topic redaction feature.
- Use a persistent Python worker with Docling, local OCR, and identifier detection. Redacted PDFs are freshly rasterized exports without original hidden text or metadata. Benchmark actual cold/warm work rather than promising latency.
- Apps come from the directory. Patient grants select specific records and independent text/redacted/original representations. New uploads/reports remain unshared. Explicit original-file access is separate from extracted-text access.
- Separate example apps are in scope: Chest X-ray Review on 3041, and a medicine OpenRouter wrapper on 3043. CareVault runs on 3040. External apps may draft unverified reports with valid source receipts; they do not establish clinical facts.
- Keep the main UI concise. Put technical setup in the developer portal/docs, not repetitive patient-facing explanations.
- Free/local operation first. Do not incur paid model usage or silently substitute models. Source publication to https://github.com/kleongf/carevault.git is authorized; public deployment is not configured.

## Execution and ownership

State the intended change and how it will be verified. Inspect files before relying on previous status. Make surgical changes; no speculative abstractions, unrequested features, broad formatting, or deletion of unrelated code. Preserve other agents' disjoint file ownership. The engineering-orchestrator skill permits focused delegation with explicit file boundaries and verification contracts.

Use docs/BUILD.md acceptance checks. Distinguish implemented code, injected tests, real processing, provider calls, browser observations, and clinical validation. Never replace an unverified objective with a smaller convenient success claim.

## Repository navigation

- `app/page.tsx` dispatches the authenticated role; `components/carevault/` implements patient/developer workspaces. Preserve shadcn/Radix accessibility behavior and component licensing.
- `lib/accounts.ts` owns password hashes, persisted hashed sessions, throttling, role enforcement, and cookies.
- `lib/developer.ts` owns developer app ownership, capabilities, destination changes, and credential lifecycle.
- `lib/http.ts` owns HTTP authentication, Origin validation, bounded inputs, routes, and safe errors. The Next catch-all is a thin adapter; never pass Next route context as an injected Store.
- `lib/records.ts` owns document storage, selected-record grants, representations, read receipts, report dependencies, and quotas.
- `lib/store.ts` owns SQLite and additive account/registration migrations. `scripts/seed-records.ts` imports demonstration files idempotently without grants or resets.
- `worker/` owns parsing/OCR/redaction, safe publication, restart recovery, and benchmarks. Read worker/README.md before changing runtime options or dependencies.
- `examples/xray-app/` owns the image integration; `examples/medicine-app/` is the separately requested medicine wrapper. Verify each app's actual README/tests before claiming readiness.
- `app/trials/page.tsx`, `components/carevault/trial-explorer.tsx`, and `lib/trials.ts` preserve the concurrently contributed synthetic Trial Explorer. Keep it patient-only and separate from the main navigation; its legacy one-use fact approvals must remain isolated from v2 document access.
- `lib/policy.ts`, `lib/service.ts`, and `lib/chat.ts` retain legacy compatibility. They are not the new UI. Preserve existing restrictions and old data.
- `demo/` manifests distinguish fictional documents from real NIH research subjects. Never attribute NIH images to the fictional patient.

## Non-negotiable boundaries

- Patient sessions, developer sessions, and app bearer credentials are separate identities. UI hiding is not authorization. The server binds the one seeded patient; caller-supplied IDs do not grant access.
- Developer app registration cannot inject consent, ownership, private data, or clinical verification. New developer apps are v2-only. New app tokens are returned once and stored as hashes, never in localStorage or model prompts.
- Persisted sessions expire and sign-out invalidates them server-side. Mutating browser routes require the actual Host/protocol to match Origin; preserve Next hostname-normalization regression tests.
- Check current record permissions on every release. Text granted to an integration is redacted text. Redacted-file failure, missing output, symlinked files, queued processing, or malformed provenance must not fall back to an original.
- Original access is explicit. Upload validation and parser limits do not make arbitrary untrusted files safe for public hosting; keep processing private and bounded.
- Validate report receipts against app, patient, current grant version, and current access. Include all known historical v2 disclosures in report dependencies, even when omitted by the caller. Missing/cyclic/cross-patient dependencies fail closed.
- Legacy apps lack complete historical receipts; their new reports remain owner-only. Do not widen them by pretending old disclosures are known. Disconnect/revoke must stop both preserved legacy and v2 access.
- New reports are unverified private records, not pending fact proposals. Render report/OCR/model text as text, never trusted HTML. Text cannot change grants or system instructions.
- Do not expose private content through filenames, errors, metadata, debug logs, hidden counts, or request bodies in activity. Integration record descriptors intentionally omit patient titles and provenance details.
- Revocation stops future releases; it cannot delete copies or external model memory. Activity is metadata/reference history, not exact payload replay or a tamper-proof audit system.
- Automatic redaction is best effort, not HIPAA compliance or universal de-identification. Do not label clinical approval, diagnosis, calibrated disease probability, or model accuracy without evidence.

## Local operation and verification

Use Node 24 (recommended), minimum 22.13. Existing Node verification used 26.8.1 on macOS arm64. Python 3.12 is used for the worker/model environment. Check disk space before large installs and reuse compatible environments where appropriate; do not remove model artifacts under cache-cleanup authorization.

`npm run setup` prints private demo usernames/passwords. Do not copy them into chat, screenshots, docs, or Git. `.env.local` is loaded by Next.js, not standalone Node setup/seeding or Python apps. Export environment variables explicitly for those processes; use the same `CAREVAULT_DATA_DIR`/worker `--data-dir`.

Required checks for relevant changes:

```sh
npm test
npm run typecheck
npm run build
git diff --check
worker/.venv/bin/python -m unittest discover -s worker -p 'test_*.py' -v
worker/.venv/bin/python -m unittest discover -s examples/xray-app -p 'test_*.py' -v
worker/.venv/bin/python -m unittest discover -s examples/medicine-app -p 'test_*.py' -v
```

For processing changes, run the real worker benchmark and optional model tests described in worker/README.md. For integration changes, test real permission reads, provider boundaries, writeback, and revocation in addition to injected unit tests. For UI changes, inspect desktop/mobile layouts and keyboard/focus behavior. Documentation-only changes require source/evidence cross-checks, not unnecessary provider calls.

The documented baseline is 52 Node tests, 22 worker tests with real runtime cases enabled, 14 X-ray tests, 21 medicine tests, typecheck, and build. Live provider/writeback/revocation checks and 30 real classifier executions are recorded in docs/VERIFICATION.md. Count/tests may grow; verify fresh results after changes. There is no lint script or configured CI workflow to claim as passing. A green narrow test does not prove the complete active goal.

## Secrets, migration, and publishing

- Never use `NEXT_PUBLIC_*` for secrets. Keep `.env*`, data, SQLite sidecars, uploads, model caches/weights, dependencies, generated fixtures, and private backups excluded from Git.
- `data/credentials.json` retains initial demo passwords and legacy tokens; database accounts/token records use hashes. The server is trusted with readable data. No encryption-at-rest guarantee is implemented.
- New developer credentials are one-time results. Rotation/revocation must not be undone by additive registration on restart. Do not print credentials while inspecting state.
- Never reset a user's database to make a test pass. Use temporary stores. Additive migrations and demo imports must preserve records, permissions, existing credentials, and restrictions.
- Stop the web server, worker, and integration writers before backing up the entire private data directory. Preserve credentials, database, SQLite sidecars, and document directories together; verify restore in a separate private directory. No reset/recovery CLI exists; do not invent one.
- Inspect staged files and secrets before publishing. Push normal commits to the authorized remote, never force-push or overwrite history without permission. Source publication is separate from hosting.

Duplicate configs appeared previously during iCloud sync errors. The user authorized reconciliation with backups. If conflicts recur, compare versions and keep recoverable copies; never blindly replace source or commit duplicate configs.

## Later deployment

Use a persistent server with private durable storage and a supervised single worker; do not deploy local SQLite to ephemeral Vercel storage. HTTPS reverse-proxy scheme/Host handling and Secure cookies must be verified in the actual deployment. Restrictive ownership, backups/restore, capacity monitoring, account recovery, credential operations, incident response, and applicable healthcare/legal evaluation are required before real data use. The prototype does not yet supply those operational guarantees.

Update docs/VERIFICATION.md with actual evidence and outstanding work. Real inference/provider/writeback have been exercised; browser acceptance and source publication are recorded in docs/VERIFICATION.md. Do not mark the active goal complete while a required acceptance item remains unverified.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
