# 12-hour build board

Status: the core application is implemented. Backend tests, type checking, and the production build pass. See VERIFICATION.md for the completed checks. The time boxes below remain a suggested team schedule, not a record of hours spent.

## Success criterion

A patient connects a fixture integration, chooses Share/Redact/Private settings, sees an actual authorized API response, receives a persisted report through a scoped write endpoint, protects a source and its derived summary, and revokes access. A subsequent read is denied. No full medical integration needs to be built here.

## Critical path

| Time | Work | Evidence |
| --- | --- | --- |
| 0–1 h | Scaffold Next.js/TypeScript, pin the runtime, create SQLite tables and synthetic fixtures, agree on the teammate API | Start the app and reload seeded memory |
| 1–3 h | Implement actor separation, saved grants, policy projection, and context read endpoint | Direct API requests enforce scope and patient boundaries |
| 3–6 h | Build integration hub, connection panel, owner preview, and My memory | Saved choices match actual API output |
| 6–8 h | Implement report append endpoint, activity feed, source/summary dependencies, and revoke | Writes survive restart; private sources restrict descendants; next revoked request fails |
| 8–10 h | Exercise identifier/topic/derived redaction, connect teammate clients or request fixtures, polish states | A, D, E live examples work without a live model |
| 10–12 h | Run targeted checks, fix defects, rehearse and record backup demo; consider hosting only if everything passes | Repeatable end-to-end demonstration and honest feature labels |

Freeze optional features by hour 8. Do not let a graph animation, OCR service, public marketplace, or deployment migration displace backend permission checks.

## Suggested ownership

- **Backend owner:** schema, credentials, grants, policy evaluator, scoped read/write/file endpoints.
- **UI owner:** integration hub, permission drawer, memory inspection, activity states.
- **Fixture/demo owner:** synthetic records, prepared extraction/source examples, dependency examples, request fixtures, test cases, narrative.
- **Optional fourth person:** teammate integration coordination and verification; deployment only after the critical path works.

The team can own other integrations elsewhere. Do not create those application implementations in this repository without a new scope decision.

## Minimal fixtures

- One primary synthetic patient and a second patient for access-isolation tests.
- Three integration registrations, each with a distinct secret and grant.
- 15–25 memory items spanning demographics, symptoms, medications, allergies, preferences, and a protected topic.
- One original note with prepared identifier spans; one protected-topic fact; one derived summary with an explicit dependency.
- Source cards for structured data, a PDF, a scanned page, and an image. Clearly label prepared extraction.
- One prepared report body for exercising the write contract. Do not describe it as a live medical model result.
- Expected allowed, redacted, and private outputs for each grant configuration.

## Acceptance checks

1. **Connection persistence:** refresh/restart retains grant settings.
2. **Identifier redaction:** protected values are absent from the actual integration response, including source metadata. A placeholder appears only where existence disclosure is permitted.
3. **Topic privacy:** a Private topic produces no topic-specific placeholder, filename, or hidden count in the integration response.
4. **Derived restrictions:** restricting a parent restricts a known child summary and persisted report on later reads.
5. **No token spoofing:** a caller cannot claim another integration identity through request parameters.
6. **Patient isolation:** changing the patient or source ID does not grant access to the second patient.
7. **Operation separation:** fact-read permission does not authorize report writes or file downloads.
8. **Saved writes:** a permitted report survives restart, retains source references and server-assigned authorship, and remains unverified.
9. **Untrusted writes:** a report cannot edit permissions, execute markup, or promote its own verification status.
10. **Revocation:** a subsequent request fails; historic disclosure receipts remain visible.
11. **Unsupported processing:** an unprocessed upload or missing redacted rendition cannot fall back to sharing original content.
12. **Preview parity:** owner preview and live read use the same policy function and agree for the same policy version.

Use policy unit tests and route-level tests for these properties. A screenshot of blacked-out text is not evidence that the API protected it.

## Five-minute demonstration

1. **0:00–0:40:** show the integration hub and synthetic patient. Explain the trusted vault boundary.
2. **0:40–1:30:** connect a fixture integration; permit useful categories, redact identity, and protect a clinical topic.
3. **1:30–2:20:** run a real scoped request in the inspector or teammate client; show the returned payload and activity receipt.
4. **2:20–3:10:** submit a prepared report through the actual report endpoint; show authorship and persistence in My memory.
5. **3:10–4:00:** protect a source and repeat retrieval; its dependent summary/report is also restricted.
6. **4:00–4:35:** revoke the integration and show the next request denied. Historical disclosures remain recorded.
7. **4:35–5:00:** show three track integration slots and explain how teammates connect to the shared API. Distinguish prepared examples, live behavior, and the production roadmap.

## Vercel stretch decision

Only pursue deployment if the main demo passes and a persistent hosted database is available. A local SQLite file or in-memory store is not an acceptable substitute for durable cloud writes. Avoid a second storage implementation solely to claim deployment.

## Implementation handoff notes

- The Next.js application and SQLite gateway are implemented. Run the README setup instructions, then connect teammate applications using INTEGRATION-CONTRACT.md.
- Disk space was audited and reproducible caches/dependencies were removed with user authorization. Available space remains tight; avoid large model downloads or Docker builds.
- Use the existing API key through a local environment variable only if a model call is needed; never request that it be pasted into chat or committed.
- Local Git repository is created; remote hosting, publishing, and GitHub visibility are not configured.
