import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { ApiError } from '../lib/policy.ts';
import { RecordVault, type DocumentRecord, type RecordAccess, type RecordReceipt } from '../lib/records.ts';
import { Store } from '../lib/store.ts';
import { Vault } from '../lib/service.ts';
import type { Integration } from '../lib/types.ts';

const appId = 'scan-review', otherApp = 'trial-explorer';
const pdf = Buffer.from('%PDF-1.4\nservice-test fixture; not a parseable PDF');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'carevault-records-'));
  let store = new Store(directory), vault = new RecordVault(store);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const upload = () => vault.upload(pdf, 'application/pdf', 'Alex Morgan confidential report');
  const connect = (records: Record<string, RecordAccess>, integration = appId, allowReports = true) => vault.saveConnection(integration, { connected: true, allowReports, records });
  // Explicit synthetic processing outputs exercise authorization/persistence, not OCR or redaction correctness.
  const ready = (doc: DocumentRecord) => {
    const folder = join(directory, 'documents', doc.id);
    writeFileSync(join(folder, 'extracted.txt'), 'Alex Morgan has a cough.');
    writeFileSync(join(folder, 'redacted.txt'), '[REDACTED] has a cough.');
    writeFileSync(join(folder, doc.kind === 'image' ? 'redacted.png' : 'redacted.pdf'), doc.kind === 'image' ? png : pdf);
    store.put('document', doc.id, { ...doc, status: 'ready' });
  };
  return { directory, get store() { return store; }, get vault() { return vault; }, upload, connect, ready,
    restart() { store.close(); store = new Store(directory); vault = new RecordVault(store); } };
}
function denied(fn: () => unknown, code = 'access_not_authorized') { assert.throws(fn, (error: unknown) => error instanceof ApiError && error.code === code); }
function access(values: Partial<RecordAccess>): RecordAccess { return { text: false, redacted: false, original: false, ...values }; }

test('upload is private, queued, persisted, and cannot expose unfinished renditions', t => {
  const f = setup(t), doc = f.upload();
  assert.equal(doc.status, 'queued');
  assert.deepEqual(f.vault.ownerFile(doc.id, 'original').bytes, pdf);
  assert.equal((f.store.get<{ status: string }>('processingJob', doc.id))?.status, 'queued');
  assert.equal(statSync(join(f.directory, 'documents', doc.id)).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.directory, 'documents', doc.id, 'input.pdf')).mode & 0o777, 0o600);
  denied(() => f.vault.ownerText(doc.id), 'record_not_ready');
  denied(() => f.vault.ownerFile(doc.id, 'redacted'), 'record_not_ready');
  denied(() => f.vault.listForApp(appId));
  f.connect({});
  assert.deepEqual(f.vault.listForApp(appId), []);
  f.restart();
  assert.equal(f.vault.dashboard().records[0].id, doc.id);
  assert.deepEqual(f.vault.ownerFile(doc.id, 'original').bytes, pdf);
  assert.ok(!f.vault.dashboard().apps.some(app => app.id === 'care-assistant'));
  const serialized = JSON.stringify(f.vault.dashboard());
  for (const token of Object.values(f.store.credentials.integrationTokens)) assert.ok(!serialized.includes(token));
});

test('upload validates byte limits, magic, profile and fixed filesystem paths', t => {
  const f = setup(t);
  for (const [bytes, mime] of [[Buffer.alloc(0), 'application/pdf'], [pdf, 'image/png'], [Buffer.from('<script>'), 'application/pdf'], [pdf, 'text/plain']] as const) assert.throws(() => f.vault.upload(bytes, mime, 'record'), ApiError);
  denied(() => f.vault.upload(Buffer.alloc(20 * 1024 * 1024 + 1), 'application/pdf', 'record'), 'upload_too_large');
  denied(() => f.vault.upload(pdf, 'application/pdf', 'record', 'unknown' as never), 'invalid_profile');
  denied(() => f.vault.upload(pdf, 'application/pdf', ' '), 'invalid_title');
  const doc = f.vault.upload(png, 'image/png', '../../credentials.json');
  assert.equal(doc.kind, 'image');
  assert.deepEqual(readFileSync(join(f.directory, 'documents', doc.id, 'input.png')), png);
  denied(() => f.vault.ownerFile('../../credentials.json', 'original'), 'not_found');
  denied(() => f.vault.ownerFile(doc.id, '../../credentials.json' as never), 'invalid_representation');
});

test('independent permissions release redacted text and generic metadata only', t => {
  const f = setup(t), doc = f.upload(); f.ready(doc);
  f.connect({ [doc.id]: access({ text: true }) });
  const items = f.vault.listForApp(appId);
  assert.deepEqual(Object.keys(items[0]).sort(), ['allowed', 'id', 'kind', 'mime', 'status']);
  assert.ok(!JSON.stringify(items).includes('Alex'));
  assert.equal(f.vault.ownerText(doc.id), 'Alex Morgan has a cough.');
  const released = f.vault.textForApp(appId, doc.id);
  assert.equal(released.text, '[REDACTED] has a cough.');
  assert.equal(f.store.get<RecordReceipt>('recordReceipt', released.requestId)?.representation, 'text');
  denied(() => f.vault.fileForApp(appId, doc.id, 'original'));
  denied(() => f.vault.fileForApp(appId, doc.id, 'redacted'));
  f.connect({ [doc.id]: access({ original: true }) });
  assert.deepEqual(f.vault.fileForApp(appId, doc.id, 'original').bytes, pdf);
  denied(() => f.vault.textForApp(appId, doc.id));
  assert.ok(!f.vault.listForApp(appId).some(item => item.id === f.upload().id));
});

test('missing, failed, symlinked and cross-patient outputs fail closed without original fallback', t => {
  const f = setup(t), doc = f.upload(); f.ready(doc);
  f.connect({ [doc.id]: access({ text: true, redacted: true }) });
  rmSync(join(f.directory, 'documents', doc.id, 'redacted.pdf'));
  denied(() => f.vault.fileForApp(appId, doc.id, 'redacted'), 'representation_unavailable');
  const path = join(f.directory, 'documents', doc.id, 'redacted.txt');
  rmSync(path); symlinkSync(join(f.directory, 'credentials.json'), path);
  denied(() => f.vault.textForApp(appId, doc.id), 'representation_unavailable');
  f.store.put('document', doc.id, { ...doc, status: 'failed' });
  denied(() => f.vault.ownerText(doc.id), 'record_not_ready');
  f.store.put('document', doc.id, { ...doc, patientId: 'someone-else' });
  denied(() => f.vault.ownerFile(doc.id, 'original'), 'not_found');
  denied(() => f.vault.fileForApp(appId, doc.id, 'original'));
  assert.deepEqual(f.vault.listForApp(appId), []);
});

test('grants validate ownership, boolean shapes and registered capabilities', t => {
  const f = setup(t), doc = f.upload();
  const app = f.store.get<Integration>('integration', appId)!;
  app.capabilities = ['text:read']; f.store.put('integration', appId, app);
  denied(() => f.connect({ [doc.id]: access({ text: true }) }), 'unsupported_capability');
  denied(() => f.connect({ [doc.id]: access({ original: true }) }, appId, false), 'unsupported_capability');
  const first = f.connect({ [doc.id]: access({ text: true }) }, appId, false);
  assert.equal(first.version, 1);
  const second = f.connect({}, appId, false); assert.equal(second.version, 2);
  denied(() => f.connect({ [randomUUID()]: access({ text: true }) }, appId, false), 'not_found');
  denied(() => f.connect({ [doc.id]: { text: 'true', original: false, redacted: false } as never }, appId, false), 'invalid_record_grant');
  denied(() => f.vault.saveConnection(appId, { connected: true, allowReports: false, records: [] }), 'invalid_record_grant');
});

test('record connection does not widen legacy access and revocation disables both APIs', t => {
  const f = setup(t), doc = f.upload(), old = f.store.get<Integration>('integration', appId)!.grant;
  f.connect({ [doc.id]: access({ original: true }) });
  assert.deepEqual(f.store.get<Integration>('integration', appId)!.grant, old);
  const legacy = f.store.get<Integration>('integration', appId)!;
  legacy.grant.connected = true; legacy.grant.scopes = ['facts:read']; f.store.put('integration', appId, legacy);
  f.vault.revoke(appId);
  denied(() => f.vault.fileForApp(appId, doc.id, 'original'));
  denied(() => new Vault(f.store).read(appId, { patientId: doc.patientId }));
  assert.equal(f.store.get<Integration>('integration', appId)!.grant.connected, false);
});

test('report receipts are app-bound and become invalid after permissions change', t => {
  const f = setup(t), doc = f.upload();
  f.connect({ [doc.id]: access({ original: true }) });
  f.connect({ [doc.id]: access({ original: true }) }, otherApp);
  const receipt = f.vault.fileForApp(appId, doc.id, 'original').requestId;
  const body = { title: 'Report', body: 'Unverified result', sourceReceiptIds: [receipt] };
  denied(() => f.vault.report(otherApp, body), 'invalid_source_receipt');
  denied(() => f.vault.report(appId, { ...body, sourceReceiptIds: [] }), 'invalid_report');
  denied(() => f.vault.report(appId, { ...body, sourceReceiptIds: [randomUUID()] }), 'invalid_source_receipt');
  f.connect({ [doc.id]: access({ original: true }) });
  denied(() => f.vault.report(appId, body), 'invalid_source_receipt');
  f.vault.revoke(appId); denied(() => f.vault.report(appId, body));
});

test('incoming reports are attributed, queued and unshared; downstream source access is inherited', t => {
  const f = setup(t), doc = f.upload();
  f.store.put('integration', appId, { ...f.store.get<Integration>('integration', appId)!, recordApiOnly: true });
  f.connect({ [doc.id]: access({ original: true }) });
  const receipt = f.vault.fileForApp(appId, doc.id, 'original').requestId;
  const report = f.vault.report(appId, { title: 'Lung findings', body: 'Unverified: possible finding', sourceReceiptIds: [receipt] });
  assert.equal(report.status, 'queued'); assert.equal(report.mime, 'text/plain');
  assert.equal(report.source?.integrationId, appId);
  assert.deepEqual(report.dependencies, [{ recordId: doc.id, representation: 'original' }]);
  assert.equal(f.vault.ownerFile(report.id, 'original').bytes.toString(), 'Unverified: possible finding');
  assert.ok(!f.vault.listForApp(appId).some(item => item.id === report.id));
  f.ready(report);
  f.connect({ [report.id]: access({ text: true }) }, otherApp);
  denied(() => f.vault.textForApp(otherApp, report.id));
  f.connect({ [report.id]: access({ text: true }), [doc.id]: access({ redacted: true }) }, otherApp);
  denied(() => f.vault.textForApp(otherApp, report.id));
  f.connect({ [report.id]: access({ text: true }), [doc.id]: access({ original: true }) }, otherApp);
  assert.equal(f.vault.textForApp(otherApp, report.id).text, '[REDACTED] has a cough.');
  f.connect({ [report.id]: access({ text: true }) }, otherApp);
  denied(() => f.vault.textForApp(otherApp, report.id));
});

test('cyclic, missing or absent report provenance cannot be shared', t => {
  const f = setup(t), doc = f.upload(); f.ready(doc);
  f.connect({ [doc.id]: access({ text: true }) });
  f.store.put('document', doc.id, { ...doc, status: 'ready', dependencies: [{ recordId: doc.id, representation: 'text' }] });
  denied(() => f.vault.textForApp(appId, doc.id));
  f.store.put('document', doc.id, { ...doc, status: 'ready', dependencies: [{ recordId: randomUUID(), representation: 'text' }] });
  denied(() => f.vault.textForApp(appId, doc.id));
  f.store.put('document', doc.id, { ...doc, status: 'ready', kind: 'report', dependencies: [] });
  denied(() => f.vault.textForApp(appId, doc.id));
});

test('count and original-byte storage quotas reject writes without orphan database jobs', t => {
  const f = setup(t), doc = f.upload();
  f.store.put('document', doc.id, { ...doc, size: 300 * 1024 * 1024 });
  denied(() => f.upload(), 'vault_storage_limit');
  assert.equal(f.store.all('processingJob').length, 1);
  f.store.put('document', doc.id, { ...doc, size: 1 });
  for (let i = 0; i < 99; i++) { const id = randomUUID(); f.store.put('document', id, { ...doc, id, size: 1 }); }
  denied(() => f.upload(), 'vault_storage_limit');
  assert.equal(f.store.all('processingJob').length, 1);
});

test('report dependencies include prior disclosures even when the integration omits their receipts', t => {
  const f = setup(t), sensitive = f.upload(), other = f.upload();
  f.ready(sensitive); f.ready(other);
  f.connect({ [sensitive.id]: access({ original: true }), [other.id]: access({ text: true }) });
  f.vault.fileForApp(appId, sensitive.id, 'original');
  // Remove sensitive access before creating a report using a fresh benign receipt.
  f.connect({ [other.id]: access({ text: true }) });
  const receipt = f.vault.textForApp(appId, other.id);
  const report = f.vault.report(appId, { title: 'Untrusted report', body: 'Content may derive from any earlier disclosure.', sourceReceiptIds: [receipt.requestId] });
  assert.ok(report.dependencies.some(dep => dep.recordId === sensitive.id && dep.representation === 'original'));
  f.ready(report);
  f.connect({ [other.id]: access({ text: true }), [report.id]: access({ text: true }) }, otherApp);
  denied(() => f.vault.textForApp(otherApp, report.id));
});

test('legacy disconnect updates also stop v2 access and connected legacy apps remain visible for revocation', t => {
  const f = setup(t), doc = f.upload(), legacy = new Vault(f.store);
  const app = legacy.integration(appId);
  legacy.saveGrant(appId, { ...app.grant, connected: true });
  const companion = legacy.integration('care-assistant');
  legacy.saveGrant(companion.id, { ...companion.grant, connected: true });
  assert.ok(f.vault.dashboard().apps.find(app => app.id === 'care-assistant')?.legacyConnected);
  f.connect({ [doc.id]: access({ original: true }) });
  legacy.saveGrant(appId, { ...app.grant, connected: false });
  denied(() => f.vault.fileForApp(appId, doc.id, 'original'));
  f.vault.revoke('care-assistant');
  assert.ok(!f.vault.dashboard().apps.some(app => app.id === 'care-assistant'));
});

test('reports from legacy apps remain owner-only because historical disclosures are incomplete', t => {
  const f = setup(t), doc = f.upload(), legacy = new Vault(f.store);
  const sourceApp = legacy.integration(appId);
  sourceApp.grant.connected = true; sourceApp.grant.categories.mental_health = 'share'; sourceApp.grant.scopes = ['facts:read'];
  legacy.saveGrant(appId, sourceApp.grant);
  legacy.read(appId, { patientId: 'patient-demo-001', categories: ['mental_health'] });
  legacy.restrict('mental-note', 'private');
  f.connect({ [doc.id]: access({ original: true }) });
  const receipt = f.vault.fileForApp(appId, doc.id, 'original');
  const report = f.vault.report(appId, { title: 'Legacy-derived report', body: 'May contain previously read information', sourceReceiptIds: [receipt.requestId] });
  assert.equal(f.vault.ownerFile(report.id, 'original').bytes.toString(), 'May contain previously read information');
  f.connect({ [doc.id]: access({ original: true }), [report.id]: access({ original: true }) }, otherApp);
  denied(() => f.vault.fileForApp(otherApp, report.id, 'original'));
  const target = legacy.integration(otherApp); target.grant.connected = true; target.grant.categories.mental_health = 'share'; target.grant.categories.reports = 'share';
  legacy.saveGrant(otherApp, target.grant);
  denied(() => f.vault.fileForApp(otherApp, report.id, 'original'));
  // Removing receipts cannot make an older app's incomplete history trustworthy.
  f.store.db.exec("DELETE FROM records WHERE kind='receipt'");
  denied(() => f.vault.fileForApp(otherApp, report.id, 'original'));
});
