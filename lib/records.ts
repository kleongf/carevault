import { randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from './policy.ts';
import { Vault } from './service.ts';
import type { Store } from './store.ts';
import type { Activity, Integration } from './types.ts';

export type Representation = 'text' | 'redacted' | 'original';
export type RedactionProfile = 'identifiers' | 'healthcare';
export interface RecordAccess { text: boolean; redacted: boolean; original: boolean; }
export interface RecordGrant { id: string; connected: boolean; version: number; allowReports: boolean; records: Record<string, RecordAccess>; }
export interface RecordDependency { recordId: string; representation: Representation; }
export interface DocumentRecord {
  id: string; patientId: string; title: string; mime: string; kind: 'document' | 'image' | 'report';
  status: 'queued' | 'processing' | 'ready' | 'failed'; createdAt: string; profile: RedactionProfile;
  size: number; author?: string; source?: { integrationId: string; receiptIds: string[] };
  dependencies: RecordDependency[]; provenance?: string; error?: string;
}
export interface ProcessingJob { id: string; status: 'queued' | 'processing' | 'ready' | 'failed'; attempts: number; createdAt: string; }
export interface RecordReceipt { id: string; appId: string; patientId: string; grantVersion: number; recordId: string; representation: Representation; createdAt: string; }
export type RecordApp = Pick<Integration, 'id' | 'name' | 'publisher' | 'description' | 'appUrl' | 'capabilities' | 'icon' | 'track'> & { recordGrant: RecordGrant; legacyConnected: boolean };
export interface RecordsDashboard { records: DocumentRecord[]; apps: RecordApp[]; activity: Activity[]; }
export interface SharedRecord { id: string; mime: string; kind: DocumentRecord['kind']; status: DocumentRecord['status']; allowed: RecordAccess; }

const patientId = 'patient-demo-001';
const maximumUpload = 20 * 1024 * 1024;
const extensions: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt' };
const capabilities: Record<Representation, NonNullable<Integration['capabilities']>[number]> = { text: 'text:read', redacted: 'files:redacted', original: 'files:original' };
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emptyAccess = (): RecordAccess => ({ text: false, redacted: false, original: false });
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function titleValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new ApiError(400, 'invalid_title');
  return value.trim();
}

export class RecordVault {
  store: Store;
  constructor(store: Store) { this.store = store; }
  private app(id: string): Integration { return new Vault(this.store).integration(id); }
  private grant(id: string): RecordGrant { return this.store.get<RecordGrant>('recordGrant', id) ?? { id, connected: false, version: 0, allowReports: false, records: {} }; }
  private documents(): DocumentRecord[] { return this.store.all<DocumentRecord>('document').filter(doc => doc.patientId === patientId); }
  private document(id: string): DocumentRecord {
    if (!identifier.test(id)) throw new ApiError(404, 'not_found');
    const doc = this.store.get<DocumentRecord>('document', id);
    if (!doc || doc.patientId !== patientId) throw new ApiError(404, 'not_found');
    return doc;
  }
  private path(doc: DocumentRecord, file: string): string { return join(this.store.directory, 'documents', doc.id, file); }
  private supported(app: Integration, capability: NonNullable<Integration['capabilities']>[number]): boolean { return app.capabilities === undefined || app.capabilities.includes(capability); }
  private allowed(app: Integration, grant: RecordGrant, id: string, representation: Representation, visited = new Set<string>(), results = new Map<string, boolean>()): boolean {
    if (!identifier.test(id) || visited.has(id) || !grant.connected || !this.supported(app, capabilities[representation]) || !grant.records[id]?.[representation]) return false;
    const key = `${id}:${representation}`;
    if (results.has(key)) return results.get(key)!;
    const doc = this.store.get<DocumentRecord>('document', id);
    if (!doc || doc.patientId !== patientId || !Array.isArray(doc.dependencies) || (doc.kind === 'report' && (!doc.source || !doc.dependencies.length))) return false;
    // Old file/report reads did not all create receipts. Their provenance cannot
    // be reconstructed safely, so reports from legacy apps remain owner-only.
    if (doc.source && !this.store.get<Integration>('integration', doc.source.integrationId)?.recordApiOnly) return false;
    const path = new Set(visited).add(id);
    const allowed = doc.dependencies.every(source => source && ['text', 'redacted', 'original'].includes(source.representation) && this.allowed(app, grant, source.recordId, source.representation, path, results));
    results.set(key, allowed);
    return allowed;
  }
  private requireAccess(appId: string, id: string, representation: Representation): DocumentRecord {
    const app = this.app(appId);
    if (!this.allowed(app, this.grant(appId), id, representation)) throw new ApiError(403, 'access_not_authorized');
    return this.document(id);
  }
  private read(doc: DocumentRecord, filename: string): Buffer {
    let fd: number | undefined;
    try {
      fd = openSync(this.path(doc, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!fstatSync(fd).isFile()) throw new Error('not a file');
      return readFileSync(fd);
    } catch { throw new ApiError(409, 'representation_unavailable'); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  private ready(doc: DocumentRecord): void { if (doc.status !== 'ready') throw new ApiError(409, 'record_not_ready'); }
  private persist(bytes: Buffer, mime: string, title: string, profile: RedactionProfile, source?: DocumentRecord['source'], dependencies: RecordDependency[] = [], author?: string): DocumentRecord {
    const doc: DocumentRecord = { id: randomUUID(), patientId, title, mime, kind: source ? 'report' : mime.startsWith('image/') ? 'image' : 'document', status: 'queued', createdAt: new Date().toISOString(), size: bytes.length, profile, dependencies, ...(source ? { source, author } : {}) };
    const directory = join(this.store.directory, 'documents', doc.id);
    try {
      this.store.transaction(() => {
        const all = this.documents();
        if (all.length >= 100 || all.reduce((total, item) => total + item.size, 0) + bytes.length > 300 * 1024 * 1024) throw new ApiError(413, 'vault_storage_limit');
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(this.path(doc, `input.${extensions[mime]}`), bytes, { mode: 0o600, flag: 'wx' });
        this.store.put('document', doc.id, doc);
        this.store.put('processingJob', doc.id, { id: doc.id, status: 'queued', attempts: 0, createdAt: doc.createdAt } satisfies ProcessingJob);
        new Vault(this.store).activity(author ?? 'You', source ? 'report' : 'upload', 'queued', source ? 'Received an integration report' : 'Uploaded a record', [doc.id]);
      });
    } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
    return doc;
  }
  dashboard(): RecordsDashboard {
    return { records: this.documents().reverse(), apps: this.store.all<Integration>('integration').filter(app => app.id !== 'care-assistant' || app.grant.connected).map(app => ({ id: app.id, name: app.name, publisher: app.publisher, description: app.description, appUrl: app.appUrl, capabilities: app.capabilities, icon: app.icon, track: app.track, recordGrant: this.grant(app.id), legacyConnected: app.grant.connected })), activity: this.store.all<Activity>('activity').slice(-150).reverse() };
  }
  upload(buffer: Buffer, mime: string, title: string, profile: RedactionProfile = 'identifiers'): DocumentRecord {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ApiError(400, 'empty_upload');
    if (buffer.length > maximumUpload) throw new ApiError(413, 'upload_too_large');
    const valid = mime === 'application/pdf' ? buffer.subarray(0, 5).toString() === '%PDF-' : mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : mime === 'image/jpeg' && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    if (!valid) throw new ApiError(400, 'unsupported_file');
    if (!['identifiers', 'healthcare'].includes(profile)) throw new ApiError(400, 'invalid_profile');
    return this.persist(buffer, mime, titleValue(title), profile);
  }
  ownerText(id: string, redacted = false): string {
    const doc = this.document(id); this.ready(doc);
    return this.read(doc, redacted ? 'redacted.txt' : 'extracted.txt').toString('utf8');
  }
  ownerFile(id: string, variant: 'original' | 'redacted'): { bytes: Buffer; mime: string } {
    if (!['original', 'redacted'].includes(variant)) throw new ApiError(400, 'invalid_representation');
    const doc = this.document(id);
    if (variant === 'original') return { bytes: this.read(doc, `input.${extensions[doc.mime]}`), mime: doc.mime };
    this.ready(doc);
    const image = doc.kind === 'image';
    return { bytes: this.read(doc, image ? 'redacted.png' : 'redacted.pdf'), mime: image ? 'image/png' : 'application/pdf' };
  }
  saveConnection(appId: string, input: unknown): RecordGrant {
    const app = this.app(appId);
    if (!object(input) || typeof input.connected !== 'boolean' || typeof input.allowReports !== 'boolean' || !object(input.records) || Object.keys(input.records).length > 100) throw new ApiError(400, 'invalid_record_grant');
    if (input.allowReports && !this.supported(app, 'reports:create')) throw new ApiError(400, 'unsupported_capability');
    const records: Record<string, RecordAccess> = {};
    for (const [id, value] of Object.entries(input.records)) {
      this.document(id);
      if (!object(value) || Object.keys(value).length !== 3 || !['text', 'redacted', 'original'].every(key => typeof value[key] === 'boolean')) throw new ApiError(400, 'invalid_record_grant');
      const access = value as unknown as RecordAccess;
      for (const representation of ['text', 'redacted', 'original'] as const) if (access[representation] && !this.supported(app, capabilities[representation])) throw new ApiError(400, 'unsupported_capability');
      records[id] = { text: access.text, redacted: access.redacted, original: access.original };
    }
    return this.store.transaction(() => {
      const grant: RecordGrant = { id: appId, connected: input.connected as boolean, version: this.grant(appId).version + 1, allowReports: input.allowReports as boolean, records };
      this.store.put('recordGrant', appId, grant);
      // Disconnect through either owner action must also disable the preserved legacy API.
      if (!grant.connected) { app.grant.connected = false; app.grant.version++; this.store.put('integration', appId, app); }
      new Vault(this.store).activity('You', 'permissions', 'updated', `Updated ${app.name} record access`, [], grant.version);
      return grant;
    });
  }
  revoke(appId: string): void {
    const grant = this.grant(appId);
    this.saveConnection(appId, { ...grant, connected: false, allowReports: false, records: {} });
  }
  listForApp(appId: string): SharedRecord[] {
    const app = this.app(appId), grant = this.grant(appId);
    if (!grant.connected) throw new ApiError(403, 'access_not_authorized');
    return this.documents().flatMap(doc => {
      const allowed = emptyAccess();
      for (const representation of ['text', 'redacted', 'original'] as const) allowed[representation] = this.allowed(app, grant, doc.id, representation);
      return Object.values(allowed).some(Boolean) ? [{ id: doc.id, mime: doc.mime, kind: doc.kind, status: doc.status, allowed }] : [];
    });
  }
  private receipt(appId: string, id: string, representation: Representation): string {
    const requestId = randomUUID();
    const receipt: RecordReceipt = { id: requestId, appId, patientId, grantVersion: this.grant(appId).version, recordId: id, representation, createdAt: new Date().toISOString() };
    this.store.put('recordReceipt', requestId, receipt);
    new Vault(this.store).activity(this.app(appId).name, 'read', 'allowed', `Released ${representation} record content`, [id], receipt.grantVersion);
    return requestId;
  }
  textForApp(appId: string, id: string): { text: string; mime: string; requestId: string } {
    return this.store.transaction(() => {
      this.requireAccess(appId, id, 'text');
      const text = this.ownerText(id, true);
      return { text, mime: 'text/plain', requestId: this.receipt(appId, id, 'text') };
    });
  }
  fileForApp(appId: string, id: string, variant: 'original' | 'redacted'): { bytes: Buffer; mime: string; requestId: string } {
    if (!['original', 'redacted'].includes(variant)) throw new ApiError(400, 'invalid_representation');
    return this.store.transaction(() => {
      this.requireAccess(appId, id, variant);
      const file = this.ownerFile(id, variant);
      return { ...file, requestId: this.receipt(appId, id, variant) };
    });
  }
  report(appId: string, input: unknown): DocumentRecord {
    const app = this.app(appId), grant = this.grant(appId);
    if (!grant.connected || !grant.allowReports || !this.supported(app, 'reports:create')) throw new ApiError(403, 'access_not_authorized');
    if (!object(input) || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 64000 || !Array.isArray(input.sourceReceiptIds) || !input.sourceReceiptIds.length || input.sourceReceiptIds.length > 100 || !input.sourceReceiptIds.every(id => typeof id === 'string' && identifier.test(id))) throw new ApiError(400, 'invalid_report');
    const title = titleValue(input.title), receiptIds = [...new Set(input.sourceReceiptIds as string[])];
    const dependencies: RecordDependency[] = [];
    for (const id of receiptIds) {
      const receipt = this.store.get<RecordReceipt>('recordReceipt', id);
      if (!receipt || receipt.appId !== appId || receipt.patientId !== patientId || receipt.grantVersion !== grant.version) throw new ApiError(403, 'invalid_source_receipt');
      this.requireAccess(appId, receipt.recordId, receipt.representation);
      if (!dependencies.some(dep => dep.recordId === receipt.recordId && dep.representation === receipt.representation)) dependencies.push({ recordId: receipt.recordId, representation: receipt.representation });
    }
    // Reports are untrusted: omitted receipt IDs cannot erase known prior disclosures.
    for (const receipt of this.store.all<RecordReceipt>('recordReceipt').filter(r => r.appId === appId && r.patientId === patientId)) {
      if (!dependencies.some(dep => dep.recordId === receipt.recordId && dep.representation === receipt.representation)) dependencies.push({ recordId: receipt.recordId, representation: receipt.representation });
    }
    return this.persist(Buffer.from(input.body), 'text/plain', title, 'healthcare', { integrationId: appId, receiptIds }, dependencies, app.name);
  }
}
