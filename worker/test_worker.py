"""Queue/security unit tests; injected processors are explicitly not OCR evidence."""
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import uuid

from processor import IdentifierDetector, ProcessingError, merge_spans, redact_text
from types import SimpleNamespace
from run import Queue, Worker, put, read, MAX_ATTEMPTS


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        db = sqlite3.connect(self.directory / "vault.sqlite")
        db.execute("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))")
        db.close()
        self.now = 1000
        self.queue = Queue(self.directory, now=lambda: self.now)
        self.worker = Worker(self.queue)

    def tearDown(self):
        self.worker.stop()
        self.queue.close()
        self.temp.cleanup()

    def document(self):
        identifier = str(uuid.uuid4())
        doc = dict(id=identifier, patientId="patient-demo-001", kind="document", mime="application/pdf", status="queued", profile="identifiers")
        put(self.queue.db, "document", identifier, doc)
        put(self.queue.db, "processingJob", identifier, dict(id=identifier, status="queued", attempts=0))
        path = self.directory / "documents" / identifier
        path.mkdir(parents=True)
        (path / "input.pdf").write_bytes(b"%PDF-not-parsed-by-unit-tests")
        return doc

    @staticmethod
    def fake_outputs(doc, directory, staging, known):
        (staging / "extracted.txt").write_text("Alex Morgan cough", "utf8")
        (staging / "redacted.txt").write_text("[REDACTED] cough", "utf8")
        (staging / "redacted.pdf").write_bytes(b"synthetic processor output")
        return {"pages": 1, "seconds": 0}

    def test_claims_are_exclusive_and_restart_recovers_expired_lease(self):
        doc = self.document()
        claimed, token = self.queue.claim()
        self.assertEqual(claimed["id"], doc["id"])
        second = Queue(self.directory, now=lambda: self.now)
        try:
            self.assertIsNone(second.claim())
            self.now += 31
            recovered, new_token = second.claim()
            self.assertNotEqual(token, new_token)
            self.assertEqual(recovered["id"], doc["id"])
            self.assertFalse(self.queue.finish(doc["id"], token, error="stale"))
        finally:
            second.close()

    def test_heartbeat_prevents_lease_recovery(self):
        doc = self.document()
        _, token = self.queue.claim()
        self.now += 20
        self.assertTrue(self.queue.heartbeat(doc["id"], token, (1, 2)))
        self.now += 20
        self.assertIsNone(self.queue.claim())
        job = read(self.queue.db, "processingJob", doc["id"])
        self.assertEqual(job["progress"], {"completed": 1, "total": 2})

    def test_recovery_stops_after_finite_attempts(self):
        doc = self.document()
        for _ in range(MAX_ATTEMPTS):
            self.assertIsNotNone(self.queue.claim())
            self.now += 31
        self.assertIsNone(self.queue.claim())
        self.assertEqual(read(self.queue.db, "document", doc["id"])["status"], "failed")

    def test_publication_waits_for_complete_outputs_and_survives_restart(self):
        doc = self.document()
        def fake(*args):
            self.assertEqual(read(self.queue.db, "document", doc["id"])["status"], "processing")
            self.assertFalse((self.directory / "documents" / doc["id"] / "redacted.pdf").exists())
            return self.fake_outputs(*args)
        self.assertTrue(self.worker.once(fake))
        self.assertEqual(read(self.queue.db, "document", doc["id"])["status"], "ready")
        output = self.directory / "documents" / doc["id"] / "redacted.pdf"
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        second = Queue(self.directory)
        try:
            self.assertIsNone(second.claim())
            self.assertEqual(read(second.db, "document", doc["id"])["status"], "ready")
        finally:
            second.close()

    def test_incomplete_conversion_never_publishes_partial_outputs(self):
        doc = self.document()
        def failing(doc, directory, staging, known):
            (staging / "redacted.pdf").write_bytes(b"partial")
            raise ProcessingError("incomplete_conversion")
        self.worker.once(failing)
        directory = self.directory / "documents" / doc["id"]
        self.assertFalse((directory / "redacted.pdf").exists())
        self.assertEqual(list(directory.glob(".processing-*")), [])
        self.assertEqual(read(self.queue.db, "document", doc["id"])["error"], "incomplete_conversion")

    def test_missing_output_and_symlink_cannot_mark_ready(self):
        for symlink in [False, True]:
            doc = self.document()
            def invalid(doc, directory, staging, known):
                self.fake_outputs(doc, directory, staging, known)
                target = staging / "redacted.txt"
                target.unlink()
                if symlink:
                    target.symlink_to(directory / "input.pdf")
            self.worker.once(invalid)
            self.assertEqual(read(self.queue.db, "document", doc["id"])["error"], "missing_outputs")

    def test_errors_do_not_persist_medical_text_or_external_tracebacks(self):
        doc = self.document()
        def failing(*args):
            raise RuntimeError("Alex Morgan diagnosis hidden here")
        self.worker.once(failing)
        job = read(self.queue.db, "processingJob", doc["id"])
        self.assertEqual(job["error"], "processing_failed")
        self.assertNotIn("Alex", json.dumps(job))

    def test_identifier_lookup_is_patient_scoped_and_paths_are_checked(self):
        put(self.queue.db, "memory", "own", dict(patientId="patient-demo-001", category="identity", value="Alex Morgan"))
        put(self.queue.db, "memory", "other", dict(patientId="patient-demo-002", category="identity", value="Other Patient"))
        put(self.queue.db, "memory", "topic", dict(patientId="patient-demo-001", category="mental_health", value="Private topic"))
        self.assertEqual(self.queue.identifiers("patient-demo-001"), ["Alex Morgan"])
        with self.assertRaises(ProcessingError):
            self.queue.directory_for("../../outside")

    def test_empty_queue_does_not_start_models(self):
        self.assertFalse(self.worker.once())
        self.assertIsNone(self.worker.child)

    def test_overlapping_identifiers_are_redacted_once(self):
        self.assertEqual(merge_spans([(2, 5), (3, 9), (9, 10)]), [(2, 10)])
        self.assertEqual(redact_text("Alex Morgan cough", [(0, 4), (0, 11)]), "[REDACTED] cough")

    def test_ocr_split_email_is_redacted_completely(self):
        detector = IdentifierDetector.__new__(IdentifierDetector)
        detector.analyzer = SimpleNamespace(analyze=lambda **kwargs: [])
        text = "Email: alex.\nmorgan@example.test\nPatient has cough."
        result = redact_text(text, detector.spans(text, "identifiers", []))
        self.assertEqual(result, "Email: [REDACTED]\nPatient has cough.")

    def test_healthcare_dates_do_not_remove_symptom_duration(self):
        detector = IdentifierDetector.__new__(IdentifierDetector)
        text = "Cough for two weeks. Visit 2026-10-03."
        detector.analyzer = SimpleNamespace(analyze=lambda **kwargs: [
            SimpleNamespace(start=10, end=19, entity_type="DATE_TIME"),
            SimpleNamespace(start=text.index("2026"), end=text.index("2026") + 10, entity_type="DATE_TIME")])
        result = redact_text(text, detector.spans(text, "healthcare", []))
        self.assertEqual(result, "Cough for two weeks. Visit [REDACTED].")


if __name__ == "__main__":
    unittest.main()
