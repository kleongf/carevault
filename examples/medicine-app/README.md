# Medicine Review

A separate personalized-medicine demonstration at **http://127.0.0.1:3043**. It reads patient-selected redacted record text through CareVault, asks an explicitly configured OpenRouter model to draft a medication-options discussion, and saves an unverified report only when the user clicks Save.

This is a prompt-based research demonstration, not an evaluated recommendation algorithm, prescriber, interaction checker, or clinical decision system. The prompt asks for source-grounded options and questions for a clinician, without diagnoses, dosing, or treatment-change instructions. Model compliance is not a clinical guarantee. Missing or redacted fields remain unknown, including allergy status. Use synthetic records.

## Start

No new Python package is required. Python 3.10+ standard library is sufficient; the repository's worker environment can run it.

1. Run CareVault and process at least one synthetic visit note/medication record.
2. In the developer account, register **Medicine Review**, URL `http://127.0.0.1:3043`, capabilities **Read extracted text** (`text:read`) and **Create reports** (`reports:create`). Issue its own token. Do not reuse the X-ray app token.
3. In the patient account, connect this app, select the documents, enable text access and report writes. Original/redacted file capabilities are unnecessary; this app never downloads files.
4. Copy `.env.example` to `.env` in this folder and fill it locally. Keep secrets out of chat, URLs, browser storage, Git, and shell command history. Choose a unique local app username/password. These are separate from CareVault login credentials.
5. Export those environment variables into the server process and run from the repository root:

```sh
worker/.venv/bin/python examples/medicine-app/app.py
```

If using the already-installed `python-dotenv` from the worker environment, this loads the ignored file without shell evaluation:

```sh
worker/.venv/bin/python -c 'from dotenv import load_dotenv; import runpy; import sys; load_dotenv("examples/medicine-app/.env"); sys.path.insert(0, "examples/medicine-app"); runpy.run_path("examples/medicine-app/app.py", run_name="__main__")'
```

6. Open `http://127.0.0.1:3043`, sign in using the local app credentials, select records, preview shared text, create the discussion, and save it to CareVault. New reports remain unshared and enter the normal processing queue.

| Variable | Purpose |
| --- | --- |
| `CAREVAULT_URL` | Local CareVault origin; defaults to `http://127.0.0.1:3040` |
| `CAREVAULT_TOKEN` | This app's server-side integration credential |
| `OPENROUTER_API_KEY` | Server-side OpenRouter key |
| `OPENROUTER_MODEL` | Explicit model ID; there is no fallback |
| `MEDICINE_APP_USERNAME` | Local HTTP Basic username, no colon |
| `MEDICINE_APP_PASSWORD` | Unique local password, 12–256 characters |

Both demo apps now select `openai/gpt-6.1-sol` at the user’s request (October 4, 2026). This is a paid model: catalog prices must be at most $2/million input tokens and $10/million output tokens, with no request/image fees. Requests enforce those routing caps, disable provider fallback, and use low reasoning effort. The optional web-search tool is not enabled. Other model selections still require zero advertised prices. Missing models, missing prices, excessive prices, and unavailable providers produce errors; no replacement model is selected.

## Data and permission boundaries

- The server lists only authorized, ready text records from `/api/v2/records`. It reads `/api/v2/records/:id/text`, which returns the vault's redacted text and receipt. It does not read the database or original files.
- The user chooses 1–10 records, limited to 60,000 UTF-8 bytes total. No additional invisible profile is supplied. Unknown/withheld facts are never filled by deterministic code.
- Source excerpts are sent as untrusted data under a fixed system prompt. No tools, URL fetches, user-provided model, or browser-provided report body are executed. Output and source text render using `textContent`.
- Permissions and source content are rechecked after the model catalog lookup, immediately before disclosure, after generation, and again before save. Changed content or lost access discards the response. Revocation cannot recall text already sent to a provider or displayed in a browser.
- Drafts live only in server memory, expire after 10 minutes, and are capped at 10. Expired entries are pruned on subsequent generation; a restart drops all drafts. Saving reads fresh receipts and appends a report via `/api/v2/reports`; the vault authorizes the write and retains source restrictions.
- Only one analysis/save runs at a time. Successful repeat saves return the saved ID; an uncertain write outcome is not automatically retried, to avoid duplicates. Check CareVault before repeating the workflow.
- Credentials stay server-side. HTTP Basic login is protected by loopback binding, exact Host checks, API custom-header checks, mutation Origin checks, bounded requests, and no-store responses. The public static shell has an in-page login. Its Authorization header stays only in JavaScript memory, with no cookies or browser storage; sign-out clears credentials and displayed context/drafts. The password field is cleared on submit. API failures do not trigger a native browser authentication dialog. Do not expose this stdlib HTTP server publicly.
- No provider privacy/compliance claim is made. The UI explicitly shows that selected redacted text is sent to OpenRouter and its provider. Redaction does not establish anonymity or HIPAA compliance.

## Test

From the repository root:

```sh
worker/.venv/bin/python -m unittest discover -s examples/medicine-app -p 'test_*.py' -v
node --check examples/medicine-app/app.js
```

Verified during implementation: **21 tests passed**, including a real temporary loopback HTTP server with an injected fake vault/provider. Coverage includes authentication, Host/Origin/custom-header checks, static-file allowlisting, payload bounds, missing fields, selected redacted context, free-pricing enforcement, revocation during catalog/generation, changed sources, expired drafts, fresh receipt writeback, duplicate/uncertain saves, and invalid/truncated model responses. JavaScript syntax check passed.

These tests do not prove clinical quality, true model behavior, browser accessibility, or the live CareVault-to-OpenRouter workflow. The root verification documentation records separate end-to-end evidence when available. No real provider key was used by this module's deterministic tests.

## Files

- `app.py`: local HTTP/authentication boundary and static assets.
- `core.py`: CareVault/OpenRouter client, scoped context, drafts, and report writeback.
- `index.html`, `style.css`, `app.js`: responsive source selection and report UI.
- `test_app.py`: deterministic permission/provider and local HTTP tests.

Later hosting needs a production application server, HTTPS, real identity/session controls, persistent app configuration, reviewed provider agreements and retention, observability without patient payload logging, and a validated clinical use case. This example intentionally remains local and single-user.

## Live verification — October 3, 2026

Using three authorized fictional respiratory records, the real `stealth/space-bunny-alpha` model completed a discussion in 25.1 seconds. The app read only redacted text, wrote a source-linked report that processed successfully and remained unshared, returned the same ID on duplicate save, and was denied after revocation. A separate browser run verified the in-page login, context preview, live generation, and explicit save. The model identified insufficient medication history and asked for clarification rather than inventing a drug recommendation. This validates the integration workflow, not clinical recommendation quality.


### Markdown reports and generation feedback

The prompt requests `## Profile context`, `## Options to discuss`, and `## Missing information and questions`, with concise bullets, restrained bold emphasis, and inline-code record citations. The existing safe Markdown renderer uses text nodes; HTML is not executed. Source records and provenance are appended as Markdown. Medical uncertainty and clinician-review requirements remain unchanged.

During generation, the button shows a spinner and “Generating report…”. Success and errors restore controls; sign-out cancels the browser request and clears private UI state. Cancellation does not cancel already-started server/provider work or recall disclosed text. Animation respects reduced-motion preferences.
