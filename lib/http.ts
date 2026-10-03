import { createHmac, timingSafeEqual } from 'node:crypto';
import { Store, digest, getStore } from './store.ts';
import { Vault } from './service.ts';
import { ApiError } from './policy.ts';

const cookieName = 'carevault_owner';
const noStore = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
const loginAttempts = new Map<string, { count: number; since: number }>();
function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...noStore, ...headers } });
}
function signature(store: Store, value: string) { return createHmac('sha256', store.credentials.sessionSecret).update(value).digest('hex'); }
export function sessionToken(store: Store): string {
  const expiration = String(Date.now() + 8 * 60 * 60 * 1000);
  return `${expiration}.${signature(store, expiration)}`;
}
function requireOwner(request: Request, store: Store) {
  const token = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || token.length > 128) throw new ApiError(401, 'sign_in_required');
  const [expiration, mac, extra] = token.split('.');
  if (extra || !/^\d{13}$/.test(expiration) || !/^[a-f0-9]{64}$/.test(mac ?? '') || Number(expiration) <= Date.now() || !timingSafeEqual(Buffer.from(mac), Buffer.from(signature(store, expiration)))) throw new ApiError(401, 'sign_in_required');
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  // Next may normalize the internal URL hostname. Host retains the browser's actual target.
  const expected = `${url.protocol}//${request.headers.get('host') ?? url.host}`;
  if (!origin || origin !== expected) throw new ApiError(403, 'origin_not_allowed');
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 32_768) { await reader.cancel(); throw new ApiError(413, 'request_too_large'); }
      chunks.push(next.value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_json');
  }
}
function cookie(request: Request, value: string, clear = false) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function handleRequest(request: Request, injectedStore?: Store): Promise<Response> {
  let store: Store | undefined; let vault: Vault | undefined; let actor: string | undefined;
  try {
    store = injectedStore ?? getStore(); vault = new Vault(store);
    const pathname = new URL(request.url).pathname;
    const method = request.method;
    if (pathname === '/api/session') {
      if (method !== 'POST' && method !== 'DELETE') throw new ApiError(405, 'method_not_allowed');
      sameOrigin(request);
      if (method === 'DELETE') return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', true) });
      const attemptsKey = digest(store.credentials.sessionSecret);
      const prior = loginAttempts.get(attemptsKey);
      const attempts = !prior || Date.now() - prior.since > 60_000 ? { count: 0, since: Date.now() } : prior;
      attempts.count++; loginAttempts.set(attemptsKey, attempts);
      if (attempts.count > 20) throw new ApiError(429, 'try_again_later', 'Too many attempts. Try again in a minute.');
      const input = await body(request);
      if (typeof input.code !== 'string' || input.code.length > 256 || !timingSafeEqual(Buffer.from(digest(input.code)), Buffer.from(digest(store.credentials.ownerCode)))) throw new ApiError(401, 'invalid_access_code', 'That access code is not valid.');
      loginAttempts.delete(attemptsKey);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, sessionToken(store)) });
    }
    if (pathname.startsWith('/api/owner/')) {
      requireOwner(request, store); actor = 'You';
      if (method !== 'GET') sameOrigin(request);
      if (pathname === '/api/owner/dashboard' && method === 'GET') return json(vault.dashboard());
      const input = method === 'GET' ? {} : await body(request);
      const connection = pathname.match(/^\/api\/owner\/connections\/([a-z-]+)(\/revoke)?$/);
      if (connection && !connection[2] && method === 'PUT') return json(vault.saveGrant(connection[1], input));
      if (connection?.[2] && method === 'POST') { vault.revoke(connection[1]); return json({ ok: true }); }
      const memory = pathname.match(/^\/api\/owner\/memory\/([a-zA-Z0-9-]+)$/);
      if (memory && method === 'PUT') { vault.restrict(memory[1], input.restriction); return json({ ok: true }); }
      if ((pathname === '/api/owner/preview' || pathname === '/api/owner/inspect') && method === 'POST') {
        if (typeof input.integrationId !== 'string') throw new ApiError(400, 'integration_required');
        if (pathname.endsWith('/preview')) return json(vault.preview(input.integrationId, input.grant));
        actor = vault.integration(input.integrationId).name;
        if (input.operation === 'read') return json(vault.read(input.integrationId, { patientId: 'patient-demo-001' }));
        if (input.operation === 'write') return json(vault.inspectWrite(input.integrationId, input.contextRequestId));
        throw new ApiError(400, 'invalid_operation');
      }
      throw new ApiError(404, 'not_found');
    }
    if (pathname.startsWith('/api/v1/')) {
      const match = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
      const id = vault.authenticate(match?.[1] ?? ''); actor = vault.integration(id).name;
      if (pathname === '/api/v1/context' && method === 'POST') return json(vault.read(id, await body(request)));
      if (pathname === '/api/v1/reports' && method === 'POST') return json(vault.report(id, await body(request)), 201);
      const report = pathname.match(/^\/api\/v1\/reports\/([a-zA-Z0-9-]+)$/);
      if (report && method === 'GET') return json(vault.readReport(id, report[1]));
      const file = pathname.match(/^\/api\/v1\/files\/([a-zA-Z0-9-]+)\/redacted$/);
      if (file && method === 'GET') return new Response(vault.file(id, file[1]), { headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="authorized-extract.txt"' } });
    }
    throw new ApiError(404, 'not_found');
  } catch (error) {
    const safe = error instanceof ApiError ? error : new ApiError(500, 'request_failed', 'The request could not be completed. No data was released.');
    if (vault && actor && safe.status >= 400 && safe.status < 500) {
      try { vault.activity(actor, 'request', 'denied', safe.code); } catch { /* No sensitive fallback logging. */ }
    }
    return json({ error: safe.code, message: safe.message }, safe.status);
  }
}
