# CareVault

A patient-controlled memory layer and integration hub for healthcare AI.

**Status: working local hackathon prototype.** The hub, permission gateway, selected redaction, activity history, and persistent report writes are implemented. All patient data is synthetic. Medical integrations and arbitrary document processing are not implemented.

## Run locally

Use Node 24 (`.nvmrc`); Node 22.13+ with `node:sqlite` is required. No database service or API key is needed.

```sh
npm ci
npm run setup
npm run dev
```

Open http://127.0.0.1:3040 and enter the owner access code printed by setup. Re-running setup preserves the vault and displays the same code. `npm run build && npm start` runs the production build locally.

SQLite and generated credentials live in the ignored `data/` directory. Keep this directory private. Integration tokens are in `data/credentials.json`; give each teammate only their integration's token through a private channel. Never put these tokens in browser code. The UI's owner-only inspector needs no integration token.

The server binds to loopback. Do not expose this prototype publicly or load real health information. Local file permissions are implemented; encryption at rest, production accounts, credential lifecycle, backups, and healthcare compliance operations are not.

## Try the demonstration

1. Connect **Scan Review**, keeping identity Redact and mental health Private. Preview and save the grant.
2. Select it in **Request inspector** and run a read. Inspect the actual JSON: identifiers are replaced and private-topic text is absent.
3. Save a fixture report, then find it in **My memory**. Its content is prepared; permission checks, authorship, and persistence are live.
4. To demonstrate inherited protection, first share identity and mental health, read again, and save a report. Then make **Private health note** Private in My memory. Later requests omit its summary and dependent reports, even when Notes/Reports remain Share.
5. Revoke access and repeat the read. The backend denies it; earlier activity remains visible.

With conservative receipt inheritance, a prepared report can already be withheld when its read included redacted fields or a partially protected note. External report writes always remain private pending review; there is no review/approval workflow in this version.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

The 19 behavioral tests exercise real SQLite and HTTP handlers, including restart persistence, scopes, authorization, redaction, provenance, revocation, and protected downloads. See [verification notes](docs/VERIFICATION.md) for browser and review evidence.

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

Use local SQLite for this demo. Vercel deployment requires a deliberate migration to durable hosted storage; it has not been configured. This is a local Git repository with no remote configured.
