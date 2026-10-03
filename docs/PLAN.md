# Implementation and UI plan

Decision date: 2026-10-03. Working name: CareVault.

Implementation update: the local hub and gateway are built. README.md, INTEGRATION-CONTRACT.md, and VERIFICATION.md describe the delivered behavior. This plan also retains future product scope. The prototype uses CSS without Tailwind, one SQLite record table with JSON dependency IDs, prepared source cards without uploaded binaries, inline memory details, and a modal permission panel. Activity shows record references and policy versions, not exact historical response replay. No autonomous extraction/review agent is implemented.

## 1. Accepted decisions

| Topic | Decision |
| --- | --- |
| First release | Synthetic-data hackathon prototype with a documented healthcare deployment path |
| Ownership | Patient creates a personal vault and connects independent applications |
| Trust | Our backend may process readable data; integrations receive scoped disclosures |
| Main UI | Integration hub, with memory and activity views |
| Access approval | At connection time, with ongoing grants until edited or revoked |
| Permissions | Category rules plus individual overrides; separate fact-read, file-download, and report-write operations |
| Disclosure | Share, Redact, or Private |
| Inputs in product story | Structured records, notes, PDFs, scans, and medical images |
| Live redaction priorities | Remove identifiers; protect a clinical topic; propagate protection to derived content |
| Read/write memory | Allow attributed new assertions and reports; review replacement of established clinical facts |
| Demo simplifications | Prepared extraction and medical results; selected examples instead of arbitrary-file processing |
| Integration ownership | Teammates build applications; this repository only defines and implements the shared interface |
| Stack | React, Next.js, TypeScript; minimize setup |
| Team and time | 3–4 people, about 12 working hours |
| Hosting | Local is sufficient; Vercel is a stretch objective |

Interpretation of “keep redacted”: a user may permit a placeholder while withholding the underlying value. Private means omit the field and its existence-specific metadata. Redacted placeholders can reveal that a field exists; the owner UI must explain that difference.

## 2. Demonstration boundary

### Build live

1. Load one seeded synthetic patient; keep a second patient fixture only for isolation checks.
2. Connect a registered integration and save category permissions and operation scopes.
3. Preview the exact authorized context for that integration.
4. Execute authenticated reads through one policy evaluator.
5. Remove or replace predefined identifier spans; restrict topic-labeled facts and their known descendants.
6. Persist attributed reports submitted to the shared write endpoint.
7. Show disclosures and writes in the activity feed.
8. Revoke an integration and deny its next request.

### Use prepared examples

- A visit note, lab PDF, scanned page, and de-identified medical image can each have a source card and prepared extraction.
- Sensitivity labels and redaction spans can be seeded, not discovered by a live model.
- Include a prepared redacted file only if it has actually had the protected contents removed. Label it as a prepared example.
- Medical findings, trial criteria, and formulation content belong to the application teams or fixtures, not this team's inference system.
- A request inspector or test client can exercise read/write APIs without building any of the three applications.

### Defer

Arbitrary OCR, robust DICOM de-identification, general image editing, automatic clinical-topic detection, full EHR connectivity, public developer signup, delegated agent credentials, a graph database, vector search, full account onboarding, automatic fact replacement, continual learning, and production compliance certification.

Do not silently treat an unsupported uploaded file as safely processed. Show unsupported or prepared-extraction status. No private raw uploads go in Next.js public assets.

## 3. Framework choices

| Layer | Choice | Reason |
| --- | --- | --- |
| Application | Next.js App Router + React + TypeScript | One codebase for UI and API endpoints |
| Styling | Ordinary CSS and React components; Lucide icons | Small dependency surface and responsive layouts |
| Persistence | Local SQLite in the Node.js runtime | Persistent grants and reports without a cloud account or service |
| SQLite access | node:sqlite, Node 24 recommended | One storage module; no native database package install |
| Validation | Explicit TypeScript request checks | Validate integration input and bound payload size |
| Policy | Pure TypeScript functions | Easy to understand and test; no LLM authorization |
| AI | Optional direct provider call behind a server-only function | Provider is unspecified; live inference is not on the critical path |
| Dependencies | Parent IDs inside persisted records | Adequate for the small provenance demonstration; policy traverses these links |

Choose a supported common Node version at scaffolding time and pin it. The current machine had Node v26.8.1 when the plan was prepared; that is an observation, not a requirement to use that version on every teammate's machine. node:sqlite support and stability depend on Node version.

No LangGraph, Neo4j, Presidio service, or separate vector store is required. Those can be evaluated after the demonstration works. Do not implement multiple storage adapters now.

Vercel cannot provide a durable writable local SQLite file for this application. If deployment becomes important and a hosted database is readily available, choose hosted PostgreSQL before implementation or schedule an explicit migration. Do not describe an in-memory or temporary filesystem deployment as persistent. The local version is the default deliverable.

## 4. Minimal data model

- **Patient:** id, display name, synthetic flag.
- **Integration:** id, name, publisher label, hashed credential, status. Seeded publishers are demo identities, not independently certified companies.
- **Source:** id, patient id, type, title, private asset reference, prepared/live extraction status, sensitivity labels.
- **Memory item:** id, patient id, kind, category, structured value or text, labels, source ids, author, verification status, timestamp, version.
- **Dependency:** child item id, parent item id. Derived content inherits all applicable restrictions from its ancestors; it cannot become less restricted through summarization.
- **Connection/grant:** patient id, integration id, operation scopes, category disclosure modes, per-item restrictions, revoked flag, policy version.
- **Activity event:** request id, actor id, patient id, operation, outcome, policy version, released item/version references, time. Avoid duplicating full sensitive values in logs.

Reports are a memory-item kind, not a second clinical source of truth. The backend supplies author identity and timestamps from authenticated context. Keep pending fact replacements distinct from established assertions.

Exact historical receipts can use versioned item references plus disclosure transformations. Do not reconstruct a past disclosure using today's changed values and label it as the original payload.

## 5. Permission rules

### Independent operation scopes

- `facts:read`: retrieve permitted memory content.
- `files:download`: retrieve an authorized redacted rendition, not an automatic right to originals.
- `reports:create`: append an attributed report.

Grants are made through owner controls. Integration APIs cannot edit permissions, revoke privacy restrictions, delete existing clinical records, or assign themselves a verified status.

### Three disclosure states

| State | Integration receives | Owner sees |
| --- | --- | --- |
| Share | Authorized value and permitted provenance | Full value and applicable rule |
| Redact | A placeholder for an explicitly permitted field/label | Original, placeholder preview, and explanation |
| Private | No value, record, category-specific marker, or revealing provenance | Item marked private and reason |

Use a fixed disclosure schema for redacted labels. If the label itself reveals a protected topic, omit the item instead. Do not reveal hidden record counts in an integration response.

### Precedence and inheritance

1. Authenticate the actor and establish its patient grant.
2. Check connection status and requested operation.
3. Compute the category rule.
4. Apply individual restrictions and topic protections.
5. Apply restrictions from all known dependency ancestors.
6. Choose the most restrictive outcome: Private > Redact > Share.
7. Project only allowed fields and permitted provenance.
8. Record the disclosure; return the projected response.

An individual override in this prototype can narrow a category grant, not broaden it. The UI must disable impossible selections and explain inherited protection.

Check current policy on every read, including direct report retrieval and file endpoints. Avoid cross-request response caches. Serialize local grant changes and release decisions with a consistent policy version; revocation cannot recall data already sent.

If provenance is absent or a dependency is unknown, keep the new item private pending review. For the tiny fixture graph, detect cycles and fail closed rather than recurse indefinitely.

### Selected live redactions

- **Identifiers:** seeded structured fields and known spans in prepared text. Remove values rather than relying on CSS. Do not claim arbitrary PII detection.
- **Clinical topic:** a private topic rule filters all labeled facts/spans. Identifier removal alone does not remove clinical sensitivity.
- **Derived memory:** a source-to-summary dependency causes the summary to become restricted when the source becomes restricted.

The backend may inspect raw data within its trust boundary. It must never send private content to an integration model and ask that model to hide it afterwards.

## 6. Patient-facing UI

### Visual direction

A calm desktop web application with a restrained neutral palette, one teal accent, clear typography, and familiar forms. Use text labels alongside status colors. Prioritize readable data and policy previews over decorative graphs.

Navigation: **Integrations / My memory / Activity**. Add a compact “Synthetic demo” label and a patient identity control. A second patient is a test fixture, not a full multi-patient management product.

### Integrations: landing screen

Show seeded app cards for the three track teams. Each card has name, publisher, purpose, connection status, enabled operations, and Connect/Manage access/Revoke actions. Label unimplemented apps as integration slots, not functioning products.

Selecting a card opens a right-hand permission panel:

- Integration identity and stated task.
- Separate operation toggles: read facts, download redacted files, create reports.
- Category rows: Share / Redact / Private.
- “Keep private” and “Keep redacted” restrictions for individual examples.
- A live preview generated by the same backend projection used by reads.
- Save permissions and Cancel.

No approval popup on every normal request. Changes take effect after saving. Revoke changes the connection status and blocks subsequent API calls.

The owner-only request inspector may run a sample read or write as a fixture integration through the gateway. It is a developer demonstration tool, not a medical application. Never expose integration secrets to this browser UI.

### My memory

Show facts, documents, and reports in one list with category filters. Each item shows source, date, author, verification status, and privacy state.

Detail drawer: original value/text; source links; read-only clinical verification status; privacy overrides; known dependent items; “view as integration” preview. Public integration responses never include this owner-only view.

Use status labels such as patient-reported, source-extracted, integration-authored, and pending review. Patient confirmation is not the same as clinician verification.

### Activity

List successful reads, masked disclosures, denied requests, writes, permission changes, and revocations. Details show permitted record/version references and the policy decision. Previously completed disclosures stay visible after revocation.

### Essential states

Disconnected; connected; no permitted records; denied; redacted; inherited restriction; report saved; report private pending review; revoked; source extraction prepared; unsupported upload; request failed. Do not fabricate a successful response when the backend fails.

## 7. Read/write memory and the teammate boundary

The shared backend accepts authenticated report writes and stores authorship and source references. That endpoint is in scope. The application that creates the report is out of scope.

Reports can appear automatically when `reports:create` is granted. They remain integration-authored. Extracted assertions remain unverified/source-attributed and never overwrite established clinical facts automatically.

For the hackathon, a prepared report and prepared extraction mapping can demonstrate the future memory agent. Label the processing as prepared if it is deterministic fixture data. Do not build the agent or integration now just to populate the dashboard.

When accepting source references, verify they belong to this patient and were accessible to that integration. For the demo, conservatively carry dependencies from all items released in the referenced read receipt, rather than trusting the caller to omit sensitive sources. An ungrounded report is saved privately pending owner review.

Detailed routes and examples are in INTEGRATION-CONTRACT.md.

## 8. HIPAA and ownership: production path

Prototype controls to demonstrate: scoped access, operation separation, minimized disclosures, protected derivatives, credential separation, audit records, and revocation.

Production work to assess: legal role and HIPAA applicability, business associate agreements where required, organizational risk analysis, authentication and access lifecycle, encryption and key management, workforce controls, incident response, retention/deletion, backups, vendor/model processing, and validation of redaction quality. These are planned requirements, not implemented claims.

Do not add a “HIPAA mode” or certification badge. A direct-to-consumer patient vault is not automatically a HIPAA-covered service; a clinic deployment may create different obligations. Other privacy laws may also apply.

The product enforces what it releases and blocks future reads after revocation. It cannot erase readable copies already received by external applications, guarantee their stated purpose, or track off-platform sharing. Corrections/deletion in the vault do not alter a hospital's source record or override retention duties.

Pseudonymization, masking, and topic protection do not automatically satisfy HIPAA de-identification. Original documents, embeddings, summaries, and metadata remain within the privacy boundary.

## 9. Documentation references

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js backend endpoints](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Node.js SQLite](https://nodejs.org/api/sqlite.html)
- [Vercel and SQLite persistence](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
- [HHS health app scenarios](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-apps/index.html)
- [HHS cloud computing guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html)
- [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html)

## 10. Nonblocking decisions for implementation

- Choose a provider only if live LLM processing becomes useful; no key is needed in source control or planning messages.
- CareVault is a temporary product/repository name.
- Repository is local. A GitHub remote and its destination/visibility have not been chosen.
- Final medical fixture content and application outputs must be agreed with the integration teammates.
