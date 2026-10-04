#!/usr/bin/env python3
"""Persistent, single-job worker with a warm supervised processing subprocess."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import multiprocessing
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import tempfile
import time
import uuid

from processor import DocumentProcessor, ProcessingError, MAX_OUTPUT

MAX_ATTEMPTS = 3
LEASE_SECONDS = 30
JOB_SECONDS = 180
ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def read(db, kind, identifier):
    row = db.execute("SELECT body FROM records WHERE kind=? AND id=?", (kind, identifier)).fetchone()
    return json.loads(row[0]) if row else None


def put(db, kind, identifier, value):
    db.execute("INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body", (kind, identifier, json.dumps(value)))


@contextmanager
def transaction(db):
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise


class Queue:
    def __init__(self, directory, now=time.time):
        self.directory = Path(directory).resolve()
        database = self.directory / "vault.sqlite"
        if not database.is_file():
            raise RuntimeError("Run CareVault setup before starting the worker")
        self.db = sqlite3.connect(database, isolation_level=None, timeout=5)
        self.db.execute("PRAGMA busy_timeout=5000")
        self.now = now

    def close(self):
        self.db.close()

    def claim(self):
        with transaction(self.db):
            for row in self.db.execute("SELECT id,body FROM records WHERE kind='processingJob' ORDER BY rowid").fetchall():
                identifier, job = row[0], json.loads(row[1])
                if job.get("status") == "processing" and job.get("leaseUntil", 0) <= self.now():
                    job["status"] = "failed" if job.get("attempts", 0) >= MAX_ATTEMPTS else "queued"
                    put(self.db, "processingJob", identifier, job)
                    doc = read(self.db, "document", identifier)
                    if doc:
                        doc["status"] = job["status"]
                        if doc["status"] == "failed":
                            doc["error"] = "worker_interrupted"
                        put(self.db, "document", identifier, doc)
                if job.get("status") != "queued":
                    continue
                doc = read(self.db, "document", identifier)
                if not ID.fullmatch(identifier) or not doc or doc.get("id") != identifier or doc.get("patientId") != "patient-demo-001" or job.get("attempts", 0) >= MAX_ATTEMPTS:
                    job["status"] = "failed"
                    put(self.db, "processingJob", identifier, job)
                    continue
                token = str(uuid.uuid4())
                job.update(status="processing", attempts=job.get("attempts", 0) + 1,
                           leaseToken=token, leaseUntil=self.now() + LEASE_SECONDS)
                doc.update(status="processing")
                doc.pop("error", None)
                put(self.db, "processingJob", identifier, job)
                put(self.db, "document", identifier, doc)
                return doc, token
        return None

    def heartbeat(self, identifier, token, progress=None):
        with transaction(self.db):
            job = read(self.db, "processingJob", identifier)
            if not job or job.get("status") != "processing" or job.get("leaseToken") != token:
                return False
            job["leaseUntil"] = self.now() + LEASE_SECONDS
            if progress:
                job["progress"] = {"completed": progress[0], "total": progress[1]}
            put(self.db, "processingJob", identifier, job)
            return True

    def identifiers(self, patient):
        values = []
        for row in self.db.execute("SELECT body FROM records WHERE kind='memory'"):
            item = json.loads(row[0])
            if item.get("patientId") == patient and item.get("category") == "identity" and isinstance(item.get("value"), str):
                values.append(item["value"])
        return values

    def directory_for(self, identifier):
        if not ID.fullmatch(identifier):
            raise ProcessingError("invalid_record")
        directory = self.directory / "documents" / identifier
        if directory.is_symlink() or not directory.is_dir() or directory.resolve().parent != (self.directory / "documents").resolve():
            raise ProcessingError("invalid_record_directory")
        return directory

    def finish(self, identifier, token, staging=None, metrics=None, error=None):
        with transaction(self.db):
            job = read(self.db, "processingJob", identifier)
            doc = read(self.db, "document", identifier)
            if not job or not doc or job.get("status") != "processing" or job.get("leaseToken") != token:
                return False
            if error is None:
                expected = ["extracted.txt", "redacted.txt", "redacted.png" if doc["kind"] == "image" else "redacted.pdf"]
                if staging is None or any(not (staging / file).is_file() or (staging / file).is_symlink() for file in expected):
                    raise ProcessingError("missing_outputs")
                if sum((staging / file).stat().st_size for file in expected) > MAX_OUTPUT:
                    raise ProcessingError("output_limit")
                directory = self.directory_for(identifier)
                # The API gates renditions on the document status. Files become
                # visible only after all replacements and this transaction commit.
                for file in expected:
                    (staging / file).chmod(0o600)
                    os.replace(staging / file, directory / file)
                doc.update(status="ready", processing=metrics or {})
                job.update(status="ready", metrics=metrics or {})
            else:
                doc.update(status="failed", error=error)
                job.update(status="failed", error=error)
            job.pop("leaseUntil", None)
            job.pop("leaseToken", None)
            put(self.db, "document", identifier, doc)
            put(self.db, "processingJob", identifier, job)
        return True


def child_loop(pipe):
    # Libraries sometimes log parser text/filenames. Child output is deliberately
    # suppressed; the parent receives only bounded progress, metrics, and codes.
    os.setsid()
    null = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, 1)
    os.dup2(null, 2)
    os.close(null)
    os.umask(0o077)
    processor = DocumentProcessor()
    while True:
        try:
            request = pipe.recv()
        except EOFError:
            return
        if request is None:
            return
        doc, directory, staging, known = request
        try:
            # OCR subprocesses may leave NamedTemporaryFiles on forced exit.
            # The parent removes this private directory even after a timeout.
            os.environ["TMPDIR"] = str(staging)
            tempfile.tempdir = str(staging)
            metrics = processor.process(doc, Path(directory), Path(staging), known,
                                        lambda done, total: pipe.send(("progress", (done, total))))
            pipe.send(("ready", metrics))
        except ProcessingError as error:
            pipe.send(("failed", str(error)))
        except (ImportError, ModuleNotFoundError):
            pipe.send(("failed", "dependencies_missing"))
        except Exception:
            pipe.send(("failed", "processing_failed"))


class Worker:
    def __init__(self, queue, timeout=JOB_SECONDS):
        self.queue, self.timeout = queue, timeout
        self.child = None
        self.pipe = None

    def stop(self):
        if self.child is not None:
            if self.child.is_alive():
                try:
                    if os.getpgid(self.child.pid) == self.child.pid:
                        os.killpg(self.child.pid, signal.SIGTERM)
                    else:
                        self.child.terminate()
                except ProcessLookupError:
                    pass
            self.child.join(timeout=5)
            if self.child.is_alive():
                try:
                    os.killpg(self.child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.child.join(timeout=5)
        if self.pipe is not None:
            self.pipe.close()
        self.child = self.pipe = None

    def start(self):
        if self.child is not None and self.child.is_alive():
            return
        self.stop()
        context = multiprocessing.get_context("spawn")
        self.pipe, child_pipe = context.Pipe()
        self.child = context.Process(target=child_loop, args=(child_pipe,), daemon=True)
        self.child.start()
        child_pipe.close()

    def once(self, processor=None):
        claimed = self.queue.claim()
        if claimed is None:
            return False
        doc, token = claimed
        staging = None
        try:
            directory = self.queue.directory_for(doc["id"])
            for old in directory.glob(".processing-*"):
                if old.is_dir() and not old.is_symlink():
                    shutil.rmtree(old)
            staging = directory / (".processing-" + token)
            staging.mkdir(mode=0o700)
            known = self.queue.identifiers(doc["patientId"])
            if processor is not None:
                # Test-only dependency injection, not a production fallback.
                metrics = processor(doc, directory, staging, known)
                self.queue.finish(doc["id"], token, staging, metrics)
                return True
            self.start()
            self.pipe.send((doc, str(directory), str(staging), known))
            deadline = time.monotonic() + self.timeout
            while time.monotonic() < deadline:
                if not self.queue.heartbeat(doc["id"], token):
                    self.stop()
                    return True
                if self.pipe.poll(2):
                    kind, payload = self.pipe.recv()
                    if kind == "progress":
                        self.queue.heartbeat(doc["id"], token, payload)
                    elif kind == "ready":
                        self.queue.finish(doc["id"], token, staging, payload)
                        return True
                    else:
                        raise ProcessingError(payload)
                if not self.child.is_alive():
                    raise ProcessingError("processor_stopped")
            self.stop()
            raise ProcessingError("processing_timeout")
        except ProcessingError as error:
            self.queue.finish(doc["id"], token, error=str(error))
        except Exception:
            self.stop()
            self.queue.finish(doc["id"], token, error="processing_failed")
        finally:
            if staging is not None:
                shutil.rmtree(staging, ignore_errors=True)
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default=os.environ.get("CAREVAULT_DATA_DIR", "data"))
    parser.add_argument("--once", action="store_true", help="Process at most one queued record")
    args = parser.parse_args()
    os.umask(0o077)
    queue = Queue(args.data_dir)
    import fcntl
    lock = (queue.directory / "document-worker.lock").open("a")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        queue.close()
        lock.close()
        parser.exit(1, "A document worker is already running for this vault.\n")
    worker = Worker(queue)
    print("CareVault document worker running", flush=True)
    try:
        while True:
            worked = worker.once()
            if args.once:
                break
            if not worked:
                time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        worker.stop()
        queue.close()
        lock.close()


if __name__ == "__main__":
    main()
