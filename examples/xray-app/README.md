# Chest X-ray Review example

A separate local application demonstrating CareVault's integration contract:

1. List image records explicitly shared with the integration.
2. Read the selected original or redacted image and obtain a source receipt.
3. Run a real pretrained TorchXRayVision classifier locally.
4. Send **the selected image version and numeric classifier scores** to an explicitly configured OpenRouter model to draft an unverified Markdown report.
5. Recheck access and image content before displaying the draft.
6. On **Save report**, obtain a fresh receipt and write the report into CareVault. The new record starts unshared.

There is no fake-inference fallback, automatic weight download, model fallback, or paid-provider fallback. This is a research demonstration, not a diagnostic service or tumor detector.

## Current verification

The local example passed 14 deterministic tests, including a real temporary HTTP server and authentication/permission boundaries. The pinned runtime and official checkpoint were installed and evaluated in 30 real inference runs on three attributed NIH samples and their generated redacted versions. All outputs contained 18 finite scores; see [EVALUATION.md](EVALUATION.md) for timings, hashes, and limitations.

A live `stealth/space-bunny-alpha` run completed classifier-plus-report generation in 8.73 seconds. CareVault accepted the receipt-backed report, processed it, and kept it unshared. Duplicate save returned the same ID; revocation blocked later reads. A second live browser run verified in-page login, image preview, generation, and save. These checks establish the demo workflow, not diagnostic accuracy or clinical safety.

## Setup

Python 3.12 is recommended. Check free disk space before installing the PyTorch environment. The official model asset alone is 28,382,008 bytes; dependencies need considerably more space.

```sh
cd examples/xray-app
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

In CareVault's developer account, create an app with these capabilities:

- `files:original`
- `files:redacted`
- `reports:create`

Set its app URL to `http://127.0.0.1:3041`. Issue a credential. In the patient account, connect the app from the directory, select an image, grant the desired file representation, and enable report writes. A credential alone does not grant patient access.

Export the variables listed in `.env.example` into your shell or process supervisor. Keep credentials out of command history and Git. The application does not automatically read `.env` files. Set a separate `XRAY_APP_USERNAME` and `XRAY_APP_PASSWORD` (at least 12 characters), then enter them in the app's sign-in form. These credentials are independent of the CareVault accounts. The static sign-in shell is public; every API remains authenticated. The client sends Basic authorization explicitly from memory, without a native browser authentication prompt or browser storage, and clears the password field after sign-in. Sign out clears the in-page credential, draft, image preview, and outstanding requests; server-side drafts expire after ten minutes. Reloading requires sign-in again. The example binds exclusively to `127.0.0.1:3041`; do not expose this Basic-auth HTTP server publicly.

### Provision the official weights explicitly

Download the `densenet121-res224-all` checkpoint from the [official TorchXRayVision release asset](https://github.com/mlmed/torchxrayvision/releases/download/v1/nih-pc-chex-mimic_ch-google-openi-kaggle-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt) into the ignored `.weights/` directory **after sufficient space is available**. No setup or application command downloads it automatically.

Set `XRAY_WEIGHTS_PATH` to that file and `XRAY_WEIGHTS_SHA256` to its locally verified SHA256 digest. The upstream asset metadata has no published digest; compute it after obtaining the file from the official HTTPS release. This pins the provisioned artifact against later change, rather than independently authenticating the initial download. Never use an uploaded or untrusted checkpoint: the upstream format is a serialized Python module and is loaded with `weights_only=False` after the size/hash checks.

Set `OPENROUTER_MODEL` explicitly. Both demo apps now select `openai/gpt-6.1-sol` at the user’s request (October 4, 2026). This is a paid model: catalog prices must be at most $2/million input tokens and $10/million output tokens, with no request/image fees. Requests enforce those routing caps, disable provider fallback, and use low reasoning effort. The optional web-search tool is not enabled. Other model selections still require zero advertised prices. Missing models, missing prices, excessive prices, and unavailable providers produce errors; no replacement model is selected. Access is rechecked after model lookup, immediately before sending the derived scores.

```sh
.venv/bin/python app.py
```

Open `http://127.0.0.1:3041`. The browser never receives the integration token or OpenRouter key. The LLM receives the exact selected PNG/JPEG version as an inline base64 image plus classifier scores. It receives no vault URL, credential, record ID, or separate patient text. Original files may include embedded identifiers and metadata; the redacted version is sent only when selected and authorized, without falling back to the original. Access and the image digest are checked immediately before sending and before releasing the report. The model catalog must advertise image input support. Image input tokens count toward the existing input-token price cap.

## Model choice and limitations

The selected [`densenet121-res224-all`](https://github.com/mlmed/torchxrayvision/blob/master/torchxrayvision/models.py) has 18 trained outputs covering findings such as mass, nodule, effusion, and pneumonia. The upstream model combines multiple cohorts, including NIH. This avoids the untrained output heads present in some single-cohort variants. The adapter follows upstream normalization to `[-1024, 1024]`, single-channel input, center crop, and 224-pixel resizing. Only 8-bit PNG/JPEG inputs are accepted; DICOM and high-bit-depth imaging are outside this example.

The example returns raw sigmoid scores, deliberately without the library's optional operating-point normalization. Scores are **not calibrated disease probabilities**. No thresholds, cancer diagnoses, lesion locations, or measurements are inferred. The [TorchXRayVision paper](https://arxiv.org/abs/2111.00595) describes a research library, and the [authors' cross-domain generalization study](https://arxiv.org/abs/2002.02497) motivates testing across datasets. Site/population differences, noisy labels, preprocessing, and image annotations can affect results. An LLM can also invent unsupported language; the report remains explicitly unverified.

The [code license is Apache 2.0](https://github.com/mlmed/torchxrayvision/blob/master/LICENSE). The checkpoint is an official release asset; the inspected repository does not supply a separate model card/license for that specific asset. Dataset terms and provenance remain separate from the software license. Do not imply that the code license alone settles all image/weight redistribution rights.

NIH images can demonstrate the mechanics, but NIH was part of this model's training data. A few demonstration images cannot establish accuracy, and overlap makes them unsuitable for an independent generalization claim. Preserve NIH provenance rather than claiming that the real research images belong to the fictional patient.

## Verification

```sh
python -m unittest discover -s . -p 'test_*.py' -v
```

When changing the model, preprocessing, or provider, repeat the recorded checks using a small provenance-tracked NIH image set:

- Cold/warm runtime, finite 18-label scores, reproducible preprocessing, and reasonable memory use.
- Behavior for rejected formats and revoked image permissions.
- Original-versus-redacted input differences, without treating them as clinical validation.
- Exact OpenRouter model, current pricing within configured caps, successful completed draft, and real CareVault writeback.
- The new report's unshared state and denial of subsequent reads after revocation.

Requests have bounded response sizes and socket timeouts; classification runs in an isolated process with a 60-second deadline. Only one analysis/save operation runs at a time. Drafts expire after ten minutes, with at most ten retained in memory. Duplicate successful saves return the original record ID. An ambiguous failed write is not automatically retried; check CareVault first. No automatic clinical-record overwrites or treatment recommendations are implemented.

The prompt requests Markdown headings for Image observations, Classifier findings, and Limitations, with short bullets and bold terms. The existing text-node Markdown renderer displays headings/lists/emphasis without executing HTML or remote image links. Reports and saved provenance remain unverified.
