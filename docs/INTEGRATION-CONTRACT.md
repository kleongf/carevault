# Integration handoff contract

**Implemented local API**, at `http://127.0.0.1:3040`. Implementing the imaging, trial, and formulation applications is outside this repository's current scope.

Run the README setup steps. Use `Authorization: Bearer <your integration token>` on `/api/v1/*` and `Content-Type: application/json` for POST bodies. Tokens are generated in the private, ignored `data/credentials.json`; keep them on your integration's server. Connect your integration in the owner UI before calling the API. This is a server-to-server API; cross-origin browser requests are not enabled.

## Responsibilities

**Hub:** identity, grants, scoped retrieval, redaction, source references, report persistence, dependency protection, and activity history.

**Integration:** user task, medical/application logic, its own model calls, and attributed report creation. It must treat missing data as unknown and report text as unverified output.

Integration slots: `scan-review`, `trial-explorer`, `formulation-review`. These are registered demo identities with different credentials, not trusted roles merely because they have these names.

`care-assistant` is the additional live Health companion demo. It uses the same saved grants and context projection. Its default grant is disconnected with only `facts:read` selected. Existing databases receive this registration without resetting other grants or patient records.

The **Developers** dashboard exposes registration status, documented request examples, a live owner-only API inspector, and access history. It does not expose integration secrets or implement public app registration.

## Authentication and connection

Owner endpoints require an owner session. Integration endpoints require an integration credential. The server resolves the actor from the credential; it does not trust an integration ID supplied in the request body.

For a local demo, randomly generated server-side tokens with hashes stored in the database are sufficient to exercise the boundary. Teammates keep integration tokens on their server, never in browser code. Local-only demo owner login can use a server secret and session cookie; do not publish a permanently authenticated owner interface.

The owner grants scopes through the UI. Requests may name a patient, but the gateway checks that actor's grant for that patient. A supplied patient ID never grants access by itself.

## Read context

`POST /api/v1/context`

Required scope: `facts:read`.

```json
{
  "patientId": "patient-demo-001",
  "categories": ["demographics", "symptoms"],
  "query": "Information relevant to preparing a visit"
}
```

`query` is optional and limited to 1,000 characters. It is accepted but not used for selection in this version. Use `categories` to filter; omitting it returns all authorized items. There is no semantic search. Request JSON is limited to 32 KiB.

Example response:

```json
{
  "requestId": "read-001",
  "policyVersion": 3,
  "items": [
    {
      "id": "fact-001",
      "version": 1,
      "field": "preferred_name",
      "disclosure": "redacted",
      "value": "[REDACTED]"
    },
    {
      "id": "fact-002",
      "version": 1,
      "field": "appointment_preference",
      "disclosure": "shared",
      "value": "Afternoons",
      "verification": "patient_reported",
      "sourceRefs": ["source-001"]
    }
  ]
}
```

Private items are absent, with no private category names, total-hidden counts, sensitive filenames, or revealing source snippets. A source reference is an opaque reference, not a direct download URL. Apply permission checks when resolving it. A redacted item's label/id is disclosed only if the owner's rule permits its existence to be visible.

Empty authorized results are valid. They do not mean the patient has no relevant condition or risk factor. Use a generic coverage statement, such as “Only authorized information is included,” rather than revealing which private categories exist.

## Trial matching and one-time fact access

Trial Explorer currently evaluates three synthetic study records with deterministic predicates. It compares only `shared` items from the current policy projection; redacted and private values are treated as unknown. Results are potential information matches, not eligibility decisions or medical advice. No model or external trial registry is used.

`POST /api/v1/trials/matches`

Required scope: `facts:read`.

```json
{ "patientId": "patient-demo-001" }
```

Returns the policy version and each synthetic study's criteria as `met`, `not_met`, or `unknown`. Private item IDs and values are not returned. The medication-routine study may expose an unresolved medication criterion and permit a request for its single catalog-defined medication fact.

`POST /api/v1/trials/requests`

Required scope: `facts:read`.

```json
{ "patientId": "patient-demo-001", "studyId": "medication-routine-interviews" }
```

Creates a pending owner request and returns its opaque request ID. The server selects the fact from the study catalog; callers cannot choose an arbitrary item ID. Requests expire after 15 minutes. Duplicate open requests for the same integration and study are rejected.

The owner reviews the exact fact and may approve or deny. Approval is bound to the integration, study, fact version, and current permission version. It does not change the saved connection grant. Approval expires after 15 minutes and is rejected if the fact or permission version changed before approval/use.

`POST /api/v1/trials/requests/:requestId/use`

Required scope: `facts:read`; bearer identity must match the requesting integration. No request body is required. An approved request returns exactly the one fact, then atomically changes its status to consumed. A later use returns `409 trial_request_used`; it is not included in later matching calls or ordinary context reads unless the saved grant independently permits it. Activity records the disclosure reference, not the value. This explicit owner-approved, single-use release is the only exception to the connection's standing disclosure projection.

The owner sandbox exposes matching, request creation, approval/denial, and one-time use in the **Trial Explorer** screen. Synthetic fixture values and listings must not be represented as real clinical-trial results.

## Download a redacted file

`GET /api/v1/files/:fileId/redacted`

Required scope: `files:download`, plus applicable source/category/item permissions.

Return only a real redacted rendition compatible with the current policy. If no such rendition exists, return `rendition_unavailable`; never fall back to the original. Prepared examples are sufficient for the hackathon, labeled as prepared in the owner UI. Raw files remain behind owner authorization.

Implemented renditions are **plain-text extracts** for `source-intake` and `source-visit`, projected at request time. PDF/scan/image cards have no downloadable binary or processing implementation and return HTTP 409 `rendition_unavailable`. No originals are served.

## Append a report

`POST /api/v1/reports`

Required scope: `reports:create`.

```json
{
  "patientId": "patient-demo-001",
  "title": "Visit preparation report",
  "body": "The patient prefers afternoon appointments.",
  "contextRequestId": "read-001",
  "sourceItemIds": ["fact-002"]
}
```

Example response:

```json
{
  "reportId": "report-001",
  "version": 1,
  "verification": "integration_authored",
  "memoryProcessing": "not_processed"
}
```

- The backend assigns the author and timestamp, validates request sizes, and treats the body as untrusted text.
- Check that the referenced read receipt belongs to this integration and patient.
- Check source IDs against authorized items in that receipt and the current write policy.
- Conservatively inherit restrictions from the receipt's disclosed items. Do not let the integration reduce sensitivity by leaving a source out of its request.
- All external reports are stored privately pending review, including reports with valid receipts. There is no review/approval workflow yet. A report without a receipt may be saved if it does not claim source item IDs. Missing/foreign receipt references and unauthorized source references are rejected.
- No caller-supplied `clinician_verified` status. No automatic overwrite of established facts.
- Persist the write and activity entry consistently. If idempotency is added, scope keys to integration and patient.

## Read a report

`GET /api/v1/reports/:reportId`

Required scope: `facts:read`. Apply current restrictions and dependency inheritance. Knowing an ID is not permission. An integration does not gain permanent read access merely because it originally wrote the report.

## Owner controls

Implemented owner routes (session cookie required; mutations also require same Origin):

- `POST /api/session` with `{ "code": "<local owner code>" }`; `DELETE /api/session` signs out.
- `GET /api/owner/dashboard`: integrations, memory, sources, latest 150 activity events, and latest 50 trial fact requests.
- `PUT /api/owner/connections/:id`: complete Grant shape from `lib/types.ts`; server assigns version.
- `POST /api/owner/connections/:id/revoke` with `{}`.
- `PUT /api/owner/memory/:id` with `{ "restriction": "private" }` (also `share` or `redact`).
- `POST /api/owner/preview` with `{ "integrationId": "scan-review" }` and an optional `grant` object; hypothetical preview, including disconnected grants.
- `POST /api/owner/inspect` with `{ "integrationId": "scan-review", "operation": "read" }` or operation `write` plus `contextRequestId` from a successful read. The server constructs the prepared report from authorized context. This trusted fixture path is not available through the external report API.
- `POST /api/owner/trials/matches` with `{ "integrationId": "trial-explorer" }`; `POST /api/owner/trials/requests` with `integrationId` and `studyId`; then approve or deny at `/api/owner/trials/requests/:requestId/approve|deny`. The owner-only `/use` route exercises the same single-use service as the integration API.
- `GET /api/owner/chat/status`: server key presence, model, and companion integration ID; no secret values.
- `POST /api/owner/chat/key` with `{ "key": "<OpenRouter key>" }`: retains the key only in this local server's memory until restart. Response is status only.
- `POST /api/owner/chat` with `{ "message": "<up to 2000 characters>", "conversationId": "<optional previous response ID>" }`: returns `reply`, actual provider `model`, authorized `context`, `conversationId`, and `historyReset`. Server history is bounded and reset when the grant policy version changes; client-supplied context, model, and history do not control the request. Chat uses the companion's read scope and does not append clinical reports.

Report titles are limited to 120 characters, bodies to 12,000, and source lists to 100 IDs. This demo vault allows at most 100 reports. Responses include `pendingReview` as well as the fields shown above.

The owner-only preview calls the same projection function used by the integration read path. It must not be a client-side imitation of authorization.

## Error behavior

- Missing/invalid credential: 401.
- Revoked connection, missing operation scope, or another patient's record: 403 or a uniform non-disclosing 404 for object lookups.
- Invalid request: 400.
- Missing prepared redacted rendition: a documented `rendition_unavailable` error.
- Invalid or unrequestable study: 400; missing approval, expired request, or stale fact/policy: 409; a second one-time use: 409 `trial_request_used`.
- Internal policy or storage failure: fail closed; return no private partial data.

Do not include raw source content in errors. Render integration text as text, not trusted HTML.

## Three track handoffs

| Teammate application | Reads | Optional report | Status in this repository |
| --- | --- | --- | --- |
| Scan Review | Authorized image and selected context | Candidate finding with sources | Contract only |
| Trial Explorer | Authorized condition/age/location information | Potential matches, unknown criteria, one owner-approved single-use fact | Synthetic demo workflow only; no live clinical-trial application |
| Formulation Review | Authorized prescription, administration needs, ingredient restrictions | Pharmacist review packet | Contract only |

## Future memory-agent demonstration

The user selected this future sequence: integration writes a report -> memory agent adds attributed assertions/source links -> patient sees additions. Document it, but do not implement the integration or autonomous agent now. A fixture-based report write can prove persistence and permissions in this team's demo.
