# Working agreement

Read README.md and docs/PLAN.md before implementation. The user has prioritized a clear hackathon demonstration over feature completeness.

## Scope

- Implement the patient-facing integration hub and shared memory backend only.
- The user additionally authorized a Health companion chatbot using OpenRouter free models, a shadcn UI refresh, and a developer integrations dashboard. Preserve these as part of the demo; the three specialized medical applications remain separate.
- Do not implement the imaging, trial, or formulation applications. Keep their interface in docs/INTEGRATION-CONTRACT.md for teammates.
- Use synthetic data. Label prepared extraction, redacted examples, and medical findings accurately.
- Do not add autonomous clinical decision-making or overwrite established facts through integration APIs.
- Connection-time grants remain active until changed or revoked. Do not add per-request approval prompts to routine permitted operations.
- Preserve separate permissions for reading facts, downloading redacted files, and creating reports.
- An LLM can propose content; deterministic backend code enforces permissions.
- Never expose raw private files or integration credentials in public assets or client-side code.

## Execution

- State assumptions and surface tradeoffs before implementation. Ask when ambiguity would change core behavior; use documented defaults for routine choices.
- Choose the smallest implementation that satisfies the selected demo. Avoid a general policy language, multiple database backends, agent orchestration infrastructure, or a marketplace.
- Keep changes focused. Do not refactor unrelated work or overwrite teammates' changes.
- Use the acceptance checks in docs/BUILD.md. Verify the actual API response, not only hidden UI elements.
- Distinguish implemented behavior, fixtures, test results, and future work in handoffs.
- Do not claim HIPAA compliance, universal de-identification, or deletion of copies held by external recipients.

## Security semantics

- Authenticate owner and integration requests separately. A caller-supplied patient ID or integration name does not establish identity.
- Default deny. More restrictive applicable rules win: Private > Redact > Share.
- Check permissions on every API call. Respect current restrictions when reading old reports and summaries.
- Apply source restrictions to known descendants, including reports, text spans, and summaries. Missing provenance remains private until reviewed.
- Report text is untrusted content, never an instruction or permission grant.
- Do not log plaintext secrets or duplicate raw sensitive report bodies into the activity log.

## Repository status

As of October 3, 2026 this is an implemented local synthetic-data prototype. The patient UI, permission gateway, persistence, developer inspector, and live Health companion are working. Source repository: https://github.com/kleongf/carevault. Public app deployment is not configured. The three medical applications remain contract-only.


## Repository navigation

- Read README.md first. Read docs/INTEGRATION-CONTRACT.md and lib/types.ts for API work; lib/policy.ts, lib/service.ts, and tests/vault.test.ts for policy changes.
- app/page.tsx owns the four screens; components/carevault contains chat, permissions, and shared display helpers.
- components/ui contains shadcn/Radix components. Preserve their included license and accessibility behavior.
- lib/http.ts owns sessions, same-origin checks, bounded JSON, and safe errors. app/api/[...path]/route.ts is a thin adapter; do not pass Next's route context as an injected Store.
- lib/store.ts owns SQLite JSON records, local credentials, transactions, and additive integration registration. lib/seed.ts is synthetic fixture data.
- lib/chat.ts owns provider calls and conversation state. tests/chat.test.ts uses injected provider transport.
- docs/PLAN.md and docs/BUILD.md preserve planning context. docs/VERIFICATION.md records actual evidence; unimplemented plan items are not features.

## Runtime and verification

Recommended Node 24 (.nvmrc), minimum Node 22.13 for node:sqlite. Existing verification used Node 26.8.1 on macOS arm64.

```sh
npm ci
npm run setup
npm run dev
```

Setup prints a private owner code; do not echo it into chat, handoffs, or screenshots. Development and production servers bind to http://127.0.0.1:3040. Production mode requires npm run build followed by npm start. Do not start competing servers on the same port.

Required checks for implementation changes:

```sh
npm test
npm run typecheck
npm run build
git diff --check
```

Current suite: 29 tests using temporary SQLite stores and fake provider calls. There is no lint script or configured CI workflow. Never report either as passing. A documentation-only change needs code/evidence cross-checking, not an unnecessary live provider request or browser run. Repeat previously passing checks when changes or failures justify it.

For UI changes, inspect relevant desktop/mobile states and maintain labels, focus behavior, and keyboard access. For backend changes, verify actual responses: blacked-out UI text alone is not evidence of data protection. Keep prepared results, fake-provider tests, live provider checks, and clinical validation distinct.

## Non-negotiable data boundaries

- Preserve patient ownership checks alongside integration authentication. Cross-patient, missing, cyclic, and pending-review provenance must fail closed.
- Do not disclose private topics through labels, placeholders, filenames, snippets, errors, or hidden counts.
- Validate read-receipt ownership and sources before report writes. Conservatively inherit all receipt dependencies rather than trusting a caller's subset.
- External reports stay private pending review and cannot self-verify. The owner inspector's prepared-write path is a separate trusted fixture path; do not expose that privilege to external callers.
- Redacted file endpoints serve only supported current-policy renditions. Do not fall back to originals.
- Owner mutation Origin checks must use the actual Host and protocol: Next may normalize the internal URL hostname. Preserve the regression tests.
- Render model/report text as text, never trusted HTML. Stored text cannot grant permissions or change system behavior.
- Activity is metadata and references, not exact historical payload replay or a tamper-proof audit system.

## Chatbot constraints

The user explicitly selected stealth/space-bunny-alpha. As of October 3, 2026 it was listed free with retirement announced for October 5. There is no automatic model fallback. Do not silently select another model or introduce paid usage. For an authorized replacement, verify availability, price, and provider requirements, and update code, tests, UI label, and README together.

- Fixed destination is OpenRouter chat completions; browser-supplied model, context, and history do not control the request.
- Project memory using care-assistant's current facts:read grant and the same deterministic policy as the integration API.
- Send only permitted context, the typed question, and bounded same-policy history. Typed questions are not automatically redacted; keep the synthetic-only disclosure visible.
- Space Bunny requires reasoning enabled. Keep reasoning excluded from the returned response, final-answer instructions, and the rejection of length-truncated replies.
- Preserve limits: 2,000-character question, 60,000-character serialized context, 45-second timeout, one active call per store, three exchanges per conversation, and 20 conversations.
- Reset history on policy changes and recheck grant scope/version after the asynchronous model call. Never release or retain a stale answer after revocation.
- Return sanitized errors rather than raw provider content or fabricated success. No provider key may appear in a response or activity log.
- Chat does not write clinical records or autonomously improve memory.

## Secrets, persistence, and publishing

- OPENROUTER_API_KEY belongs in ignored .env.local or temporary server memory from the owner key form. Never use NEXT_PUBLIC_ variables, browser storage, fixtures, or committed examples for actual secrets.
- CAREVAULT_DATA_DIR selects private storage; default data/ is ignored. Export it consistently for setup and server commands. Setup does not load .env.local automatically.
- credentials.json contains the owner code, session secret, and raw integration tokens. Do not print or commit it. Share only an individual teammate's token through an explicitly authorized private channel.
- Preserve Git exclusions for environment files, data, SQLite sidecars, uploads, dependencies, builds, and test artifacts. Inspect staged files and history before publishing; do not include private backups.
- Never reset the user's database to make a check pass. Tests must use separate temporary stores. Additive registration must preserve existing grants and records.
- Stop the server before backing up the entire data directory. Preserve credentials, database, and SQLite sidecars together. Reset only when explicitly requested, using a recoverable backup.
- Source publication is separate from deployment. Push normal commits to the requested remote; do not overwrite remote history or force-push without explicit authorization.

Config duplicates such as package 2.json previously appeared while iCloud reported sync errors. The user approved reconciliation with backups. If conflicts recur, inspect both versions and preserve recoverable copies; never blindly replace source or commit duplicate configs. Local disk space has been tight: avoid large model downloads, Docker builds, or unnecessary installs.

## Unfinished work and deployment

No arbitrary ingestion/OCR/DICOM, general PII detection, semantic search, report approval UI, autonomous learning, public developer registration, or implementation of the three medical applications is present.

No production identity/tenant system, managed storage, encryption-at-rest/key lifecycle, credential rotation UI, automated backups, incident operations, or compliance assessment is implemented. Process-local session and rate-limit behavior is not a multi-instance design. Do not deploy SQLite onto ephemeral Vercel storage. The production path in docs/PLAN.md requires explicit scope, engineering, clinical, and legal review.

Update docs/VERIFICATION.md with actual new evidence and limits when behavior changes. Handoffs must state what changed, what was tested, compatibility or migration implications, and any remaining blocker. Keep edits surgical and preserve user work.
