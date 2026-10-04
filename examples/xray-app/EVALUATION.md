# Real local classifier evaluation

On October 3, 2026, the actual `inference.py` adapter successfully classified three provenance-tracked NIH images and their actual CareVault worker renditions. This verifies the local integration mechanics. It is **not a clinical accuracy study**, and it does not evaluate an LLM report.

## Reproduce

From the repository root, after installing the shared Python environment and provisioning the official weights:

```sh
worker/.venv/bin/python examples/xray-app/evaluate.py
```

To also compare actual processed renditions in an explicitly selected synthetic test vault:

```sh
worker/.venv/bin/python examples/xray-app/evaluate.py --vault-dir /path/to/synthetic-test-vault
```

The evaluator reads `demo/nih-manifest.json` and `demo/files/`, validates each image's byte length and SHA256, and validates the official checkpoint's size and SHA256. It opens the selected vault's SQLite database in read-only mode, matches the three NIH document titles, and confirms each vault original matches the manifest before reading a ready redacted rendition. It neither changes the vault nor sends provider requests. No integration token or OpenRouter key is needed. Python socket connections are blocked during every classifier call.

Results are saved to ignored `examples/xray-app/evaluation-results.json`. The script exits unsuccessfully if a hash, output contract, finite-score, or repeatability check fails. `--repeats` defaults to four same-process calls per representation. Cold measurements each use a separate subprocess; all inputs go through the real production adapter rather than a second model implementation.

## Pinned inputs and environment

- Model: `densenet121-res224-all`, TorchXRayVision 1.5.5, PyTorch 2.14.1, NumPy 2.4.6, Python 3.12.14, macOS 15.5 ARM64.
- Official checkpoint: 28,382,008 bytes; SHA256 `56524913dd16a906422e8d8b66a7a5c46be1d82eb7ac012d8103776f1aa68899`.
- Manifest SHA256: `d512ec908ff5ea0cdeb5199e7985849a37e087c5cb43931b2ccd82103fceb1a3`.
- Dataset mirror revision: `36778e3b0e4f4b4fad31d1728d6190f3eda5b543`.
- Images: `00000002_000.png` (subject 2, No Finding label, PA), `00000013_024.png` (subject 13, Mass label, AP), and `00000008_002.png` (subject 8, Nodule label, PA).
- Full provenance, source URLs, individual image checksums, and dataset attribution are in `demo/nih-manifest.json`. These research images are not images of the fictional CareVault patient.

The [official model checkpoint](https://github.com/mlmed/torchxrayvision/releases/download/v1/nih-pc-chex-mimic_ch-google-openi-kaggle-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt) was provisioned separately. The locally computed hash pins those downloaded bytes; upstream did not publish a separate digest that independently authenticates the initial download. The adapter loads this explicitly provisioned checkpoint only after size/hash verification. See the application README for model and dataset licensing limitations.

## Mechanical checks

Thirty real classifier executions passed: one fresh-process call plus four same-process calls for each of six inputs (three originals and three worker renditions).

Every call returned exactly 18 unique labels matching the [upstream model's label order](https://github.com/mlmed/torchxrayvision/blob/master/torchxrayvision/models.py). Every reported score was finite and within `[0, 1]`. The adapter uses sigmoid outputs without operating-point normalization or disease thresholds. Results were identical across cold and repeated calls at the adapter's exposed **six-decimal precision**. This is not a claim of unrounded bitwise determinism across hardware or library versions.

| NIH sample label | Original cold subprocess | Same-process warm median | Original cold peak RSS | Redacted cold subprocess | Redacted warm median |
| --- | ---: | ---: | ---: | ---: | ---: |
| No Finding | 3.004 s | 0.227 s | 454.5 MiB | 2.380 s | 0.236 s |
| Mass | 2.285 s | 0.224 s | 471.4 MiB | 2.246 s | 0.244 s |
| Nodule | 2.215 s | 0.248 s | 463.3 MiB | 2.262 s | 0.256 s |

Cold time includes interpreter startup and imports. Warm time is the median of the final three same-process calls, with warm imports and filesystem caches. **The current adapter still constructs and loads the model on every call**, and the application deliberately invokes it in a new subprocess. Therefore the warm numbers are not the expected end-to-end application latency. Provider drafting, authorization checks, and report saving are excluded. RSS is the process high-water mark, not incremental model allocation. These are observations on a shared development machine.

## Scores in model label order

Column headings describe the dataset annotation used to select each sample. They are not diagnoses inferred by the application. These raw sigmoid scores are uncalibrated model outputs, not percentages of disease risk.

| Label | No Finding sample | Mass sample | Nodule sample |
| --- | ---: | ---: | ---: |
| Atelectasis | 0.158287 | 0.013094 | 0.059069 |
| Consolidation | 0.044952 | 0.010636 | 0.009381 |
| Infiltration | 0.143292 | 0.111252 | 0.077867 |
| Pneumothorax | 0.005313 | 0.016761 | 0.002159 |
| Edema | 0.002347 | 0.001453 | 0.000175 |
| Emphysema | 0.032053 | 0.006883 | 0.025063 |
| Fibrosis | 0.086922 | 0.023572 | 0.066719 |
| Effusion | 0.093661 | 0.018657 | 0.048290 |
| Pneumonia | 0.001166 | 0.002158 | 0.000115 |
| Pleural_Thickening | 0.026750 | 0.032034 | 0.020976 |
| Cardiomegaly | 0.083909 | 0.005546 | 0.110053 |
| Nodule | 0.110278 | 0.058819 | 0.020163 |
| Mass | 0.086778 | 0.210679 | 0.021394 |
| Hernia | 0.007618 | 0.000863 | 0.010369 |
| Lung Lesion | 0.003714 | 0.004862 | 0.000419 |
| Fracture | 0.095860 | 0.060664 | 0.013242 |
| Lung Opacity | 0.462725 | 0.090266 | 0.183795 |
| Enlarged Cardiomediastinum | 0.026472 | 0.084010 | 0.010384 |

The Mass-labelled sample's Mass score was `0.210679`, while the Nodule-labelled sample's Nodule score was only `0.020163`. The No Finding-labelled sample had a Lung Opacity score of `0.462725`. These observations illustrate why a label-selected demo must not be pitched as a verified tumor detector. There is no separate No Finding output head, and this experiment assigns no positive/negative thresholds.

## Original versus worker rendition

All three actual worker renditions had exactly the same 1,048,576 grayscale pixel values as their originals. Container hashes differed after re-encoding, but changed-pixel count, maximum pixel difference, and all 18 score differences were **zero**. Worker-recognized text counts were 0, 13, and 0 respectively for the No Finding, Mass, and Nodule examples.

This verifies that these particular worker outputs did not alter classifier inputs. **It does not test classifier robustness to black redaction masks**, because no pixels were masked in these examples. Zero OCR text is also not proof that a scan contains no identifiers. Redaction quality is evaluated separately using known synthetic identifiers in `worker/benchmark.py`; no identifier-removal accuracy claim is made for these NIH images.

## What remains outside this evaluation

NIH is among the training cohorts of this multi-dataset checkpoint. We did not establish the training/test membership of these individual images, so overlap cannot be ruled out. Three distinct subjects selected specifically for annotation labels are not an independent or representative validation set. The [NIH dataset paper](https://arxiv.org/abs/1705.02315) describes weakly supervised, text-mined labels; they should not be treated as confirmed diagnoses. No AUC, sensitivity, specificity, calibration, subgroup performance, or cancer-risk claim can be derived from this run.

Center cropping and resizing to 224 pixels, AP/PA view differences, site/population shifts, and overlaid annotations can influence scores. The model provides classification outputs rather than lesion locations, sizes, staging, or a radiologist interpretation. The [TorchXRayVision paper](https://arxiv.org/abs/2111.00595) and the authors' [cross-domain generalization study](https://arxiv.org/abs/2002.02497) provide the broader research context.

Malformed-input handling and app permission tests live in `test_app.py`; the main application workflow separately verifies them. This evaluator does not invoke the LLM, assess generated medical language, write reports, or prove live revocation behavior. Those end-to-end integration checks must be recorded separately before describing the entire demo as verified.
