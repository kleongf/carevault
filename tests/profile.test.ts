import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { endSession, issueSession, type Account } from '../lib/accounts.ts';
import { handleRequest } from '../lib/http.ts';
import { ApiError } from '../lib/policy.ts';
import { profileLimits, type ProfileFields } from '../lib/profile.ts';
import { RecordVault, type DocumentRecord, type RecordAccess, type RecordGrant } from '../lib/records.ts';
import { Store } from '../lib/store.ts';
import type { Integration } from '../lib/types.ts';

const app = 'scan-review', otherApp = 'trial-explorer', origin = 'http://127.0.0.1:3040';
const allAccess: RecordAccess = { text: true, redacted: true, original: true };
const pdfFixture = Buffer.from('%PDF-1.4\nPermission-test fixture, not a real processed PDF.');
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'carevault-profile-'));
  let store = new Store(directory), vault = new RecordVault(store);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const save = (fields: Partial<ProfileFields> = {}) => {
    const current = vault.patientProfile();
    return vault.saveProfile({ version: current.version, fields: { ...current.fields, ...fields } });
  };
  const doc = (id: string) => store.get<DocumentRecord>('document', id)!;
  // Synthetic output files isolate permissions. These are not OCR/redaction evidence.
  const ready = (id: string) => {
    writeFileSync(join(directory, 'documents', id, 'extracted.txt'), 'Synthetic patient profile.');
    writeFileSync(join(directory, 'documents', id, 'redacted.txt'), 'Patient-reported allergies: unknown.');
    writeFileSync(join(directory, 'documents', id, 'redacted.pdf'), pdfFixture);
    store.put('document', id, { ...doc(id), status: 'ready' });
  };
  const connect = (id: string, records: Record<string, RecordAccess>) => vault.saveConnection(id, { connected: true, allowReports: true, records });
  return { directory, save, doc, ready, connect, get store() { return store; }, get vault() { return vault; },
    restart() { store.close(); store = new Store(directory); vault = new RecordVault(store); } };
}
function rejects(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof ApiError && error.code === code);
}

test('profile defaults preserve unknown medical data and first save creates an unshared queued snapshot', t => {
  const f = fixture(t), initial = f.vault.patientProfile();
  assert.equal(initial.version, 0); assert.equal(initial.snapshotId, null); assert.equal(initial.updatedAt, null);
  assert.equal(initial.fields.name, 'Alex Morgan');
  for (const [key, value] of Object.entries(initial.fields)) if (key !== 'name') assert.equal(value, '', key);
  assert.equal(f.store.all('patientProfile').length, 0);
  const saved = f.save(), doc = f.doc(saved.snapshotId!);
  assert.equal(saved.version, 1); assert.ok(saved.updatedAt);
  assert.equal(doc.mime, 'text/plain'); assert.equal(doc.profile, 'healthcare');
  assert.equal(doc.profileSnapshotVersion, 1); assert.equal(doc.status, 'queued');
  assert.equal(f.store.get<{ status: string }>('processingJob', doc.id)?.status, 'queued');
  const text = f.vault.ownerFile(doc.id, 'original').bytes.toString();
  assert.match(text, /patient-reported, unverified/);
  assert.match(text, /Blank or omitted information is unknown, not a negative finding/);
  assert.match(text, /Allergies: Not entered/); assert.match(text, /Medications: Not entered/);
  f.connect(app, {}); assert.deepEqual(f.vault.listForApp(app), []);
  rejects(() => f.vault.ownerText(doc.id), 'record_not_ready');
  assert.equal(f.vault.dashboard().records[0].profileIdentifiers, undefined);
});

test('profile edits persist across restart without rewriting prior snapshots or legacy memories', t => {
  const f = fixture(t), memories = f.store.all('memory');
  const first = f.save({ name: '  Jordan Example  ', email: 'jordan@example.test', medications: 'Patient reports an inhaler; name unknown.', allergies: 'Not sure' });
  const before = readFileSync(join(f.directory, 'documents', first.snapshotId!, 'input.txt'));
  const second = f.save({ email: '', medications: 'No medication information entered.' });
  assert.notEqual(first.snapshotId, second.snapshotId); assert.equal(second.version, 2);
  assert.equal(second.fields.name, 'Jordan Example');
  assert.deepEqual(readFileSync(join(f.directory, 'documents', first.snapshotId!, 'input.txt')), before);
  assert.equal(f.doc(first.snapshotId!).superseded, true);
  assert.deepEqual(f.doc(first.snapshotId!).profileIdentifiers, ['Jordan Example', 'jordan@example.test']);
  assert.deepEqual(f.doc(second.snapshotId!).profileIdentifiers, ['Jordan Example']);
  assert.deepEqual(f.vault.dashboard().records.map(item => item.id), [second.snapshotId]);
  f.restart();
  assert.deepEqual(f.vault.patientProfile(), second);
  assert.deepEqual(f.store.all('memory'), memories);
  assert.deepEqual(f.vault.ownerFile(first.snapshotId!, 'original').bytes, before);
});

test('profile validation, normalized no-op saves, and competing versions cannot create extra snapshots', t => {
  const f = fixture(t), initial = f.vault.patientProfile();
  const invalid = [null, [], {}, { version: -1, fields: initial.fields }, { version: 0.5, fields: initial.fields },
    { version: 0, fields: {} }, { version: 0, fields: { ...initial.fields, extra: 'not allowed' } },
    { version: 0, fields: { ...initial.fields, allergies: false } },
    ...Object.entries(profileLimits).map(([key, limit]) => ({ version: 0, fields: { ...initial.fields, [key]: 'x'.repeat(limit + 1) } })),
    ...['2025-02-29', '2100-01-01', '1899-12-31', '2020-13-01', 'not-a-date'].map(dateOfBirth => ({ version: 0, fields: { ...initial.fields, dateOfBirth } })),
    { version: 0, fields: { ...initial.fields, email: 'invalid-email' } },
    { version: 0, fields: { ...initial.fields, name: 'Embedded\u0000control' } }];
  for (const input of invalid) assert.throws(() => f.vault.saveProfile(input), ApiError);
  assert.equal(f.store.all('document').length, 0); assert.equal(f.vault.patientProfile().version, 0);
  const first = f.save({ dateOfBirth: '2000-02-29', carePreferences: 'Explain options' });
  const unchanged = f.vault.saveProfile({ version: first.version, fields: { ...first.fields, name: ` ${first.fields.name} ` } });
  assert.deepEqual(unchanged, first); assert.equal(f.store.all('document').length, 1);
  const competingStore = new Store(f.directory);
  try {
    const competing = new RecordVault(competingStore), stale = competing.patientProfile();
    const winner = f.save({ carePreferences: 'Use plain language' });
    rejects(() => competing.saveProfile({ version: stale.version, fields: { ...stale.fields, carePreferences: 'Losing edit' } }), 'profile_conflict');
    assert.deepEqual(competing.patientProfile(), winner);
  } finally { competingStore.close(); }
  assert.equal(f.store.all('document').length, 2); assert.equal(f.store.all('processingJob').length, 2);
  assert.equal(readdirSync(join(f.directory, 'documents')).length, 2);
});

test('profile HTTP routes enforce role, Origin, competing saves, and session recheck after an awaited body', async t => {
  const f = fixture(t);
  const cookie = (role: 'patient' | 'developer') => `carevault_session=${issueSession(f.store, f.store.get<Account>('account', `demo-${role}`)!)}`;
  const patient = cookie('patient'), developer = cookie('developer');
  const call = (method: string, value?: unknown, headers: Record<string, string> = {}) => handleRequest(new Request(origin + '/api/patient/profile', {
    method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }), f.store);
  const input = { version: 0, fields: f.vault.patientProfile().fields };
  for (const method of ['GET', 'PUT']) {
    assert.equal((await call(method, method === 'PUT' ? input : undefined)).status, 401);
    assert.equal((await call(method, method === 'PUT' ? input : undefined, { Cookie: developer })).status, 403);
    assert.equal((await call(method, method === 'PUT' ? input : undefined, { Authorization: `Bearer ${f.store.credentials.integrationTokens[app]}` })).status, 401);
  }
  assert.equal((await call('PUT', input, { Cookie: patient, Origin: 'https://foreign.test' })).status, 403);
  const read = await call('GET', undefined, { Cookie: patient });
  assert.equal(read.status, 200); assert.match(read.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(await read.json(), f.vault.patientProfile());
  const responses = await Promise.all([
    call('PUT', { ...input, fields: { ...input.fields, carePreferences: 'First' } }, { Cookie: patient }),
    call('PUT', { ...input, fields: { ...input.fields, carePreferences: 'Second' } }, { Cookie: patient }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const before = f.vault.patientProfile();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const request = new Request(origin + '/api/patient/profile', { method: 'PUT', headers: { Cookie: patient, Origin: origin, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
  const pending = handleRequest(request, f.store);
  assert.equal(stream.locked, true, 'route must reach the awaited body before session revocation');
  endSession(request, f.store);
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ version: before.version, fields: { ...before.fields, name: 'Must not persist' } }))); controller.close();
  assert.equal((await pending).status, 401);
  assert.deepEqual(f.vault.patientProfile(), before);
  assert.equal(f.store.all('document').length, 1);
});

test('superseded profiles deny every representation and cannot be restored through regrant or stale worker metadata', t => {
  const f = fixture(t), first = f.save(); f.ready(first.snapshotId!);
  const originalDoc = f.doc(first.snapshotId!);
  f.connect(app, { [first.snapshotId!]: allAccess });
  assert.ok(f.vault.textForApp(app, first.snapshotId!).text);
  assert.ok(f.vault.fileForApp(app, first.snapshotId!, 'original').bytes.length);
  assert.ok(f.vault.fileForApp(app, first.snapshotId!, 'redacted').bytes.length);
  const next = f.save({ conditions: 'Patient reports asthma.' });
  assert.equal(f.store.get<RecordGrant>('recordGrant', app)!.records[first.snapshotId!], undefined);
  rejects(() => f.connect(app, { [first.snapshotId!]: allAccess }), 'profile_superseded');
  // A late worker may publish an older document object; the current-profile pointer still wins.
  f.store.put('document', originalDoc.id, { ...originalDoc, superseded: false, status: 'ready' });
  const grant = f.store.get<RecordGrant>('recordGrant', app)!;
  f.store.put('recordGrant', app, { ...grant, records: { [first.snapshotId!]: allAccess } });
  rejects(() => f.vault.textForApp(app, first.snapshotId!), 'access_not_authorized');
  for (const variant of ['original', 'redacted'] as const) rejects(() => f.vault.fileForApp(app, first.snapshotId!, variant), 'access_not_authorized');
  rejects(() => f.connect(app, { [first.snapshotId!]: allAccess }), 'profile_superseded');
  assert.deepEqual(f.vault.listForApp(app), []);
  assert.deepEqual(f.vault.dashboard().records.map(item => item.id), [next.snapshotId]);
});

test('profile supersession invalidates old receipts and descendant reports while preserving unrelated grants', t => {
  const f = fixture(t), first = f.save(); f.ready(first.snapshotId!);
  const unrelated = f.vault.upload(pdfFixture, 'application/pdf', 'Unrelated fixture'); f.ready(unrelated.id);
  f.store.put('integration', app, { ...f.store.get<Integration>('integration', app)!, recordApiOnly: true });
  f.connect(app, { [first.snapshotId!]: allAccess, [unrelated.id]: allAccess });
  f.connect(otherApp, { [first.snapshotId!]: allAccess, [unrelated.id]: allAccess });
  const untouched = f.connect('formulation-review', { [unrelated.id]: allAccess });
  const oldReceipt = f.vault.textForApp(app, first.snapshotId!).requestId;
  const report = f.vault.report(app, { title: 'Profile discussion', body: 'Unverified synthetic report', sourceReceiptIds: [oldReceipt] }); f.ready(report.id);
  f.connect(otherApp, { [first.snapshotId!]: allAccess, [unrelated.id]: allAccess, [report.id]: allAccess });
  assert.ok(f.vault.textForApp(otherApp, report.id).text);
  const priorGrant = f.store.get<RecordGrant>('recordGrant', app)!;
  const second = f.save({ allergies: 'Patient reports an unknown reaction.' });
  rejects(() => f.vault.report(app, { title: 'Old context', body: 'Must not save', sourceReceiptIds: [oldReceipt] }), 'invalid_source_receipt');
  rejects(() => f.vault.textForApp(otherApp, report.id), 'access_not_authorized');
  assert.deepEqual(f.store.get<RecordGrant>('recordGrant', 'formulation-review'), untouched);
  const changed = f.store.get<RecordGrant>('recordGrant', app)!;
  assert.equal(changed.version, priorGrant.version + 1); assert.equal(changed.connected, true); assert.equal(changed.allowReports, true);
  assert.deepEqual(changed.records, { [unrelated.id]: allAccess });
  assert.ok(f.vault.textForApp(app, unrelated.id).text);
  assert.ok(!f.vault.listForApp(app).some(item => item.id === second.snapshotId));
  const freshReceipt = f.vault.textForApp(app, unrelated.id).requestId;
  const omitted = f.vault.report(app, { title: 'Omitted profile source', body: 'Unverified', sourceReceiptIds: [freshReceipt] }); f.ready(omitted.id);
  assert.ok(omitted.dependencies.some(source => source.recordId === first.snapshotId));
  f.connect(otherApp, { [unrelated.id]: allAccess, [omitted.id]: allAccess });
  rejects(() => f.vault.textForApp(otherApp, omitted.id), 'access_not_authorized');
});

test('failure after profile and grant writes rolls back all metadata and removes the new snapshot directory', t => {
  const f = fixture(t), first = f.save();
  f.connect(app, { [first.snapshotId!]: allAccess });
  const kinds = ['patientProfile', 'document', 'processingJob', 'recordGrant', 'activity'];
  const before = kinds.map(kind => f.store.all(kind));
  const files = readdirSync(join(f.directory, 'documents'));
  const put = f.store.put.bind(f.store);
  const forced = t.mock.method(f.store, 'put', (kind: string, id: string, body: unknown) => {
    if (kind === 'processingJob') throw new Error('Injected profile job persistence failure');
    put(kind, id, body);
  });
  assert.throws(() => f.save({ allergies: 'Must roll back' }), /Injected profile job persistence failure/);
  forced.mock.restore();
  assert.deepEqual(kinds.map(kind => f.store.all(kind)), before);
  assert.deepEqual(readdirSync(join(f.directory, 'documents')), files);
  assert.equal(f.doc(first.snapshotId!).superseded, undefined);
  assert.match(readFileSync(join(f.directory, 'documents', first.snapshotId!, 'input.txt'), 'utf8'), /Allergies: Not entered/);
});

test('profile count and byte quotas preserve the current profile, grants, jobs and original files', t => {
  const f = fixture(t), first = f.save(), original = f.doc(first.snapshotId!);
  const grant = f.connect(app, { [first.snapshotId!]: allAccess });
  const dirs = readdirSync(join(f.directory, 'documents'));
  f.store.put('document', original.id, { ...original, size: 300 * 1024 * 1024 });
  rejects(() => f.save({ name: 'Byte quota rejection' }), 'vault_storage_limit');
  f.store.put('document', original.id, original);
  for (let index = 0; index < 99; index++) {
    const id = randomUUID(); f.store.put('document', id, { ...original, id, size: 1, profileSnapshotVersion: undefined });
  }
  rejects(() => f.save({ name: 'Count quota rejection' }), 'vault_storage_limit');
  assert.deepEqual(f.vault.patientProfile(), first);
  assert.deepEqual(f.store.get<RecordGrant>('recordGrant', app), grant);
  assert.equal(f.store.all('processingJob').length, 1);
  assert.equal(f.store.all('document').length, 100);
  assert.deepEqual(readdirSync(join(f.directory, 'documents')), dirs);
  assert.deepEqual(f.doc(original.id), original);
});
