# CareVault integration API

New apps use **v2**, served locally at `http://127.0.0.1:3040`. This is a server-to-server API. The external app's backend holds its token; cross-origin browser access is not enabled.

The vault handles identity, selected-record permissions, identifier-protected representations, receipts, report persistence, and current-policy checks. The external app handles its own user task, models, and unverified report content. Neither a developer login nor an app credential grants patient access by itself.

## Register and connect

1. Sign in to CareVault as the seeded developer. Create an app with its name, description, URL, and required capabilities.
2. Issue a credential. Save the one-time value in the external app's server environment; new developer token records store only its hash. Rotation/revocation invalidates the old value.
3. Sign in as the patient. Find the app in **Apps**, select individual records/representations, and optionally permit report writes.
4. Authenticate requests using `Authorization: Bearer <app-token>`. The server binds the one seeded patient; there is no caller-selected patient ID in v2.

Capabilities: `text:read`, `files:redacted`, `files:original`, `reports:create`. Capabilities express what an app can request; patient grants are still required. Removing capabilities narrows existing grants. Changing an app URL disconnects it so the patient must approve the new destination.

## List authorized records

`GET /api/v2/records`

```http
Authorization: Bearer <app-token>
```

Example shape:

```json
{
  "records": [
    {
      "id": "<record-uuid>",
      "mime": "application/pdf",
      "kind": "document",
      "status": "ready",
      "allowed": { "text": true, "redacted": true, "original": false }
    }
  ]
}
```

Only descriptors for records with currently authorized representations appear. Titles, patient identifiers, hidden-record counts, and private provenance text are omitted. `kind` is `document`, `image`, or `report`; `status` is `queued`, `processing`, `ready`, or `failed`. An authorized descriptor does not promise every output is processed. A connected app may receive an empty list; a disconnected app receives 403.

## Read content and retain its receipt

| Endpoint | Required capability and record permission | Result |
| --- | --- | --- |
| `GET /api/v2/records/:id/text` | `text:read` + `text` | Identifier-redacted text, `text/plain` |
| `GET /api/v2/records/:id/files/redacted` | `files:redacted` + `redacted` | Newly generated PDF or PNG |
| `GET /api/v2/records/:id/files/original` | `files:original` + `original` | Original stored bytes and MIME type |

Every successful content response includes **`X-CareVault-Receipt`**, an opaque UUID needed for report writes. Listing alone does not issue a receipt. Add `?download=1` for attachment disposition on file responses; download filenames are generic rather than private source titles.

Text and redacted exports require `ready`; missing/failed/unprocessed output returns 409 and never falls back to original data. Original bytes can be read before processing only with explicit original permission. The owner sees unredacted extracted text; integrations never receive that version through the text endpoint.

```ts
const base = process.env.CAREVAULT_URL!;
const authorization = `Bearer ${process.env.CAREVAULT_TOKEN!}`;
const response = await fetch(`${base}/api/v2/records/${recordId}/text`, {
  headers: { Authorization: authorization },
  cache: "no-store",
});
if (!response.ok) throw new Error(`CareVault read failed: ${response.status}`);
const receiptId = response.headers.get("X-CareVault-Receipt");
if (!receiptId) throw new Error("CareVault receipt missing");
const permittedText = await response.text();
```

Keep tokens and receipt handling in backend code. Pass only authorized content to a model, never the credential. Treat OCR/report text as data, not instructions. Re-fetch or recheck before releasing a long-running result or writing a report; clear locally cached context after access changes. CareVault cannot erase a copy already retained by an app.

## Write an unverified report

`POST /api/v2/reports`

Requires the registered `reports:create` capability, connected grant, and `allowReports: true`.

```http
Authorization: Bearer <app-token>
Content-Type: application/json
```

```json
{
  "title": "Chest X-ray review",
  "body": "Unverified integration-generated report text.",
  "sourceReceiptIds": ["<receipt-uuid-from-content-read>"]
}
```

Return: HTTP 201 and the new document record, including `id`, `kind: "report"`, `status: "queued"`, server-assigned `author`, `source`, and `dependencies`. Do not send `sourceRecordIds`; record IDs alone do not prove a disclosure. No caller-provided verified status, owner, or author is trusted.

Limits: title 200 characters, nonempty body up to 64,000 characters, 1–100 UUID receipts, JSON request body up to 262,144 bytes. The vault also enforces record-count/original-byte quotas.

Each submitted receipt must belong to this app/patient, match the **current grant version**, and refer to a representation still authorized. After a permission change, read again to obtain a new receipt. Reports include dependencies from **all known historical v2 disclosures to this app**, not just the caller's submitted subset. This prevents omission of a receipt from erasing a known source restriction.

New reports are private/unshared. The worker creates their extracted/redacted versions; there is no fact proposal or clinical-review workflow. Sharing a report later also requires access to its inherited source representations. Missing/cyclic/cross-patient provenance fails closed. Legacy-app reports remain owner-only because older disclosure history is incomplete.

The report endpoint has no general idempotency-key contract. An external app should avoid automatic retries after an ambiguous write outcome; check whether the report arrived before trying again. The X-ray example retains successful save IDs within its own temporary draft lifecycle.

## Browser sessions and portal routes

Browser routes use an HttpOnly SameSite=Strict session cookie. All mutations, including login/logout, require an Origin matching the actual request Host and protocol. These routes are for the same-origin CareVault UI, not app bearer clients.

| Method/path | Role | Body/result |
| --- | --- | --- |
| `POST /api/session` | Any login | `{username,password}` -> `{account:{id,username,role}}` |
| `GET /api/session` | Signed in | Public account only |
| `DELETE /api/session` | Browser | Invalidates session server-side |
| `GET /api/developer/apps` | Developer | `{apps:[...]}` for that developer |
| `POST /api/developer/apps` | Developer | App fields -> new app descriptor, 201 |
| `PUT /api/developer/apps/:id` | Owning developer | App fields -> updated descriptor |
| `POST /api/developer/apps/:id/credential` | Owning developer | `{token,app}`; rotate/issue |
| `DELETE /api/developer/apps/:id/credential` | Owning developer | Revoked app descriptor |
| `GET /api/patient/dashboard` | Patient | Own records, app directory/grants, latest activity |
| `POST /api/patient/records` | Patient | Raw file bytes; headers described below |
| `GET /api/patient/records/:id/text` | Patient | Original extracted text, after ready |
| `GET /api/patient/records/:id/files/original` | Patient | Original file |
| `GET /api/patient/records/:id/files/redacted` | Patient | Processed redacted file |
| `PUT /api/patient/apps/:id` | Patient | Complete selected-record grant |
| `POST /api/patient/apps/:id/revoke` | Patient | Disconnect and clear new grant |

App fields are `name` (nonempty, at most 80 characters), `description` (at most 400), `appUrl` (at most 2048), and a subset of the four capability strings. URLs must use HTTPS, except HTTP localhost/loopback; embedded credentials and fragments are rejected. At most 20 apps may belong to the demo developer. Login usernames are limited to 64 characters and passwords to 256; account authentication has persisted throttling.

Uploads are raw bytes, **not multipart form data**. Set `Content-Type` to `application/pdf`, `image/png`, or `image/jpeg`, `X-File-Name` to an `encodeURIComponent`-encoded title (maximum decoded length 200), and optional `X-Redaction-Profile: identifiers` or `healthcare`. The default is `identifiers`. File signatures and bounded body reads are checked; parser validation occurs in the worker. Inputs are limited to 20 MiB, with 100 records and 300 MiB original content per vault. Upload returns a private queued document, HTTP 201.

Example patient grant:

```json
{
  "connected": true,
  "allowReports": true,
  "records": {
    "<record-uuid>": { "text": true, "redacted": false, "original": false }
  }
}
```

All three representation booleans are required for each listed record. Unlisted/new records are not shared. The server assigns the grant version; the app cannot modify it. Report-source inheritance can further narrow the effective permissions beyond these direct selections.

## Errors and response handling

Errors use `{ "error": "code", "message": "safe description" }` with no raw source/provider content. Responses use private/no-store caching and content-type protections.

- **400/415:** invalid fields, file/type, profile, JSON, or grant shape.
- **401:** missing/invalid credentials, expired browser session, or invalid login.
- **403:** wrong role, Origin, disconnected grant, unsupported/unauthorized representation, invalid source receipt, or v2-only token used on v1.
- **404:** unavailable/unknown objects and routes, including ownership-protected lookups.
- **409:** record not ready, rendition unavailable, or app-limit conflict.
- **413:** upload/request/storage quota exceeded.
- **429:** login throttling.
- **500:** sanitized internal failure.

Never interpret missing data as absence of disease. Never substitute a private original for a failed redacted request.

## Verified example clients

The separate X-ray app on loopback port 3041 and Medicine Review on 3043 have exercised real reads, free OpenRouter drafts, v2 report writeback, worker-ready/unshared arrival, repeat-save behavior, and post-revocation denial. Browser source preview/generation/save was also exercised. This verifies the contract mechanics, not clinical report quality; see [VERIFICATION.md](VERIFICATION.md).

Each example uses its own in-page username/password login. Its local app credential remains only in JavaScript memory and is sent in an explicit Basic authorization header, without `WWW-Authenticate` browser prompts or secret storage. This credential is different from the CareVault session and integration token. Integration/provider secrets remain on the example backend. These loopback HTTP servers require further identity/HTTPS/operations work before public hosting.

## Legacy compatibility

`/api/owner/*` and `/api/v1/*` retain earlier structured-memory policy behavior for existing data and grants. Owner routes now require the patient role session, not the obsolete owner-code login. Old chat/inspector routes remain authenticated compatibility handlers but have no patient/developer navigation entry. New developer-created integrations are marked `recordApiOnly` and receive 403 on v1.

The old context API, prepared text renditions, and pending legacy reports are not the new document contract. Do not build new integrations against them. Disconnecting through the patient UI or legacy path stops both generations; existing restrictions are not broadened by migration. Full historical v1 behavior remains in source/tests for compatibility, not as a second public integration tutorial.

## Preserved Trial Explorer compatibility


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

The patient-authenticated `/trials` compatibility page exposes matching, request creation, approval/denial, and one-time use. It uses the preserved legacy structured facts and permissions, separately from v2 document grants. Synthetic fixture values and listings must not be represented as real clinical-trial results.


Patient-role owner routes: `POST /api/owner/trials/matches` with `integrationId`; `/api/owner/trials/requests` with `integrationId` and `studyId`; `/api/owner/trials/requests/:id/approve|deny` with `{}`; `/use` with `integrationId`. Same-Origin checks apply. New v2-only app credentials cannot call these v1 endpoints.
