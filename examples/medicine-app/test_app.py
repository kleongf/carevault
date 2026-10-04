import base64
import http.client
import json
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from app import Handler, HOST, LocalServer, ORIGIN, authorized
from core import AppError, Config, MedicineApp, OPENROUTER, PROMPT

FIRST = '11111111-1111-4111-8111-111111111111'
SECOND = '22222222-2222-4222-8222-222222222222'
SAVED = '33333333-3333-4333-8333-333333333333'
MODEL = 'example/model:free'


def encode(value):
    return json.dumps(value).encode(), {}


class FakeNetwork:
    def __init__(self):
        self.allowed = True
        self.can_write = True
        self.text = {FIRST: 'Patient reports cough. Medication history: inhaler use reported; name not recorded.', SECOND: 'Allergy status is not documented.'}
        self.calls, self.writes, self.receipts = [], [], []
        self.model_hook = self.catalog_hook = lambda: None
        self.prices = {'prompt': '0', 'completion': '0', 'request': '0', 'image': '0'}
        self.reply = {'model': MODEL, 'choices': [{'finish_reason': 'stop', 'message': {'content': 'Profile context: symptoms are reported. Ask a clinician to reconcile the medication and allergy history before discussing options.'}}]}

    def __call__(self, url, method='GET', headers=None, body=None, **kwargs):
        self.calls.append((url, method, body))
        if url == OPENROUTER + '/models':
            self.catalog_hook()
            return encode({'data': [{'id': MODEL, 'pricing': self.prices}]})
        if url == OPENROUTER + '/chat/completions':
            self.model_hook()
            return encode(self.reply)
        if not self.allowed:
            raise AppError('access_denied', 403)
        path = urlsplit(url).path
        if path == '/api/v2/records':
            return encode({'records': [{'id': key, 'kind': 'document', 'status': 'ready', 'allowed': {'text': True, 'original': False, 'redacted': False}} for key in self.text]})
        if path.endswith('/text'):
            rid = path.split('/')[-2]
            receipt = f'00000000-0000-4000-8000-{len(self.receipts):012d}'
            self.receipts.append(receipt)
            return self.text[rid].encode(), {'Content-Type': 'text/plain; charset=utf-8', 'X-CareVault-Receipt': receipt}
        if path == '/api/v2/reports':
            if not self.can_write:
                raise AppError('access_denied', 403)
            self.writes.append(body)
            return encode({'id': SAVED})
        raise AssertionError(path)


class MedicineTests(unittest.TestCase):
    def setUp(self):
        self.network = FakeNetwork()
        self.app = MedicineApp(Config('http://127.0.0.1:3040', 'synthetic-test-token-only', 'synthetic-key', MODEL), self.network)

    def assert_error(self, code, fn):
        with self.assertRaises(AppError) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def test_profile_is_only_redacted_selected_text_with_special_prompt(self):
        result = self.app.analyze([FIRST])
        self.assertIn('UNVERIFIED', result['report'])
        self.assertEqual(result['sourceIds'], [FIRST])
        self.assertNotIn(SECOND, result['report'])
        payload = next(body for url, _, body in self.network.calls if url.endswith('/chat/completions'))
        self.assertEqual(payload['messages'][0]['content'], PROMPT)
        self.assertIn('missing allergies mean no allergies', PROMPT)
        self.assertIn('Do not diagnose or prescribe', PROMPT)
        context = json.loads(payload['messages'][1]['content'])['permittedRecordExcerpts']
        self.assertEqual(context, [{'recordId': FIRST, 'text': self.network.text[FIRST]}])
        self.assertEqual(payload['provider']['max_price'], {'prompt': 0, 'completion': 0, 'request': 0, 'image': 0})
        self.assertFalse(payload['provider']['allow_fallbacks'])
        self.assertTrue(payload['reasoning']['exclude'])
        self.assertFalse(any('/files/' in url for url, _, _ in self.network.calls))

    def test_missing_empty_unshared_duplicate_and_oversized_context(self):
        for ids in (None, [], 'bad', [None], [FIRST, FIRST], [SAVED]):
            with self.assertRaises(AppError):
                self.app.analyze(ids)
        self.network.text[FIRST] = ' '
        self.assert_error('record_has_no_text', lambda: self.app.analyze([FIRST]))
        self.network.text[FIRST] = 'x' * 60001
        self.assert_error('context_too_large_select_fewer_records', lambda: self.app.analyze([FIRST]))
        self.assertFalse(any(url.endswith('/chat/completions') for url, _, _ in self.network.calls))

    def test_paid_unknown_and_missing_prices_never_call_model(self):
        for prices in ({'prompt': '0', 'completion': '.001'}, {'prompt': '0'}, {'prompt': 'NaN', 'completion': '0'}, {'prompt': '0', 'completion': '0', 'request': '1'}, {}):
            self.network.prices = prices
            self.assert_error('selected_model_not_available_free', lambda: self.app.analyze([FIRST]))
        self.assertFalse(any(url.endswith('/chat/completions') for url, _, _ in self.network.calls))

    def test_revocation_during_catalog_stops_disclosure(self):
        self.network.catalog_hook = lambda: setattr(self.network, 'allowed', False)
        self.assert_error('access_denied', lambda: self.app.analyze([FIRST]))
        self.assertFalse(any(url.endswith('/chat/completions') for url, _, _ in self.network.calls))
        self.assertEqual(self.app.drafts, {})

    def test_revocation_during_generation_discards_reply(self):
        self.network.model_hook = lambda: setattr(self.network, 'allowed', False)
        self.assert_error('access_denied', lambda: self.app.analyze([FIRST]))
        self.assertEqual(self.app.drafts, {})

    def test_changed_context_during_catalog_or_generation_discards_reply(self):
        for when in ('catalog_hook', 'model_hook'):
            self.setUp()
            setattr(self.network, when, lambda: self.network.text.update({FIRST: 'Changed record'}))
            self.assert_error('source_changed_run_again', lambda: self.app.analyze([FIRST]))
            self.assertEqual(self.app.drafts, {})

    def test_changed_context_or_revocation_before_save_prevents_write(self):
        result = self.app.analyze([FIRST])
        self.network.text[FIRST] += ' changed'
        self.assert_error('source_changed_run_again', lambda: self.app.save(result['draftId']))
        self.network.allowed = False
        self.assert_error('access_denied', lambda: self.app.save(result['draftId']))
        self.assertEqual(self.network.writes, [])

    def test_write_uses_fresh_receipts_and_server_draft_only(self):
        result = self.app.analyze([FIRST, SECOND])
        prior = list(self.network.receipts)
        saved = self.app.save(result['draftId'])
        self.assertEqual(saved, {'recordId': SAVED})
        self.assertEqual(self.network.writes[0]['body'], result['report'])
        fresh = self.network.writes[0]['sourceReceiptIds']
        self.assertEqual(len(fresh), 2)
        self.assertFalse(set(fresh) & set(prior))
        self.assertEqual(self.app.save(result['draftId']), saved)
        self.assertEqual(len(self.network.writes), 1)

    def test_missing_report_permission_is_enforced_by_vault(self):
        result = self.app.analyze([FIRST])
        self.network.can_write = False
        self.assert_error('access_denied', lambda: self.app.save(result['draftId']))
        self.assertEqual(self.network.writes, [])

    def test_original_only_or_unprocessed_record_is_not_offered(self):
        original = self.app.vault
        def listing(path, *args, **kwargs):
            if path == '/api/v2/records':
                return encode({'records': [
                    {'id': FIRST, 'status': 'ready', 'allowed': {'original': True, 'text': False}},
                    {'id': SECOND, 'status': 'processing', 'allowed': {'text': True}},
                ]})
            return original(path, *args, **kwargs)
        self.app.vault = listing
        self.assertEqual(self.app.records(), [])
        self.assert_error('record_not_shared', lambda: self.app.analyze([FIRST]))

    def test_missing_receipt_rejected_before_provider(self):
        original = self.app.vault
        def no_receipt(path, *args, **kwargs):
            data, headers = original(path, *args, **kwargs)
            if path.endswith('/text'):
                headers.pop('X-CareVault-Receipt')
            return data, headers
        self.app.vault = no_receipt
        self.assert_error('invalid_upstream_response', lambda: self.app.analyze([FIRST]))
        self.assertFalse(any(url.endswith('/chat/completions') for url, _, _ in self.network.calls))

    def test_ambiguous_write_does_not_retry(self):
        result = self.app.analyze([FIRST])
        original = self.app.vault
        def fail_write(path, *args, **kwargs):
            if path == '/api/v2/reports':
                raise AppError('upstream_unavailable', 502)
            return original(path, *args, **kwargs)
        self.app.vault = fail_write
        self.assert_error('upstream_unavailable', lambda: self.app.save(result['draftId']))
        self.assert_error('save_outcome_unknown_check_carevault', lambda: self.app.save(result['draftId']))

    def test_expired_and_missing_draft_rejected(self):
        self.assert_error('draft_expired_run_again', lambda: self.app.save(FIRST))
        draft = self.app.analyze([FIRST])
        self.app.drafts[draft['draftId']]['created'] = time.monotonic() - 601
        self.assert_error('draft_expired_run_again', lambda: self.app.save(draft['draftId']))

    def test_truncated_empty_or_wrong_model_responses_rejected(self):
        for reply in ({}, {'model': MODEL, 'choices': [{'finish_reason': 'length'}]}, {'model': MODEL, 'choices': [{'finish_reason': 'stop', 'message': {'content': ''}}]}, {'model': 'wrong', 'choices': [{'finish_reason': 'stop', 'message': {'content': 'hello'}}]}):
            self.network.reply = reply
            with self.assertRaises(AppError):
                self.app.analyze([FIRST])
        self.assertEqual(self.app.drafts, {})

    def test_single_generation_at_a_time(self):
        self.app.lock.acquire()
        try:
            self.assert_error('analysis_already_running', lambda: self.app.analyze([FIRST]))
        finally:
            self.app.lock.release()

    def test_descriptors_keep_kind_and_mime_without_titles(self):
        original = self.app.vault
        def listing(path, *args, **kwargs):
            if path == '/api/v2/records':
                return encode({'records': [
                    {'id': FIRST, 'kind': 'document', 'mime': 'text/plain', 'status': 'ready', 'title': 'Patient title', 'filename': 'secret.pdf', 'provenance': 'private note', 'allowed': {'text': True, 'redacted': False, 'original': False}},
                    {'id': SECOND, 'kind': 'document', 'mime': 'application/pdf', 'status': 'ready', 'title': 'Labs', 'allowed': {'text': True, 'redacted': True, 'original': False}},
                    {'id': SAVED, 'kind': 'secret title', 'mime': '../secret.pdf', 'status': 'ready', 'title': 'Hidden', 'allowed': {'text': True}},
                ]})
            return original(path, *args, **kwargs)
        self.app.vault = listing
        records = self.app.records()
        self.assertEqual([item['id'] for item in records], [FIRST, SECOND, SAVED])
        self.assertEqual(records[0]['kind'], 'document')
        self.assertEqual(records[0]['mime'], 'text/plain')
        self.assertEqual(records[1]['mime'], 'application/pdf')
        self.assertEqual(records[1]['allowed'], {'text': True, 'redacted': True, 'original': False})
        self.assertEqual(records[2]['kind'], 'document')
        self.assertNotIn('mime', records[2])
        blob = json.dumps(records)
        for withheld in ('title', 'filename', 'provenance', 'Patient title', 'secret.pdf', 'Labs', 'Hidden', 'secret title'):
            self.assertNotIn(withheld, blob)

    def test_environment_rejects_remote_url_and_missing_token(self):
        with patch.dict('os.environ', {'CAREVAULT_URL': 'https://evil.example', 'CAREVAULT_TOKEN': 'x'*25}, clear=True):
            self.assert_error('invalid_carevault_origin', Config.from_environment)
        with patch.dict('os.environ', {}, clear=True):
            self.assert_error('carevault_token_missing', Config.from_environment)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.network = FakeNetwork()
        cls.service = MedicineApp(Config('http://127.0.0.1:3040', 'test-token', 'test-key', MODEL), cls.network)
        cls.server = LocalServer(('127.0.0.1', 0), Handler, cls.service, 'test-user', 'test-password-only')
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()

    def request(self, path='/', method='GET', body=None, headers=None):
        auth = base64.b64encode(b'test-user:test-password-only').decode()
        merged = {'Host': HOST, 'Authorization': 'Basic ' + auth, 'X-Requested-With': 'CareVaultDemo', 'Origin': ORIGIN, 'Content-Type': 'application/json'}
        merged.update(headers or {})
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        conn.request(method, path, None if body is None else json.dumps(body), merged)
        response = conn.getresponse()
        result = response.status, dict(response.headers), response.read()
        conn.close()
        return result

    def test_auth_host_and_cross_origin_guards(self):
        self.assertEqual(self.request('/api/records', headers={'Authorization': ''})[0], 401)
        self.assertEqual(self.request(headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/records', headers={'X-Requested-With': ''})[0], 403)
        self.assertEqual(self.request('/api/analyze', 'POST', {'recordIds': [FIRST]}, {'Origin': 'http://evil.example'})[0], 403)
        self.assertFalse(authorized('Basic invalid!', 'a', 'b'))

    def test_assets_headers_no_secrets_and_path_traversal(self):
        for path in ('/', '/app.js', '/style.css'):
            status, headers, body = self.request(path, headers={'Authorization': ''})
            self.assertEqual(status, 200)
            self.assertIn('no-store', headers['Cache-Control'])
            self.assertNotIn(b'test-password-only', body)
            self.assertNotIn(b'test-token', body)
            self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        self.assertEqual(self.request('/../core.py')[0], 404)
        self.assertEqual(self.request('/.env')[0], 404)

    def test_login_check_never_uses_native_browser_challenge(self):
        status, headers, body = self.request('/api/session', headers={'Authorization': ''})
        self.assertEqual(status, 401)
        self.assertNotIn('WWW-Authenticate', headers)
        self.assertEqual(json.loads(body)['error'], 'sign_in_required')
        self.assertEqual(self.request('/api/session')[0], 200)
        for route in ('/api/context', '/api/analyze', '/api/save'):
            self.assertEqual(self.request(route, 'POST', {}, {'Authorization': ''})[0], 401)

    def test_context_analyze_save_http_contract(self):
        status, _, body = self.request('/api/context', 'POST', {'recordIds': [FIRST]})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['context'][0]['recordId'], FIRST)
        status, _, body = self.request('/api/analyze', 'POST', {'recordIds': [FIRST]})
        self.assertEqual(status, 200)
        result = json.loads(body)
        status, _, body = self.request('/api/save', 'POST', {'draftId': result['draftId'], 'report': 'client injection ignored'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['recordId'], SAVED)
        self.assertNotIn('client injection ignored', self.network.writes[-1]['body'])

    def test_shell_describes_groups_without_html_report_rendering(self):
        status, _, body = self.request('/', headers={'Authorization': ''})
        self.assertEqual(status, 200)
        self.assertIn(b'Medicine Review turns selected patient information into a medication discussion brief for a clinician.', body)
        self.assertIn(b'Unverified medicine discussion', body)
        status, _, script = self.request('/app.js', headers={'Authorization': ''})
        self.assertEqual(status, 200)
        self.assertIn(b'Patient Info', script)
        self.assertIn(b'Documents', script)
        self.assertNotIn(b'Record ${', script)
        self.assertNotIn(b'innerHTML', script)
        self.assertNotIn(b'insertAdjacentHTML', script)

    def test_invalid_payloads_and_bounds(self):
        self.assertEqual(self.request('/api/analyze', 'POST', {})[0], 400)
        self.assertEqual(self.request('/api/analyze', 'POST', ['bad'])[0], 400)
        self.assertEqual(self.request('/api/analyze', 'POST', {'recordIds': [FIRST]}, {'Content-Type': 'text/plain'})[0], 400)
        self.assertEqual(self.request('/api/analyze', 'POST', {'text': 'x' * 5000})[0], 400)


if __name__ == '__main__':
    unittest.main()
