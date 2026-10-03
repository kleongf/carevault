# Integration handoff contract

**Proposed interface, not an implemented API.** This document lets teammates build independently. Implementing the imaging, trial, and formulation applications is outside this repository's current scope.

## Responsibilities

**Hub:** identity, grants, scoped retrieval, redaction, source references, report persistence, dependency protection, and activity history.

**Integration:** user task, medical/application logic, its own model calls, and attributed report creation. It must treat missing data as unknown and report text as unverified output.

Integration slots: `scan-review`, `trial-explorer`, `formulation-review`. These are registered demo identities with different credentials, not trusted roles merely because they have these names.

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

`query` is optional, bounded text used only to select among authorized information. It cannot change permissions. The first implementation can use category filtering instead of semantic search.

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

## Download a redacted file

`GET /api/v1/files/:fileId/redacted`

Required scope: `files:download`, plus applicable source/category/item permissions.

Return only a real redacted rendition compatible with the current policy. If no such rendition exists, return `rendition_unavailable`; never fall back to the original. Prepared examples are sufficient for the hackathon, labeled as prepared in the owner UI. Raw files remain behind owner authorization.

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
- If the receipt is absent, provenance is missing, or the report introduces unreviewed content, retain it privately pending review; do not grant automatic downstream sharing.
- No caller-supplied `clinician_verified` status. No automatic overwrite of established facts.
- Persist the write and activity entry consistently. If idempotency is added, scope keys to integration and patient.

## Read a report

`GET /api/v1/reports/:reportId`

Required scope: `facts:read`. Apply current restrictions and dependency inheritance. Knowing an ID is not permission. An integration does not gain permanent read access merely because it originally wrote the report.

## Owner controls

Proposed owner routes: list integrations, save a connection grant, revoke a connection, inspect memory, set private/redacted item restrictions, and list activity.

The owner-only preview calls the same projection function used by the integration read path. It must not be a client-side imitation of authorization.

## Error behavior

- Missing/invalid credential: 401.
- Revoked connection, missing operation scope, or another patient's record: 403 or a uniform non-disclosing 404 for object lookups.
- Invalid request: 400.
- Missing prepared redacted rendition: a documented `rendition_unavailable` error.
- Internal policy or storage failure: fail closed; return no private partial data.

Do not include raw source content in errors. Render integration text as text, not trusted HTML.

## Three track handoffs

| Teammate application | Reads | Optional report | Status in this repository |
| --- | --- | --- | --- |
| Scan Review | Authorized image and selected context | Candidate finding with sources | Contract only |
| Trial Explorer | Authorized condition/age/location information | Potential matches and unknown criteria | Contract only |
| Formulation Review | Authorized prescription, administration needs, ingredient restrictions | Pharmacist review packet | Contract only |

## Future memory-agent demonstration

The user selected this future sequence: integration writes a report -> memory agent adds attributed assertions/source links -> patient sees additions. Document it, but do not implement the integration or autonomous agent now. A fixture-based report write can prove persistence and permissions in this team's demo.
