import { randomBytes, randomUUID } from 'node:crypto';
import type { Account } from './accounts.ts';
import { defaultGrant } from './seed.ts';
import { ApiError } from './policy.ts';
import { digest, type Store } from './store.ts';
import type { Integration } from './types.ts';
import type { RecordGrant } from './records.ts';

export const appCapabilities = ['text:read', 'files:redacted', 'files:original', 'reports:create'] as const;
export type AppCapability = typeof appCapabilities[number];
function fields(input: Record<string, unknown>) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || typeof input.description !== 'string' || input.description.length > 400 || typeof input.appUrl !== 'string' || input.appUrl.length > 2048) throw new ApiError(400, 'invalid_app');
  let url: URL;
  try { url = new URL(input.appUrl); } catch { throw new ApiError(400, 'invalid_app_url'); }
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new ApiError(400, 'invalid_app_url', 'Use HTTPS, or HTTP for a local app.');
  if (!Array.isArray(input.capabilities) || input.capabilities.length > appCapabilities.length || !input.capabilities.every(c => appCapabilities.includes(c))) throw new ApiError(400, 'invalid_capabilities');
  return { name: input.name.trim(), description: input.description.trim(), appUrl: url.toString(), capabilities: [...new Set(input.capabilities)] as AppCapability[] };
}
export class Developer {
  private store: Store; private account: Account;
  constructor(store: Store, account: Account) {
    this.store = store; this.account = account;
    if (account.role !== 'developer') throw new ApiError(403, 'role_not_allowed');
  }
  private owned(id: string) {
    const app = this.store.get<Integration>('integration', id);
    if (!app || app.developerId !== this.account.id) throw new ApiError(404, 'not_found');
    return app;
  }
  private view(app: Integration) {
    return { id: app.id, name: app.name, description: app.description, appUrl: app.appUrl ?? '', capabilities: app.capabilities ?? [],
      credentialActive: Boolean(this.store.get<{ hash: string | null }>('credential', app.id)?.hash) };
  }
  list() { return this.store.all<Integration>('integration').filter(a => a.developerId === this.account.id).map(a => this.view(a)); }
  create(input: Record<string, unknown>) {
    if (this.list().length >= 20) throw new ApiError(409, 'app_limit', 'This demo supports up to 20 apps.');
    const values = fields(input);
    const id = `app-${randomUUID()}`;
    const grant = defaultGrant(); grant.scopes = [];
    for (const category of Object.keys(grant.categories) as (keyof typeof grant.categories)[]) grant.categories[category] = 'private';
    const app: Integration = { id, ...values, recordApiOnly: true, developerId: this.account.id, publisher: this.account.username, track: 'Connected app', icon: 'scan', grant };
    this.store.put('integration', id, app);
    return this.view(app);
  }
  update(id: string, input: Record<string, unknown>) {
    const app = this.owned(id);
    const values = fields(input);
    return this.store.transaction(() => {
      const changedDestination = (app.appUrl ?? '') !== values.appUrl;
      const grant = this.store.get<RecordGrant>('recordGrant', id);
      if (grant) {
        for (const access of Object.values(grant.records)) {
          if (!values.capabilities.includes('text:read')) access.text = false;
          if (!values.capabilities.includes('files:redacted')) access.redacted = false;
          if (!values.capabilities.includes('files:original')) access.original = false;
        }
        if (!values.capabilities.includes('reports:create')) grant.allowReports = false;
        if (changedDestination) grant.connected = false;
        grant.version++; this.store.put('recordGrant', id, grant);
      }
      if (changedDestination) { app.grant.connected = false; app.grant.version++; }
      Object.assign(app, values);
      this.store.put('integration', id, app);
      return this.view(app);
    });
  }
  issueCredential(id: string) {
    const app = this.owned(id);
    const token = randomBytes(32).toString('base64url');
    this.store.put('credential', app.id, { hash: digest(token) });
    return { token, app: this.view(app) };
  }
  revokeCredential(id: string) {
    const app = this.owned(id);
    // Keep a tombstone: additive registration must not recreate a revoked seeded token.
    this.store.put('credential', app.id, { hash: null });
    return this.view(app);
  }
}
