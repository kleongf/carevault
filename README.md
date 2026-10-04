# CareVault

A patient-controlled memory layer and integration hub for healthcare AI.

**Status (October 3, 2026): working local hackathon prototype.** The patient hub, developer dashboard, permission gateway, selected redaction, persistent reports, and OpenRouter chatbot are implemented. All patient data is synthetic. Imaging, trial, and formulation applications and arbitrary document processing are not implemented.

## Run locally

Use Node 24 (`.nvmrc`); Node 22.13+ with `node:sqlite` is required. No database service or API key is needed for the core vault; live chat requires an OpenRouter key.

```sh
git clone https://github.com/kleongf/carevault.git
cd carevault
npm ci
npm run setup
npm run dev
```

Open http://127.0.0.1:3040 and enter the owner access code printed by setup. Re-running setup preserves the vault and displays the same code. `npm run build && npm start` runs the production build locally.

SQLite and generated credentials live in the ignored `data/` directory. Keep this directory private. Integration tokens are in `data/credentials.json`; give each teammate only their integration's token through a private channel. Never put these tokens in browser code. The UI's owner-only inspector needs no integration token.

The server binds to loopback. Do not expose this prototype publicly or load real health information. Local file permissions are implemented; encryption at rest, production accounts, credential lifecycle, backups, and healthcare compliance operations are not.

## Try the demonstration

The shadcn UI separates **Chat**, **My memory**, **Connected apps**, and **Developers**. Developers contains the registered applications, API examples, request inspector, and access history. It is an authenticated owner sandbox, not a public developer account system; tokens remain in the local credentials file.

1. In Connected apps, connect **Scan Review**, keeping identity Redact and mental health Private. Preview and save the grant.
2. Select it in the Developers **Request inspector** and run a read. Inspect the actual JSON: identifiers are replaced and private-topic text is absent.
3. Save a fixture report, then find it in **My memory**. Its content is prepared; permission checks, authorship, and persistence are live.
4. To demonstrate inherited protection, first share identity and mental health, read again, and save a report. Then make **Private health note** Private in My memory. Later requests omit its summary and dependent reports, even when Notes/Reports remain Share.
5. Revoke access and repeat the read. The backend denies it; earlier activity remains visible.

### Try the mock developer application

From the Developers screen, connect **Visit Prep AI**, then open the linked mock application. It requests the actual policy-filtered context through a server-side proxy, generates a deterministic appointment-preparation draft from the returned fields, and saves it through the real report endpoint. The page is an integration demo, not a clinical application: its output is synthetic, unverified, and never a diagnosis or treatment recommendation. Change a memory permission or revoke Visit Prep AI in CareVault, then reload the context to demonstrate that the next request reflects the current policy.

With conservative receipt inheritance, a prepared report can already be withheld when its read included redacted fields or a partially protected note. External report writes always remain private pending review; there is no review/approval workflow in this version.

## Chat with the demo patient

1. Open **Chat**, connect Health companion, and save its permissions. The companion is a separate integration with read permission only by default.
2. Paste an [OpenRouter API key](https://openrouter.ai/keys) into the password field and select **Use key for this session**. This sends it to your local server, which retains it in memory until restart; it is not returned or stored in the browser. Alternatively, set `OPENROUTER_API_KEY` in ignored `.env.local` before starting the server.
3. Ask “What care preferences are in my memory?” Expand the response's context disclosure to inspect the exact memory sent.
4. Change a permission and ask again. The backend projects current permissions on every turn and resets prior model conversation context when the policy version changes. Revoking access denies further requests.

The fixed model is [`stealth/space-bunny-alpha`](https://openrouter.ai/stealth/space-bunny-alpha), selected explicitly by the user. Its listed input/output prices are currently zero; the listing says it is going away October 5, 2026. There is no automatic model fallback. Model quality, latency, availability, and [rate limits](https://openrouter.ai/docs/api_reference/limits) vary. Missing keys and provider errors are shown as errors, never substituted with a mock answer.

Typed questions and authorized memory are sent to OpenRouter and its selected provider. Use synthetic data only; typed messages are not automatically redacted. Conversation history is held on the local server (up to three exchanges per conversation, 20 conversations), lost on restart, and not written into clinical records. Questions use general education and appointment-preparation instructions; outputs are unverified and are not a clinical decision system. Earlier disclosures cannot be recalled from the provider.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

Behavioral tests exercise real SQLite and HTTP handlers, including restart persistence, scopes, authorization, redaction, provenance, revocation, protected downloads, and chatbot provider boundaries. Provider tests use an explicit fake transport and do not consume API quota. See [verification notes](docs/VERIFICATION.md) for browser and review evidence.

## What we are building

One synthetic patient vault with connection-time permissions, selected live redaction, persistent report writes, and a clear history of what an integration received or changed. A trusted backend processes readable information and releases only authorized views.

The patient chooses **Share**, **Redact**, or **Private**. Integrations receive separate permissions to read facts, download redacted files, and create reports. Protecting a fact also restricts material derived from it.

## Start here

- [Implementation and UI plan](docs/PLAN.md): decisions, architecture, screens, redaction rules, and production boundaries.
- [Integration handoff](docs/INTEGRATION-CONTRACT.md): implemented API for teammates building applications; those applications are out of scope here.
- [12-hour build board](docs/BUILD.md): sequence, ownership, acceptance checks, and demonstration script.
- [Repository instructions](AGENTS.md): constraints for future implementation.

## Agreed constraints

- 3–4 people, approximately 12 working hours.
- React / Next.js / TypeScript. Minimize infrastructure; no graph database requirement.
- Local demo is sufficient. Vercel is optional and requires a suitable persistent storage setup.
- Synthetic data only. Prepared extraction and medical results are acceptable and must be labeled.
- Build the memory layer and patient-facing UI. Do not build the imaging, trial, or formulation integrations in this repository now.
- The core demonstration must perform real backend permission checks, selected redaction, and saved writes.
- An LLM API key is available, but provider selection and live model use are not prerequisites for the core flow. Never commit a key.

Use local SQLite for this demo. Vercel deployment requires a deliberate migration to durable hosted storage; it has not been configured. Source repository: [kleongf/carevault](https://github.com/kleongf/carevault). Publishing source does not deploy the app or publish the private local vault.


## Implementation map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx`, `app/globals.css` | Four owner-facing screens and responsive styling |
| `components/carevault/` | Chat, permissions dialog, and shared display helpers |
| `components/ui/` | shadcn/Radix components; bundled license included |
| `app/api/[...path]/route.ts`, `lib/http.ts` | Next.js adapter, authentication, same-origin checks, bounded JSON, safe errors |
| `lib/service.ts` | Grants, reads, receipts, report writes, protected downloads, activity |
| `lib/policy.ts` | Deterministic disclosure ordering, redaction, and dependency traversal |
| `lib/store.ts` | SQLite persistence, transactions, credentials, additive registrations |
| `lib/seed.ts`, `lib/types.ts` | Synthetic fixtures and shared domain types |
| `lib/chat.ts` | Fixed model, authorized context, bounded history, provider boundary |
| `scripts/setup.ts` | Local vault and credential initialization |
| `tests/` | SQLite/HTTP behavior tests and injected-provider chat tests |

Stack: Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/Radix, Lucide icons, and Node's built-in SQLite. There is no separate graph database, vector index, semantic retrieval service, or background memory agent. Parent/source references form a small dependency graph within stored JSON records.

```text
Owner browser → Next.js HTTP boundary → Vault service → Policy projection → SQLite
Integration server → Bearer authentication ────┘
Owner chat → Companion grant → Projected context → OpenRouter → Current-grant recheck
```

The model does not decide what it can read. The backend resolves the caller and validates patient, scope, and current disclosure rules before assembling context. The UI preview uses the same projection function as actual reads.

## Current feature boundaries

| Area | Live behavior | Prepared or unimplemented |
| --- | --- | --- |
| Patient vault | Saved grants, item restrictions, history, revocation | One synthetic owner; no signup or multi-user accounts |
| Redaction | Structured identifiers, prepared note spans, private-topic omission | No general PII detector or universal de-identification |
| Derived memory | Known parents/sources restrict summaries and reports | No autonomous extraction or memory improvement |
| Reports | Scoped append, source validation, attribution, persistence | Medical content is prepared; external writes remain private pending a future review UI |
| Files | Current-policy intake/visit plain-text extracts | PDF, scan, and image cards have no binary processing or original-file downloads |
| Developers | Registered apps, examples, actual request inspector | No public developer signup, marketplace, or self-service token issuance |
| Chat | Live permitted-memory responses from the selected model | Educational synthetic demo; no diagnosis, prescribing, or clinical record writes |
| Medical apps | Scan Review, Trial Explorer, Formulation Review registrations | Teammates implement their application logic separately |

## Configuration and secret handling

Create `.env.local` in the repository root with a text editor:

```dotenv
OPENROUTER_API_KEY=your_openrouter_key_here
```

Replace the placeholder locally and restart the server. Never commit a real key or make it a `NEXT_PUBLIC_*` variable. An API key entered through the owner Chat form takes precedence over the environment key until restart. Neither path returns the key to the browser; the form does not persist it in browser storage or SQLite.

`CAREVAULT_DATA_DIR` selects a private storage directory; the default is `data/` under the working directory. Export this variable consistently for setup and server commands. Setup runs as a plain Node script and does not automatically load `.env.local`.

Both server commands use port 3040 and loopback. Stop an existing server before starting another. Use the same hostname consistently for the browser session. There is no Docker or hosted database setup.

Space Bunny Alpha requires reasoning enabled; requests use `reasoning: { enabled: true, exclude: true }`, request a final answer, and reject truncated completions. The timeout is 45 seconds with one active request per store. The model choice is fixed in `lib/chat.ts`; client-supplied model/context/history fields cannot override it. To replace the retiring model, deliberately verify availability and pricing, then update the code, tests, UI label, and documentation together.

## Security and data model

SQLite stores JSON in a `records(kind, id, body)` table using WAL mode. Local directory/file permissions are applied; there is no encryption at rest or zero-knowledge storage. The trusted server can read the vault.

- Owner login uses an eight-hour HMAC-signed HttpOnly, SameSite=Strict session cookie. Owner mutations require a matching Origin. Login throttling is process-local.
- Integration tokens authenticate separate callers. Token hashes live in SQLite; raw generated credentials live in private `data/credentials.json`. The developer UI never exposes them.
- More restrictive rules win: **Private > Redact > Share**. Private entries are absent rather than represented by revealing topic placeholders or hidden counts.
- Known parents and sources restrict descendants. Missing, cyclic, cross-patient, and pending-review provenance fails closed.
- External reports cannot promote their verification status or change grants. Receipt dependencies are inherited conservatively even if a caller omits source IDs.
- File access rechecks current permissions. Unsupported renditions fail instead of falling back to originals.
- Activity records metadata and disclosure references. It is not exact historical payload replay or a tamper-proof compliance audit log.
- Chat resets history after policy changes and rechecks permissions after generation before releasing a reply. Revocation cannot recall earlier provider disclosures.

### Backups and resetting

Stop the server before copying the entire private data directory, including credentials and SQLite sidecar files. Keep the backup outside Git. To create a fresh demo, move the directory to a private backup location and rerun setup; this creates a new vault and credentials. Do not delete data to fix a UI issue. Store startup adds missing integration registrations without reseeding existing patient records or grants.

## Integration API overview

See [the full contract](docs/INTEGRATION-CONTRACT.md) for request and response examples. Keep credentials on the integration's server; this server-to-server API does not enable cross-origin browser requests.

| Endpoint | Scope | Purpose |
| --- | --- | --- |
| `POST /api/v1/context` | `facts:read` | Read current authorized context, optionally filtered by categories |
| `GET /api/v1/files/:fileId/redacted` | `files:download` | Obtain a supported current-policy text rendition |
| `POST /api/v1/reports` | `reports:create` | Append an attributed unverified report |
| `GET /api/v1/reports/:reportId` | `facts:read` | Read a report under current restrictions |

Use `Authorization: Bearer <integration token>` and JSON for POST bodies. IDs are `scan-review`, `trial-explorer`, `formulation-review`, and `care-assistant`. Connect the app in the owner UI first. A supplied patient ID never grants access. The optional context `query` is accepted but does not perform semantic search; use categories for filtering.

## Verified state and production path

Current evidence: **29 tests pass**, type checking passes, and the production build passes. Tests use temporary SQLite stores and fake provider transport without consuming API quota. A separate live browser check returned a Space Bunny Alpha answer using 14 permitted synthetic memory items. Verification ran on macOS arm64 with Node 26.8.1; the recommended Node 24 runtime has not been separately tested. No CI workflow or complete accessibility/cross-browser audit is configured. Run `git diff --check` alongside the commands above before handing off changes.

Before real healthcare deployment, define the regulated use and recipients, then implement production identity and tenant isolation, durable managed storage, encryption/key management, credential lifecycle, reviewed ingestion/provenance, report review, retention/deletion controls, audit operations, monitoring, backups, incident response, and appropriate vendor agreements. Clinical evaluation and legal/compliance review are separate requirements. These are future work, not current guarantees.

The original plan and build board preserve historical decisions. Current code and [verification notes](docs/VERIFICATION.md) determine what is implemented. Source publication on GitHub does not make the app ready for public hosting.
