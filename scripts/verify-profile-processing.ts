// Local integration check: actual worker, temporary vault, no model provider calls.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../lib/store.ts';
import { RecordVault } from '../lib/records.ts';

const directory = mkdtempSync(join(tmpdir(), 'carevault-profile-worker-'));
const store = new Store(directory), vault = new RecordVault(store);
try {
  const initial = vault.patientProfile();
  const saved = vault.saveProfile({ version: initial.version, fields: { ...initial.fields,
    name: 'Juniper Example', email: 'juniper@example.test', phone: '+1 202-555-0184',
    address: '92 Fictional Terrace', emergencyContact: 'Rowan Example, +1 202-555-0137',
    allergies: 'Patient reports peanut allergy', medications: 'Illustrative medication only',
  } });
  const worker = spawnSync(resolve('worker/.venv/bin/python'), ['worker/run.py', '--data-dir', directory, '--once'], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(worker.status, 0, 'Worker must complete successfully');
  const doc = vault.dashboard().records.find(item => item.id === saved.snapshotId)!;
  assert.equal(doc.status, 'ready');
  assert.ok(vault.ownerText(doc.id).includes('Juniper Example'));
  const redacted = vault.ownerText(doc.id, true);
  for (const value of ['Juniper Example', 'juniper@example.test', '+1 202-555-0184', '92 Fictional Terrace', 'Rowan Example']) assert.ok(!redacted.includes(value), 'Selected synthetic identifier must be redacted');
  assert.ok(redacted.includes('peanut'));
  assert.ok(redacted.includes('patient-reported'));
  assert.equal(vault.ownerFile(doc.id, 'redacted').mime, 'application/pdf');
  assert.deepEqual(vault.ownerFile(doc.id, 'redacted').bytes.subarray(0, 5), Buffer.from('%PDF-'));
  vault.saveConnection('scan-review', { connected: true, allowReports: true, records: { [doc.id]: { text: true, redacted: false, original: false } } });
  const read = vault.textForApp('scan-review', doc.id);
  assert.equal(read.text, redacted);
  vault.saveProfile({ version: saved.version, fields: { ...saved.fields, allergies: 'Updated patient-reported allergy note' } });
  assert.throws(() => vault.textForApp('scan-review', doc.id));
  assert.throws(() => vault.report('scan-review', { title: 'Stale draft', body: 'Synthetic draft', sourceReceiptIds: [read.requestId] }));
  assert.deepEqual(vault.listForApp('scan-review'), []);
  console.log('Profile worker check passed: real extraction/redaction, explicit sharing, old-context and receipt invalidation.');
} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
