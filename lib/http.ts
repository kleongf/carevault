import { Store, getStore } from './store.ts';
import { Vault } from './service.ts';
import { ApiError } from './policy.ts';
import { chat, chatStatus, setChatKey } from './chat.ts';
import { authenticateAccount, cookieHeader, endSession, issueSession, publicAccount, requireAccount } from './accounts.ts';
import { Developer } from './developer.ts';
import { RecordVault, type RedactionProfile } from './records.ts';

const noStore = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...noStore, ...headers } });
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  // Next may normalize the internal URL hostname. Host retains the browser's actual target.
  const expected = `${url.protocol}//${request.headers.get('host') ?? url.host}`;
  if (!origin || origin !== expected) throw new ApiError(403, 'origin_not_allowed');
}
async function body(request: Request, maximum = 32_768): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > maximum) { await reader.cancel(); throw new ApiError(413, 'request_too_large'); }
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
async function uploadBytes(request: Request): Promise<Buffer> {
  const maxBytes = 20 * 1024 * 1024;
  if (Number(request.headers.get('content-length')) > maxBytes) throw new ApiError(413, 'upload_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'empty_upload');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new ApiError(413, 'upload_too_large'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
function documentResponse(request: Request, file: { bytes: Buffer; mime: string; requestId?: string }) {
  const extension = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt' } as Record<string,string>)[file.mime] ?? 'bin';
  return new Response(new Uint8Array(file.bytes), { headers: { ...noStore, 'Content-Type': file.mime,
    'Content-Disposition': `${new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="record.${extension}"`,
    'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'",
    ...(file.requestId ? { 'X-CareVault-Receipt': file.requestId } : {}) } });
}
export async function handleRequest(request: Request, injectedStore?: Store): Promise<Response> {
  let store: Store | undefined; let vault: Vault | undefined; let actor: string | undefined;
  try {
    store = injectedStore ?? getStore(); vault = new Vault(store);
    const pathname = new URL(request.url).pathname;
    const method = request.method;
    if (pathname === '/api/session') {
      if (method === 'GET') return json({ account: publicAccount(requireAccount(request, store)) });
      if (method !== 'POST' && method !== 'DELETE') throw new ApiError(405, 'method_not_allowed');
      sameOrigin(request);
      if (method === 'DELETE') { endSession(request, store); return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, '', true) }); }
      const account = await authenticateAccount(store, await body(request));
      return json({ account: publicAccount(account) }, 200, { 'Set-Cookie': cookieHeader(request, issueSession(store, account)) });
    }
    if (pathname.startsWith('/api/developer/')) {
      const account = requireAccount(request, store, 'developer');
      if (method !== 'GET') sameOrigin(request);
      const developer = new Developer(store, account);
      if (pathname === '/api/developer/apps' && method === 'GET') return json({ apps: developer.list() });
      if (pathname === '/api/developer/apps' && method === 'POST') return json(developer.create(await body(request)), 201);
      const app = pathname.match(/^\/api\/developer\/apps\/([a-zA-Z0-9-]+)(\/credential)?$/);
      if (app && !app[2] && method === 'PUT') return json(developer.update(app[1], await body(request)));
      if (app?.[2] && method === 'POST') return json(developer.issueCredential(app[1]));
      if (app?.[2] && method === 'DELETE') return json(developer.revokeCredential(app[1]));
      throw new ApiError(404, 'not_found');
    }
    if (pathname.startsWith('/api/patient/')) {
      requireAccount(request, store, 'patient'); actor = 'You';
      if (method !== 'GET') sameOrigin(request);
      const records = new RecordVault(store);
      if (pathname === '/api/patient/dashboard' && method === 'GET') return json(records.dashboard());
      if (pathname === '/api/patient/profile' && method === 'GET') return json(records.patientProfile());
      if (pathname === '/api/patient/profile' && method === 'PUT') {
        const input = await body(request);
        requireAccount(request, store, 'patient');
        return json(records.saveProfile(input));
      }
      if (pathname === '/api/patient/records' && method === 'POST') {
        let title: string;
        try { title = decodeURIComponent(request.headers.get('x-file-name') ?? ''); } catch { throw new ApiError(400, 'invalid_title'); }
        const bytes = await uploadBytes(request);
        requireAccount(request, store, 'patient');
        return json(records.upload(bytes, request.headers.get('content-type') ?? '', title, (request.headers.get('x-redaction-profile') ?? 'identifiers') as RedactionProfile), 201);
      }
      const record = pathname.match(/^\/api\/patient\/records\/([a-zA-Z0-9-]+)\/(text|files\/(original|redacted))$/);
      if (record && method === 'GET') {
        if (record[2] === 'text') return new Response(records.ownerText(record[1]), { headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8' } });
        return documentResponse(request, records.ownerFile(record[1], record[3] as 'original' | 'redacted'));
      }
      const connection = pathname.match(/^\/api\/patient\/apps\/([a-zA-Z0-9-]+)(\/revoke)?$/);
      if (connection && !connection[2] && method === 'PUT') return json(records.saveConnection(connection[1], await body(request)));
      if (connection?.[2] && method === 'POST') { records.revoke(connection[1]); return json({ ok: true }); }
      throw new ApiError(404, 'not_found');
    }
    if (pathname.startsWith('/api/v2/')) {
      const match = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
      const id = vault.authenticate(match?.[1] ?? ''); actor = vault.integration(id).name;
      const records = new RecordVault(store);
      if (pathname === '/api/v2/records' && method === 'GET') return json({ records: records.listForApp(id) });
      if (pathname === '/api/v2/reports' && method === 'POST') {
        const input = await body(request, 262_144);
        vault.authenticate(match?.[1] ?? '');
        return json(records.report(id, input), 201);
      }
      const record = pathname.match(/^\/api\/v2\/records\/([a-zA-Z0-9-]+)\/(text|files\/(original|redacted))$/);
      if (record && method === 'GET') {
        if (record[2] === 'text') {
          const result = records.textForApp(id, record[1]);
          return new Response(result.text, { headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8', 'X-CareVault-Receipt': result.requestId } });
        }
        return documentResponse(request, records.fileForApp(id, record[1], record[3] as 'original' | 'redacted'));
      }
      throw new ApiError(404, 'not_found');
    }
    if (pathname.startsWith('/api/owner/')) {
      requireAccount(request, store, 'patient'); actor = 'You';
      if (method !== 'GET') sameOrigin(request);
      if (pathname === '/api/owner/dashboard' && method === 'GET') return json(vault.dashboard());
      if (pathname === '/api/owner/chat/status' && method === 'GET') return json(chatStatus(store));
      const input = method === 'GET' ? {} : await body(request);
      if (pathname === '/api/owner/chat/key' && method === 'POST') return json(setChatKey(store, input.key));
      if (pathname === '/api/owner/chat' && method === 'POST') { actor = 'Health companion'; return json(await chat(vault, input)); }
      if (pathname === '/api/owner/trials/matches' && method === 'POST') {
        if (typeof input.integrationId !== 'string') throw new ApiError(400, 'integration_required');
        return json(vault.trialMatches(input.integrationId, 'patient-demo-001'));
      }
      if (pathname === '/api/owner/trials/requests' && method === 'POST') {
        if (typeof input.integrationId !== 'string') throw new ApiError(400, 'integration_required');
        return json(vault.requestTrialFact(input.integrationId, 'patient-demo-001', input.studyId), 201);
      }
      const ownerTrialRequest = pathname.match(/^\/api\/owner\/trials\/requests\/([a-f0-9-]+)\/(approve|deny|use)$/);
      if (ownerTrialRequest && method === 'POST') {
        if (ownerTrialRequest[2] === 'use') {
          if (typeof input.integrationId !== 'string') throw new ApiError(400, 'integration_required');
          return json(vault.consumeTrialFact(input.integrationId, ownerTrialRequest[1]));
        }
        return json(vault.decideTrialFactRequest(ownerTrialRequest[1], ownerTrialRequest[2] === 'approve'));
      }
      const connection = pathname.match(/^\/api\/owner\/connections\/([a-zA-Z0-9-]+)(\/revoke)?$/);
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
      if (vault.integration(id).recordApiOnly) throw new ApiError(403, 'record_api_required');
      if (pathname === '/api/v1/context' && method === 'POST') return json(vault.read(id, await body(request)));
      if (pathname === '/api/v1/trials/matches' && method === 'POST') {
        const input = await body(request);
        return json(vault.trialMatches(id, input.patientId));
      }
      if (pathname === '/api/v1/trials/requests' && method === 'POST') {
        const input = await body(request);
        return json(vault.requestTrialFact(id, input.patientId, input.studyId), 201);
      }
      const trialRequest = pathname.match(/^\/api\/v1\/trials\/requests\/([a-f0-9-]+)\/use$/);
      if (trialRequest && method === 'POST') return json(vault.consumeTrialFact(id, trialRequest[1]));
      if (pathname === '/api/v1/reports' && method === 'POST') return json(vault.report(id, await body(request)), 201);
      const report = pathname.match(/^\/api\/v1\/reports\/([a-zA-Z0-9-]+)$/);
      if (report && method === 'GET') return json(vault.readReport(id, report[1]));
      const file = pathname.match(/^\/api\/v1\/files\/([a-zA-Z0-9-]+)\/redacted$/);
      if (file && method === 'GET') return new Response(vault.file(id, file[1]), { headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="authorized-extract.txt"' } });
    }
    throw new ApiError(404, 'not_found');
  } catch (error) {
    const safe = error instanceof ApiError ? error : new ApiError(500, 'request_failed', 'The request could not be completed.');
    if (vault && actor && safe.status >= 400 && safe.status < 500) {
      try { vault.activity(actor, 'request', 'denied', safe.code); } catch { /* No sensitive fallback logging. */ }
    }
    return json({ error: safe.code, message: safe.message }, safe.status);
  }
}
