import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Store, digest } from './store.ts';
import { patient } from './seed.ts';
import { ApiError, authorize, project, validateGrant } from './policy.ts';
import { categories } from './types.ts';
import { evaluateTrials, requestedFactForStudy } from './trials.ts';
import type { Activity, ContextResponse, Dashboard, Disclosure, Grant, Integration, MemoryItem, ReleasedItem, Scope, Source, TrialFactRequest, TrialMatchesResponse } from './types.ts';

interface Receipt { integrationId: string; patientId: string; released: { id: string; version: number }[]; policyVersion: number; }
export class Vault {
  store: Store;
  constructor(store: Store) { this.store = store; }
  integration(id: string): Integration {
    const i = this.store.get<Integration>('integration', id);
    if (!i) throw new ApiError(404, 'not_found');
    return i;
  }
  authenticate(token: string): string {
    if (!token || token.length > 256) throw new ApiError(401, 'invalid_credential');
    const hash = Buffer.from(digest(token));
    for (const i of this.store.all<Integration>('integration')) {
      const record = this.store.get<{ hash: string | null }>('credential', i.id);
      if (record?.hash && timingSafeEqual(hash, Buffer.from(record.hash))) return i.id;
    }
    throw new ApiError(401, 'invalid_credential');
  }
  memories(): MemoryItem[] { return this.store.all<MemoryItem>('memory'); }
  activity(actor: string, operation: string, outcome: string, detail: string, itemIds: string[] = [], policyVersion?: number): void {
    const id = randomUUID();
    this.store.put('activity', id, { id, actor, operation, outcome, detail, itemIds, policyVersion, at: new Date().toISOString() } satisfies Activity);
  }
  dashboard(): Dashboard {
    const now = Date.now();
    const trialRequests = this.store.all<TrialFactRequest>('trialRequest').filter(request => request.patientId === patient.id).map(request =>
      (request.status === 'pending' || request.status === 'approved') && Date.parse(request.expiresAt) <= now ? { ...request, status: 'expired' as const } : request
    );
    return { patient, integrations: this.store.all<Integration>('integration'), memories: this.memories().filter(m => m.patientId === patient.id), sources: this.store.all<Source>('source'), activity: this.store.all<Activity>('activity').slice(-150).reverse(), trialRequests: trialRequests.slice(-50).reverse() };
  }
  expireTrialRequests(integrationId?: string): void {
    for (const request of this.store.all<TrialFactRequest>('trialRequest')) {
      if ((!integrationId || request.integrationId === integrationId) && ['pending', 'approved'].includes(request.status)) {
        request.status = 'expired';
        this.store.put('trialRequest', request.id, request);
      }
    }
  }
  saveGrant(id: string, input: unknown): Integration {
    return this.store.transaction(() => {
      const i = this.integration(id);
      const grant = validateGrant(input, new Set(this.memories().filter(m => m.patientId === patient.id).map(m => m.id)));
      i.grant = { ...grant, version: i.grant.version + 1 };
      this.store.put('integration', i.id, i);
      const recordGrant = this.store.get<import('./records.ts').RecordGrant>('recordGrant', id);
      if (!i.grant.connected && recordGrant) { recordGrant.connected = false; recordGrant.version++; this.store.put('recordGrant', id, recordGrant); }
      this.expireTrialRequests(i.id);
      this.activity('You', 'permissions', 'updated', `Updated ${i.name} access`, [], i.grant.version);
      return i;
    });
  }
  revoke(id: string): void {
    this.store.transaction(() => {
      const i = this.integration(id); i.grant.connected = false; i.grant.version++;
      this.store.put('integration', id, i);
      const recordGrant = this.store.get<import('./records.ts').RecordGrant>('recordGrant', id);
      if (recordGrant) { recordGrant.connected = false; recordGrant.version++; this.store.put('recordGrant', id, recordGrant); }
      this.expireTrialRequests(i.id);
      this.activity('You', 'revoke', 'revoked', `${i.name} can no longer make requests`, [], i.grant.version);
    });
  }
  restrict(id: string, restriction: unknown): void {
    if (!['share', 'redact', 'private'].includes(String(restriction))) throw new ApiError(400, 'invalid_restriction');
    this.store.transaction(() => {
      const item = this.store.get<MemoryItem>('memory', id);
      if (!item || item.patientId !== patient.id) throw new ApiError(404, 'not_found');
      this.store.put('history', `${id}:${item.version}`, item);
      item.restriction = restriction as Disclosure; item.version++;
      this.store.put('memory', id, item);
      for (const i of this.store.all<Integration>('integration')) {
        i.grant.version++; this.store.put('integration', i.id, i);
      }
      this.expireTrialRequests();
      this.activity('You', 'privacy', 'updated', `${item.label}: ${restriction}`, [id]);
    });
  }
  preview(id: string, input?: unknown): ContextResponse {
    const i = this.integration(id);
    const grant = input === undefined ? i.grant : validateGrant(input, new Set(this.memories().filter(m => m.patientId === patient.id).map(m => m.id)));
    // Owner preview is explicitly hypothetical; it does not grant integration access or create a receipt.
    if (!grant.scopes.includes('facts:read')) return { policyVersion: i.grant.version, items: [] };
    return { policyVersion: i.grant.version, items: project(this.memories(), grant, patient.id) };
  }
  check(id: string, patientId: unknown, scope: Scope): Integration {
    const i = this.integration(id);
    if (patientId !== patient.id) throw new ApiError(403, 'access_not_authorized');
    authorize(i.grant, scope);
    return i;
  }
  trialMatches(id: string, patientId: unknown): TrialMatchesResponse {
    return this.store.transaction(() => {
      const integration = this.check(id, patientId, 'facts:read');
      const items = project(this.memories(), integration.grant, patient.id);
      const studies = evaluateTrials(items);
      this.activity(integration.name, 'trial_match', 'completed', 'Compared authorized facts with the synthetic study catalog', items.filter(item => item.disclosure === 'shared').map(item => item.id), integration.grant.version);
      return { policyVersion: integration.grant.version, studies };
    });
  }
  requestTrialFact(id: string, patientId: unknown, studyId: unknown) {
    return this.store.transaction(() => {
      const integration = this.check(id, patientId, 'facts:read');
      if (typeof studyId !== 'string' || studyId.length > 100) throw new ApiError(400, 'invalid_study');
      const factId = requestedFactForStudy(studyId);
      if (!factId) throw new ApiError(400, 'fact_not_requestable');
      const currentItems = project(this.memories(), integration.grant, patient.id);
      const match = evaluateTrials(currentItems).find(study => study.studyId === studyId);
      if (!match?.additionalFactRequestAvailable) throw new ApiError(409, 'additional_fact_not_needed');
      const fact = this.store.get<MemoryItem>('memory', factId);
      if (!fact || fact.patientId !== patient.id || fact.kind !== 'fact' || fact.parentIds.length || !fact.sourceIds.length || fact.pendingReview) throw new ApiError(409, 'fact_unavailable');
      const now = Date.now();
      const requests = this.store.all<TrialFactRequest>('trialRequest');
      if (requests.some(request => request.integrationId === id && request.studyId === studyId && ['pending', 'approved'].includes(request.status) && Date.parse(request.expiresAt) > now)) throw new ApiError(409, 'trial_request_open');
      if (requests.filter(request => request.integrationId === id).length >= 100) throw new ApiError(409, 'demo_trial_request_limit');
      const requestedAt = new Date(now).toISOString();
      const request: TrialFactRequest = {
        id: randomUUID(), integrationId: id, patientId: patient.id, studyId, factId, factVersion: fact.version,
        policyVersion: integration.grant.version, status: 'pending', requestedAt,
        expiresAt: new Date(now + 15 * 60_000).toISOString()
      };
      this.store.put('trialRequest', request.id, request);
      this.activity(integration.name, 'trial_fact_request', 'pending', 'Requested one-time access to a fact for a synthetic study', [fact.id], integration.grant.version);
      return { id: request.id, studyId: request.studyId, status: request.status, expiresAt: request.expiresAt };
    });
  }
  decideTrialFactRequest(requestId: string, approve: boolean) {
    return this.store.transaction(() => {
      const request = this.store.get<TrialFactRequest>('trialRequest', requestId);
      if (!request || request.patientId !== patient.id) throw new ApiError(404, 'trial_request_not_found');
      if (request.status !== 'pending' || Date.parse(request.expiresAt) <= Date.now()) throw new ApiError(409, 'trial_request_unavailable');
      const integration = this.check(request.integrationId, patient.id, 'facts:read');
      const fact = this.store.get<MemoryItem>('memory', request.factId);
      if (!fact || fact.version !== request.factVersion || fact.kind !== 'fact' || fact.parentIds.length || !fact.sourceIds.length || fact.pendingReview) throw new ApiError(409, 'trial_request_stale');
      if (project(this.memories(), integration.grant, patient.id).some(item => item.id === fact.id && item.disclosure === 'shared')) throw new ApiError(409, 'additional_fact_not_needed');
      request.status = approve ? 'approved' : 'denied';
      request.policyVersion = integration.grant.version;
      if (approve) request.approvedAt = new Date().toISOString();
      this.store.put('trialRequest', request.id, request);
      this.activity('You', 'trial_fact_request', request.status, approve ? 'Approved a one-time fact request' : 'Denied a one-time fact request', [fact.id], integration.grant.version);
      return { id: request.id, studyId: request.studyId, status: request.status, expiresAt: request.expiresAt };
    });
  }
  consumeTrialFact(id: string, requestId: string) {
    return this.store.transaction(() => {
      const integration = this.check(id, patient.id, 'facts:read');
      const request = this.store.get<TrialFactRequest>('trialRequest', requestId);
      if (!request || request.patientId !== patient.id || request.integrationId !== id) throw new ApiError(404, 'trial_request_not_found');
      if (request.status === 'consumed') throw new ApiError(409, 'trial_request_used');
      if (request.status !== 'approved' || Date.parse(request.expiresAt) <= Date.now()) throw new ApiError(409, 'trial_request_unavailable');
      if (integration.grant.version !== request.policyVersion) throw new ApiError(409, 'trial_request_stale');
      const fact = this.store.get<MemoryItem>('memory', request.factId);
      if (!fact || fact.version !== request.factVersion || fact.kind !== 'fact' || fact.parentIds.length || !fact.sourceIds.length || fact.pendingReview || requestedFactForStudy(request.studyId) !== fact.id) throw new ApiError(409, 'trial_request_stale');
      request.status = 'consumed'; request.usedAt = new Date().toISOString();
      this.store.put('trialRequest', request.id, request);
      this.activity(integration.name, 'trial_fact_use', 'consumed', 'Used an owner-approved one-time fact grant', [fact.id], integration.grant.version);
      return { studyId: request.studyId, policyVersion: integration.grant.version, fact: { id: fact.id, version: fact.version, field: fact.label, disclosure: 'shared' as const, value: fact.value, verification: fact.verification } };
    });
  }
  read(id: string, body: Record<string, unknown>): ContextResponse {
    return this.store.transaction(() => {
      const i = this.check(id, body.patientId, 'facts:read');
      if (body.categories !== undefined && (!Array.isArray(body.categories) || body.categories.length > categories.length || !body.categories.every(c => categories.includes(c)))) throw new ApiError(400, 'invalid_categories');
      if (body.query !== undefined && (typeof body.query !== 'string' || body.query.length > 1000)) throw new ApiError(400, 'invalid_query');
      const memories = this.memories();
      let items = project(memories, i.grant, patient.id);
      if (body.categories) {
        const allowed = new Set(memories.filter(m => (body.categories as string[]).includes(m.category)).map(m => m.id));
        items = items.filter(m => allowed.has(m.id));
      }
      const requestId = randomUUID();
      this.store.put('receipt', requestId, { integrationId: id, patientId: patient.id, released: items.map(m => ({ id: m.id, version: m.version })), policyVersion: i.grant.version } satisfies Receipt);
      // Save immutable source versions for historical receipt interpretation, inside the private vault.
      for (const released of items) {
        const original = memories.find(m => m.id === released.id)!;
        if (!this.store.get('history', `${original.id}:${original.version}`)) this.store.put('history', `${original.id}:${original.version}`, original);
      }
      this.activity(i.name, 'read', 'allowed', `Released ${items.length} authorized items`, items.map(m => m.id), i.grant.version);
      return { requestId, policyVersion: i.grant.version, items };
    });
  }
  report(id: string, body: Record<string, unknown>, prepared = false) {
    return this.store.transaction(() => {
      const i = this.check(id, body.patientId, 'reports:create');
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120 || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 12000) throw new ApiError(400, 'invalid_report');
      if (body.sourceItemIds !== undefined && (!Array.isArray(body.sourceItemIds) || body.sourceItemIds.length > 100 || !body.sourceItemIds.every(s => typeof s === 'string'))) throw new ApiError(400, 'invalid_sources');
      if (this.memories().filter(m => m.kind === 'report').length >= 100) throw new ApiError(409, 'demo_report_limit', 'This demo vault has reached its 100-report limit.');
      let parentIds: string[] = [];
      if (body.contextRequestId !== undefined) {
        if (typeof body.contextRequestId !== 'string') throw new ApiError(400, 'invalid_context_reference');
        const receipt = this.store.get<Receipt>('receipt', body.contextRequestId);
        if (!receipt || receipt.integrationId !== id || receipt.patientId !== patient.id) throw new ApiError(403, 'invalid_context_reference');
        parentIds = receipt.released.map(r => r.id);
        const current = new Set(project(this.memories(), i.grant, patient.id).map(m => m.id));
        if ((body.sourceItemIds as string[] | undefined)?.some(source => !parentIds.includes(source) || !current.has(source))) throw new ApiError(403, 'invalid_source_reference');
      } else if ((body.sourceItemIds as string[] | undefined)?.length) throw new ApiError(400, 'context_receipt_required');
      const reportId = randomUUID();
      const report: MemoryItem = {
        id: reportId, patientId: patient.id, kind: 'report', category: 'reports', label: body.title.trim(), value: body.body.trim(),
        parentIds, sourceIds: [`integration:${id}`], verification: 'integration_authored', author: i.name,
        createdAt: new Date().toISOString(), version: 1, restriction: 'share', pendingReview: !prepared || parentIds.length === 0
      };
      this.store.put('memory', reportId, report);
      this.activity(i.name, 'write', 'saved', prepared ? 'Saved a prepared report with source dependencies' : 'Saved a report privately pending review', [reportId], i.grant.version);
      return { reportId, version: 1, verification: 'integration_authored', memoryProcessing: 'not_processed', pendingReview: report.pendingReview };
    });
  }
  inspectWrite(id: string, contextRequestId: unknown) {
    if (typeof contextRequestId !== 'string') throw new ApiError(400, 'read_first', 'Run a read request before writing the prepared report.');
    const receipt = this.store.get<Receipt>('receipt', contextRequestId);
    if (!receipt || receipt.integrationId !== id || receipt.patientId !== patient.id) throw new ApiError(403, 'invalid_context_reference');
    const i = this.check(id, patient.id, 'reports:create');
    const current = project(this.memories(), i.grant, patient.id).filter(m => m.disclosure === 'shared' && receipt.released.some(r => r.id === m.id && r.version === m.version) && this.memories().find(x => x.id === m.id)?.kind === 'fact');
    const selected = current.find(m => m.id === 'availability') ?? current[0];
    if (!selected) throw new ApiError(409, 'no_shared_context', 'No readable fact is available for the prepared report.');
    return this.report(id, { patientId: patient.id, title: 'Prepared context review', body: `Prepared demonstration: ${selected.field}: ${selected.value}. This is an attributed memory update, not a medical assessment.`, contextRequestId, sourceItemIds: [selected.id] }, true);
  }
  readReport(id: string, reportId: string): ReleasedItem {
    return this.store.transaction(() => {
      const i = this.check(id, patient.id, 'facts:read');
      const original = this.store.get<MemoryItem>('memory', reportId);
      const item = original?.kind === 'report' ? project(this.memories(), i.grant, patient.id).find(m => m.id === reportId) : undefined;
      if (!item) throw new ApiError(404, 'not_found');
      this.activity(i.name, 'read_report', 'allowed', 'Released an authorized report', [reportId], i.grant.version);
      return item;
    });
  }
  file(id: string, fileId: string): string {
    return this.store.transaction(() => {
      const i = this.check(id, patient.id, 'files:download');
      const source = this.store.get<Source>('source', fileId);
      if (!source) throw new ApiError(404, 'not_found');
      if (!source.rendition) throw new ApiError(409, 'rendition_unavailable', 'No redacted rendition is available for this prepared source.');
      const items = project(this.memories(), i.grant, patient.id).filter(m => source.itemIds.includes(m.id));
      if (!items.length) throw new ApiError(404, 'not_found');
      this.activity(i.name, 'download', 'allowed', 'Released a redacted plain-text rendition', items.map(m => m.id), i.grant.version);
      return 'CareVault — synthetic, prepared text rendition\nOnly authorized information is included.\n\n' + items.map(m => `${m.field}: ${m.value}`).join('\n\n');
    });
  }
}
