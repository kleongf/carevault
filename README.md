# CareVault

A patient-controlled memory layer and integration hub for healthcare AI.

**Status: planning repository.** No application, integrations, deployment, or production security controls are implemented yet. CareVault is a working name. This repository records the agreed hackathon scope and the contracts needed to build it.

## What we are building

One synthetic patient vault with connection-time permissions, selected live redaction, persistent report writes, and a clear history of what an integration received or changed. A trusted backend processes readable information and releases only authorized views.

The patient chooses **Share**, **Redact**, or **Private**. Integrations receive separate permissions to read facts, download redacted files, and create reports. Protecting a fact also restricts material derived from it.

## Start here

- [Implementation and UI plan](docs/PLAN.md): decisions, architecture, screens, redaction rules, and production boundaries.
- [Integration handoff](docs/INTEGRATION-CONTRACT.md): proposed API for teammates building applications; those applications are out of scope here.
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

There is no run command yet. The first implementation task is to scaffold the application according to the build board.
