"""Integration contract tests with injected transport/inference; no live model claims."""
import base64
import http.client
import io
import json
import threading
import unittest
import uuid

from app import Handler, LocalServer, authorized
from core import AppError, Config, MODEL, OPENROUTER, XrayApp
from inference import image_array

RECORD = str(uuid.uuid4())
PNG = b"\x89PNG\r\n\x1a\nsynthetic test bytes"


class Fixture:
    def __init__(self):
        self.calls = []
        self.shared = True
        self.paid = False
        self.prices = None
        self.modalities = ["text", "image"]
        self.variants = {"original": True, "redacted": False}
        self.mime = "image/png"
        self.revoke_during_llm = False
        self.image = PNG
        self.receipts = []
        self.writes = []
        self.save_error = False
        self.llm_output = "Candidate findings require clinical review."
        self.model = "stealth/space-bunny-alpha"
        self.classifier_calls = 0
        self.app = XrayApp(Config("http://127.0.0.1:3040", "vault-secret-test", "provider-secret-test", self.model), self.request, self.classify)

    def classify(self, image):
        self.classifier_calls += 1
        return {"classifier": MODEL, "weightsSha256": "a" * 64, "scores": [{"label": "Finding " + str(index), "score": index / 20} for index in range(18)]}

    def request(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if url.endswith("/api/v2/records"):
            return json.dumps({"records": [{"id": RECORD, "kind": "image", "mime": "image/png", "status": "ready", "allowed": self.variants}] if self.shared else []}).encode(), {}
        if "/files/" in url:
            if not self.shared:
                raise AppError("access_denied", 403)
            receipt = str(uuid.uuid4())
            self.receipts.append(receipt)
            return self.image, {"content-type": self.mime, "x-carevault-receipt": receipt}
        if url == OPENROUTER + "/models":
            return json.dumps({"data": [{"id": self.model, "architecture": {"input_modalities": self.modalities}, "pricing": self.prices if self.prices is not None else {"prompt": "0.1" if self.paid else "0", "completion": "0", "request": "0"}}]}).encode(), {}
        if url == OPENROUTER + "/chat/completions":
            if self.revoke_during_llm:
                self.shared = False
            return json.dumps({"model": self.model, "choices": [{"finish_reason": "stop", "message": {"content": self.llm_output}}]}).encode(), {}
        if url.endswith("/api/v2/reports"):
            self.writes.append(kwargs["body"])
            if self.save_error:
                raise AppError("upstream_unavailable", 502)
            return json.dumps({"id": str(uuid.uuid4())}).encode(), {}
        raise AssertionError("Unexpected request")


class ContractTests(unittest.TestCase):
    def test_exif_orientation_matches_physically_rotated_pixels(self):
        import numpy as np
        from PIL import Image
        image = Image.new("L", (40, 20), 180)
        image.putpixel((3, 4), 10)
        exif = Image.Exif(); exif[274] = 6
        tagged = io.BytesIO(); image.save(tagged, format="PNG", exif=exif)
        rotated = io.BytesIO(); image.transpose(Image.Transpose.ROTATE_270).save(rotated, format="PNG")
        self.assertTrue(np.array_equal(image_array(tagged.getvalue()), image_array(rotated.getvalue())))
        image.close()

    def test_permissions_are_checked_before_inference_and_unselected_variant_is_denied(self):
        f = Fixture()
        with self.assertRaisesRegex(AppError, "image_not_shared"):
            f.app.analyze(RECORD, "redacted")
        self.assertEqual(f.classifier_calls, 0)
        with self.assertRaisesRegex(AppError, "invalid_selection"):
            f.app.analyze("../../credentials", "original")

    def test_paid_or_missing_model_never_calls_chat_completions(self):
        f = Fixture(); f.paid = True
        with self.assertRaisesRegex(AppError, "not_available_free"):
            f.app.analyze(RECORD, "original")
        self.assertFalse(any(url.endswith("/chat/completions") for url, _ in f.calls))

    def test_requested_sol_uses_capped_prices_without_fallback(self):
        f = Fixture()
        f.app.config.model = f.model = "openai/gpt-6.1-sol"
        f.prices = {"prompt": ".000002", "completion": ".00001", "web_search": ".01"}
        draft = f.app.analyze(RECORD, "original")
        payload = next(options["body"] for url, options in f.calls if url.endswith("/chat/completions"))
        self.assertIn(f.model, draft["report"])
        self.assertEqual(payload["provider"], {"allow_fallbacks": False, "max_price": {"prompt": 2, "completion": 10, "request": 0, "image": 0}})
        self.assertEqual(payload["reasoning"], {"effort": "low", "exclude": True})
        self.assertNotIn("temperature", payload)

    def test_sol_missing_or_over_budget_prices_stop_before_disclosure(self):
        for prices in ({}, {"prompt": ".000002"}, {"prompt": ".000003", "completion": ".00001"},
                       {"prompt": ".000002", "completion": ".000011"}, {"prompt": "-1", "completion": "0"},
                       {"prompt": "NaN", "completion": "0"}, {"prompt": "Infinity", "completion": "0"},
                       {"prompt": "0", "completion": "0", "image": ".01"}):
            with self.subTest(prices=prices):
                f = Fixture()
                f.app.config.model = f.model = "openai/gpt-6.1-sol"
                f.prices = prices
                with self.assertRaisesRegex(AppError, "selected_model_price_limit"):
                    f.app.analyze(RECORD, "original")
                self.assertFalse(any(url.endswith("/chat/completions") for url, _ in f.calls))

    def test_report_contains_provenance_and_selected_image_with_scores(self):
        f = Fixture()
        draft = f.app.analyze(RECORD, "original")
        self.assertIn("UNVERIFIED", draft["report"])
        self.assertIn(RECORD, draft["report"])
        self.assertIn("Image SHA256", draft["report"])
        payload = next(options["body"] for url, options in f.calls if url.endswith("/chat/completions"))
        self.assertEqual(payload["model"], f.model)
        self.assertFalse(payload["provider"]["allow_fallbacks"])
        self.assertEqual(payload["provider"]["max_price"], {"prompt": 0, "completion": 0, "request": 0, "image": 0})
        content = payload["messages"][1]["content"]
        self.assertEqual(json.loads(content[0]["text"])["scores"], draft["scores"])
        self.assertEqual(base64.b64decode(content[1]["image_url"]["url"].split(",", 1)[1]), PNG)
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/png;base64,"))
        self.assertIn("well-formatted Markdown", payload["messages"][0]["content"])
        self.assertIn("## Provenance", draft["report"])
        serialized = json.dumps(payload)
        self.assertNotIn(RECORD, serialized)
        self.assertNotIn("vault-secret", serialized)
        self.assertNotIn("provider-secret", serialized)
        self.assertNotIn("synthetic test bytes", serialized)
        self.assertNotIn("provider-secret", json.dumps(draft))

    def test_redacted_version_is_sent_without_requesting_original(self):
        f = Fixture()
        f.variants = {"original": False, "redacted": True}
        f.image = PNG + b"redacted rendition"
        f.app.analyze(RECORD, "redacted")
        payload = next(options["body"] for url, options in f.calls if url.endswith("/chat/completions"))
        image_url = payload["messages"][1]["content"][1]["image_url"]["url"]
        self.assertEqual(base64.b64decode(image_url.split(",", 1)[1]), f.image)
        self.assertFalse(any("/files/original" in url for url, _ in f.calls))

    def test_jpeg_is_sent_with_matching_media_type(self):
        f = Fixture(); f.mime = "image/jpeg"; f.image = b"\xff\xd8\xffsynthetic jpeg"
        f.app.analyze(RECORD, "original")
        payload = next(options["body"] for url, options in f.calls if url.endswith("/chat/completions"))
        image_url = payload["messages"][1]["content"][1]["image_url"]["url"]
        self.assertTrue(image_url.startswith("data:image/jpeg;base64,"))
        self.assertEqual(base64.b64decode(image_url.split(",", 1)[1]), f.image)

    def test_text_only_model_blocks_image_submission(self):
        f = Fixture(); f.modalities = ["text"]
        with self.assertRaisesRegex(AppError, "selected_model_no_vision"):
            f.app.analyze(RECORD, "original")
        self.assertFalse(any(url.endswith("/chat/completions") for url, _ in f.calls))

    def test_changed_image_during_lookup_blocks_image_submission(self):
        f = Fixture()
        def request(url, **kwargs):
            if url.endswith("/models"):
                f.image = PNG + b"changed"
            return f.request(url, **kwargs)
        f.app.request = request
        with self.assertRaisesRegex(AppError, "source_changed_run_again"):
            f.app.analyze(RECORD, "original")
        self.assertFalse(any(url.endswith("/chat/completions") for url, _ in f.calls))

    def test_permission_change_while_llm_runs_discards_draft(self):
        f = Fixture(); f.revoke_during_llm = True
        with self.assertRaisesRegex(AppError, "image_not_shared"):
            f.app.analyze(RECORD, "original")
        self.assertEqual(f.app.drafts, {})

    def test_revocation_during_inference_or_model_lookup_stops_external_disclosure(self):
        for stage in ("inference", "lookup"):
            f = Fixture()
            if stage == "inference":
                def classify(image):
                    f.shared = False
                    return f.classify(image)
                f.app.classifier = classify
            else:
                def request(url, **kwargs):
                    if url.endswith("/models"):
                        f.shared = False
                    return f.request(url, **kwargs)
                f.app.request = request
            with self.assertRaisesRegex(AppError, "image_not_shared"):
                f.app.analyze(RECORD, "original")
            self.assertFalse(any(url.endswith("/chat/completions") for url, _ in f.calls))
            self.assertEqual(f.app.drafts, {})

    def test_save_rechecks_access_uses_fresh_receipt_and_is_idempotent(self):
        f = Fixture()
        draft = f.app.analyze(RECORD, "original")
        old_receipt = f.receipts[-1]
        first = f.app.save(draft["draftId"])
        second = f.app.save(draft["draftId"])
        self.assertEqual(first, second)
        self.assertEqual(len(f.writes), 1)
        self.assertNotEqual(old_receipt, f.writes[0]["sourceReceiptIds"][0])
        self.assertEqual(f.writes[0]["sourceReceiptIds"], [f.receipts[-1]])

    def test_revocation_and_changed_image_block_writeback(self):
        for revoke in (True, False):
            f = Fixture(); draft = f.app.analyze(RECORD, "original")
            if revoke:
                f.shared = False
            else:
                f.image = PNG + b"changed"
            with self.assertRaises(AppError):
                f.app.save(draft["draftId"])
            self.assertEqual(f.writes, [])

    def test_uncertain_write_is_not_automatically_retried(self):
        f = Fixture(); draft = f.app.analyze(RECORD, "original"); f.save_error = True
        with self.assertRaises(AppError):
            f.app.save(draft["draftId"])
        with self.assertRaisesRegex(AppError, "save_outcome_unknown"):
            f.app.save(draft["draftId"])
        self.assertEqual(len(f.writes), 1)

    def test_lock_rejects_parallel_analysis(self):
        f = Fixture(); f.app.lock.acquire()
        try:
            with self.assertRaisesRegex(AppError, "analysis_already_running"):
                f.app.analyze(RECORD, "original")
        finally:
            f.app.lock.release()

    def test_basic_auth_validates_exact_credentials(self):
        encode = lambda text: "Basic " + base64.b64encode(text.encode()).decode()
        self.assertTrue(authorized(encode("user:long-test-password"), "user", "long-test-password"))
        self.assertFalse(authorized(encode("user:wrong"), "user", "long-test-password"))
        self.assertFalse(authorized("Basic !!!", "user", "long-test-password"))


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.server = LocalServer(("127.0.0.1", 0), Handler, self.fixture.app, "demo", "testing-password")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def request(self, path, headers=None, method="GET", body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request(method, path, body=body, headers={"Host": "127.0.0.1:3041", **(headers or {})})
        response = connection.getresponse()
        result = (response.status, response.read(), dict(response.headers))
        connection.close()
        return result

    def test_authentication_origin_host_and_custom_header_boundaries(self):
        auth = {"Authorization": "Basic " + base64.b64encode(b"demo:testing-password").decode()}
        status, _, response_headers = self.request("/api/records")
        self.assertEqual(status, 401)
        self.assertNotIn("WWW-Authenticate", response_headers)
        self.assertEqual(self.request("/api/records", auth)[0], 403)
        headers = {**auth, "X-Requested-With": "CareVaultDemo"}
        status, data, response_headers = self.request("/api/records", headers)
        self.assertEqual(status, 200)
        self.assertIn(RECORD.encode(), data)
        self.assertNotIn(b"vault-secret", data)
        self.assertIn("no-store", response_headers["Cache-Control"])
        self.assertEqual(self.request("/api/records", {**headers, "Host": "attacker.test"})[0], 403)
        self.assertEqual(self.request("/api/analyze", {**headers, "Origin": "https://attacker.test", "Content-Type": "application/json"}, "POST", b"{}")[0], 403)

    def test_public_login_shell_does_not_expose_private_data(self):
        for path in ("/", "/app.js", "/style.css"):
            status, body, headers = self.request(path)
            self.assertEqual(status, 200)
            self.assertNotIn("WWW-Authenticate", headers)
            self.assertNotIn(RECORD.encode(), body)
            self.assertNotIn(b"vault-secret-test", body)
            self.assertNotIn(b"provider-secret-test", body)
            self.assertNotIn(b"testing-password", body)
        html = self.request("/")[1]
        self.assertIn(b'for="username"', html)
        self.assertIn(b'for="password"', html)
        self.assertIn(b'id="workspace" hidden', html)
        self.assertIn(b'class="header-actions"', html)
        self.assertIn(b'class="layout"', html)
        self.assertIn(b"Analyze the selected image and classifier scores with OpenRouter.", html)
        self.assertIn(b'aria-label="Unverified research report"', html)
        self.assertIn(b'aria-label="Open CareVault"', html)
        self.assertIn(b'aria-label="About and data usage"', html)
        self.assertIn(b'aria-label="Sign out"', html)
        self.assertIn(b"Research demo", html)
        self.assertIn(b">Unverified<", html)
        script = self.request("/app.js")[1]
        self.assertNotIn(b"innerHTML", script)
        self.assertNotIn(b"insertAdjacentHTML", script)
        self.assertIn(b"createElement", script)
        self.assertIn(b"textContent", script)
        self.assertEqual(self.request("/", {"Host": "attacker.test"})[0], 403)
        for path in ("/api/session", "/api/image?id=" + RECORD):
            self.assertEqual(self.request(path)[0], 401)
        for path in ("/api/analyze", "/api/save"):
            self.assertEqual(self.request(path, method="POST", body=b"{}")[0], 401)
        self.assertEqual(self.fixture.calls, [])

    def test_in_page_sign_in_checks_credentials_without_vault_access(self):
        auth = {"Authorization": "Basic " + base64.b64encode(b"demo:testing-password").decode(), "X-Requested-With": "CareVaultDemo"}
        status, body, headers = self.request("/api/session", auth)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"authenticated": True})
        self.assertNotIn("WWW-Authenticate", headers)
        self.assertEqual(self.fixture.calls, [])
        wrong = {**auth, "Authorization": "Basic " + base64.b64encode(b"demo:wrong-password").decode()}
        self.assertEqual(self.request("/api/session", wrong)[0], 401)


if __name__ == "__main__":
    unittest.main()
