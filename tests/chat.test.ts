import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { chat, chatIntegrationId, chatStatus, setChatKey } from '../lib/chat.ts';
import { handleRequest } from '../lib/http.ts';
import { ApiError } from '../lib/policy.ts';
import { defaultGrant } from '../lib/seed.ts';
import { Vault } from '../lib/service.ts';
import { Store } from '../lib/store.ts';
import type { Grant, MemoryItem } from '../lib/types.ts';

const origin = 'http://localhost:3040';
const fakeKey = 'sk-or-v1-TEST-ONLY-000000000000000000000000';
type ProviderBody = { model: string; messages: { role: string; content: string }[]; max_tokens: number; reasoning: { enabled: boolean; exclude: boolean } };

async function setup(t: TestContext) {
  const originalKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const directory = mkdtempSync(join(tmpdir(), 'carevault-chat-tests-'));
  let store = new Store(directory);
  t.after(() => {
    store.close(); rmSync(directory, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });
  const login = await handleRequest(new Request(`${origin}/api/session`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: store.credentials.ownerCode })
  }), store);
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (path: string, options: { owner?: boolean; body?: unknown; headers?: Record<string, string> } = {}) =>
    handleRequest(new Request(`${origin}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: {
        ...(options.owner ? { Cookie: cookie, Origin: origin } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers
      }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    }), store);
  return {
    directory, request, get store() { return store; }, get vault() { return new Vault(store); },
    connect(grant: Grant = { ...defaultGrant(), connected: true, scopes: ['facts:read'] }) {
      return new Vault(store).saveGrant(chatIntegrationId, grant);
    },
    restart() { store.close(); store = new Store(directory); }
  };
}

function provider(reply = 'A provider-generated answer') {
  const calls: { url: string; headers: Headers; body: ProviderBody }[] = [];
  const send: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return Response.json({ model: 'example/free-model', choices: [{ message: { content: reply } }] });
  };
  return { calls, send };
}

function code(expected: string, status?: number) {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, expected);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  };
}

test('chat status, key entry, and chat require owner authentication and mutation origin checks', async t => {
  const f = await setup(t);
  for (const [path, body] of [
    ['/api/owner/chat/status', undefined], ['/api/owner/chat/key', { key: fakeKey }], ['/api/owner/chat', { message: 'Hello' }]
  ] as const) {
    const response = await f.request(path, { body });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'sign_in_required');
    const integration = await f.request(path, { body, headers: { Authorization: `Bearer ${f.store.credentials.integrationTokens[chatIntegrationId]}` } });
    assert.equal(integration.status, 401);
  }
  for (const path of ['/api/owner/chat/key', '/api/owner/chat']) {
    const response = await f.request(path, { owner: true, headers: { Origin: 'https://attacker.test' }, body: { key: fakeKey, message: 'Hello' } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'origin_not_allowed');
  }
  assert.deepEqual(await (await f.request('/api/owner/chat/status', { owner: true })).json(), {
    configured: false, model: 'openrouter/free', integrationId: chatIntegrationId
  });
});

test('API key is never returned in status or dashboard, never persisted, and clears on store restart', async t => {
  const f = await setup(t);
  const keyResponse = await f.request('/api/owner/chat/key', { owner: true, body: { key: fakeKey } });
  assert.equal(keyResponse.status, 200);
  const result = await keyResponse.json();
  assert.equal(result.configured, true);
  assert.ok(!JSON.stringify(result).includes(fakeKey));
  for (const path of ['/api/owner/chat/status', '/api/owner/dashboard']) {
    const response = await f.request(path, { owner: true });
    assert.equal(response.headers.get('cache-control'), 'no-store, private');
    assert.ok(!(await response.text()).includes(fakeKey));
  }
  for (const file of readdirSync(f.directory)) assert.ok(!readFileSync(join(f.directory, file)).includes(Buffer.from(fakeKey)), `Secret persisted in ${file}`);
  f.restart();
  assert.equal(chatStatus(f.store).configured, false);
  const invalid = await f.request('/api/owner/chat/key', { owner: true, body: { key: 'short' } });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid_key');
});

test('existing vault migration adds disconnected read-only companion without resetting patient records or other grants', async t => {
  const f = await setup(t);
  const grant = { ...defaultGrant(), connected: true }; grant.categories.identity = 'private';
  const original = f.vault.saveGrant('trial-explorer', grant);
  f.vault.restrict('age', 'private');
  const credential = f.store.credentials.integrationTokens['trial-explorer'];
  // Recreate the shape of an existing vault written before the companion registration shipped.
  f.store.db.prepare('DELETE FROM records WHERE id=? AND kind IN (?,?)').run(chatIntegrationId, 'integration', 'credential');
  const credentials = structuredClone(f.store.credentials);
  delete credentials.integrationTokens[chatIntegrationId];
  writeFileSync(join(f.directory, 'credentials.json'), JSON.stringify(credentials), { mode: 0o600 });
  const expectedGrant = f.vault.integration('trial-explorer').grant;
  f.restart();
  const companion = f.vault.integration(chatIntegrationId);
  assert.equal(companion.grant.connected, false);
  assert.deepEqual(companion.grant.scopes, ['facts:read']);
  assert.ok(f.store.credentials.integrationTokens[chatIntegrationId]);
  assert.equal(f.vault.authenticate(f.store.credentials.integrationTokens[chatIntegrationId]), chatIntegrationId);
  assert.deepEqual(f.vault.integration('trial-explorer').grant, expectedGrant);
  assert.equal(expectedGrant.version, original.grant.version + 1);
  assert.equal(f.store.credentials.integrationTokens['trial-explorer'], credential);
  assert.equal(f.store.get<MemoryItem>('memory', 'age')?.restriction, 'private');
});

test('disconnected, scope-less, and key-less chat fails before provider contact without a mock reply', async t => {
  const f = await setup(t);
  const p = provider();
  setChatKey(f.store, fakeKey);
  await assert.rejects(chat(f.vault, { message: 'Hello' }, p.send), code('access_not_authorized', 403));
  f.connect({ ...defaultGrant(), connected: true, scopes: ['reports:create'] });
  await assert.rejects(chat(f.vault, { message: 'Hello' }, p.send), code('access_not_authorized', 403));
  f.connect(); f.restart();
  await assert.rejects(chat(f.vault, { message: 'Hello' }, p.send), code('key_required', 503));
  const response = await f.request('/api/owner/chat', { owner: true, body: { message: 'Hello' } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'key_required');
  assert.equal(p.calls.length, 0);
});

test('provider receives only projected context and hardcoded free routing; typed text is explicitly separate', async t => {
  const f = await setup(t); f.connect(); setChatKey(f.store, fakeKey);
  const p = provider('An actual fake-provider answer, never a built-in mock.');
  const before = f.vault.memories();
  const expected = f.vault.preview(chatIntegrationId).items;
  const result = await chat(f.vault, {
    message: 'What could I ask at my appointment?', model: 'paid/premium', endpoint: 'https://attacker.test',
    integrationId: 'scan-review', patientId: 'patient-demo-002', context: 'Caller-provided replacement vault'
  }, p.send);
  assert.equal(p.calls.length, 1);
  const call = p.calls[0];
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.headers.get('authorization'), `Bearer ${fakeKey}`);
  assert.equal(call.body.model, 'openrouter/free');
  assert.equal(call.body.max_tokens, 1600);
  assert.deepEqual(call.body.reasoning, { enabled: false, exclude: true });
  const context = call.body.messages[1].content.split('\n').slice(1).join('\n');
  assert.deepEqual(JSON.parse(context), expected);
  const wireBody = JSON.stringify(call.body);
  for (const hidden of ['Alex Morgan', 'alex.morgan@example.test', 'anxiety', 'mental-note', 'other-patient', fakeKey, f.store.credentials.ownerCode, 'Caller-provided replacement vault']) {
    assert.ok(!wireBody.includes(hidden), `Unexpected provider payload value: ${hidden}`);
  }
  assert.equal(result.reply, 'An actual fake-provider answer, never a built-in mock.');
  assert.deepEqual(result.context.items, expected);
  assert.deepEqual(f.vault.memories(), before);
  const activity = JSON.stringify(f.vault.dashboard().activity);
  assert.ok(!activity.includes(fakeKey));
  assert.ok(!activity.includes('What could I ask at my appointment?'));
  assert.ok(!activity.includes(result.reply));
});

test('conversation reuses bounded history within a policy version and drops it after privacy changes', async t => {
  const f = await setup(t); f.connect(); setChatKey(f.store, fakeKey);
  const p = provider('Prior assistant answer');
  const first = await chat(f.vault, { message: 'First sensitive question' }, p.send);
  assert.equal(first.historyReset, false);
  const second = await chat(f.vault, { message: 'Follow-up', conversationId: first.conversationId }, p.send);
  assert.equal(second.conversationId, first.conversationId);
  assert.equal(second.historyReset, false);
  assert.deepEqual(p.calls[1].body.messages.slice(2).map(m => m.content), ['First sensitive question', 'Prior assistant answer', 'Follow-up']);
  f.vault.restrict('age', 'private');
  const third = await chat(f.vault, { message: 'New permitted question', conversationId: second.conversationId }, p.send);
  assert.equal(third.historyReset, true);
  assert.deepEqual(p.calls[2].body.messages.slice(2).map(m => m.content), ['New permitted question']);
  assert.ok(!p.calls[2].body.messages[1].content.includes('"id":"age"'));
  for (let index = 0; index < 6; index++) await chat(f.vault, { message: `Follow-up ${index}`, conversationId: third.conversationId }, p.send);
  assert.equal(p.calls.at(-1)!.body.messages.length, 9); // Two system entries, six retained turns, current question.
});

test('grant changes during asynchronous generation prevent releasing stale answers or retaining their history', async t => {
  const f = await setup(t); f.connect(); setChatKey(f.store, fakeKey);
  const p = provider();
  const first = await chat(f.vault, { message: 'Before change', conversationId: 'unknown-session' }, p.send);
  let finish!: (response: Response) => void;
  const pendingProvider: typeof fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = chat(f.vault, { message: 'In-flight question', conversationId: first.conversationId }, pendingProvider);
  f.vault.restrict('age', 'private');
  finish(Response.json({ choices: [{ message: { content: 'STALE-ANSWER-MUST-NOT-ESCAPE' } }] }));
  await assert.rejects(pending, code('permissions_changed', 409));
  const next = await chat(f.vault, { message: 'After change', conversationId: first.conversationId }, p.send);
  assert.equal(next.historyReset, true);
  assert.deepEqual(p.calls.at(-1)!.body.messages.slice(2).map(m => m.content), ['After change']);
  assert.ok(!JSON.stringify(f.vault.dashboard()).includes('STALE-ANSWER-MUST-NOT-ESCAPE'));
});

test('revocation while generation is pending denies its answer and later chat', async t => {
  const f = await setup(t); f.connect(); setChatKey(f.store, fakeKey);
  let finish!: (response: Response) => void;
  const pending = chat(f.vault, { message: 'Pending request' }, () => new Promise(resolve => { finish = resolve; }));
  f.vault.revoke(chatIntegrationId);
  finish(Response.json({ choices: [{ message: { content: 'Revoked answer' } }] }));
  await assert.rejects(pending, code('access_not_authorized', 403));
  const p = provider();
  await assert.rejects(chat(f.vault, { message: 'Retry' }, p.send), code('access_not_authorized', 403));
  assert.equal(p.calls.length, 0);
  assert.ok(!f.vault.dashboard().activity.some(a => a.operation === 'ai_reply'));
});

test('provider failures return sanitized explicit errors and release the busy guard', async t => {
  const f = await setup(t); f.connect(); setChatKey(f.store, fakeKey);
  const sentinel = 'PROVIDER-SECRET-RAW-ERROR';
  const cases: { send: typeof fetch; expected: string; status: number }[] = [
    { send: async () => new Response(`${fakeKey} ${sentinel}`, { status: 401 }), expected: 'provider_access_denied', status: 502 },
    { send: async () => new Response(sentinel, { status: 403 }), expected: 'provider_access_denied', status: 502 },
    { send: async () => new Response(sentinel, { status: 429 }), expected: 'provider_rate_limited', status: 429 },
    { send: async () => new Response(sentinel, { status: 500 }), expected: 'provider_unavailable', status: 502 },
    { send: async () => new Response(sentinel), expected: 'invalid_provider_response', status: 502 },
    { send: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: `${sentinel}: unfinished thinking draft` } }] }), expected: 'incomplete_provider_response', status: 502 },
    { send: async () => Response.json({ choices: [{ message: { content: '' } }] }), expected: 'empty_provider_response', status: 502 },
    { send: async () => Response.json({ choices: [{ message: { content: 'x'.repeat(12001) } }] }), expected: 'empty_provider_response', status: 502 },
    { send: async () => { throw new Error(`${fakeKey} ${sentinel}`); }, expected: 'provider_unavailable', status: 502 }
  ];
  for (const entry of cases) {
    await assert.rejects(chat(f.vault, { message: 'Hello' }, entry.send), failure => {
      code(entry.expected, entry.status)(failure);
      assert.ok(!String(failure).includes(sentinel));
      assert.ok(!String(failure).includes(fakeKey));
      return true;
    });
  }
  const p = provider('Provider recovered');
  assert.equal((await chat(f.vault, { message: 'Retry' }, p.send)).reply, 'Provider recovered');
  assert.equal(f.vault.dashboard().activity.filter(a => a.operation === 'ai_reply').length, 1);
  assert.ok(!JSON.stringify(f.vault.dashboard()).includes(sentinel));
});

test('bounded inputs and concurrent requests fail before a second provider invocation', async t => {
  const f = await setup(t); f.connect(); setChatKey(f.store, fakeKey);
  const p = provider();
  for (const message of ['', '   ', 'x'.repeat(2001), 7]) {
    await assert.rejects(chat(f.vault, { message }, p.send), code('invalid_message', 400));
  }
  for (const conversationId of [8, 'x'.repeat(65)]) {
    await assert.rejects(chat(f.vault, { message: 'Hello', conversationId }, p.send), code('invalid_conversation', 400));
  }
  assert.equal(p.calls.length, 0);
  let finish!: (response: Response) => void;
  const pending = chat(f.vault, { message: 'First' }, () => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(chat(f.vault, { message: 'Concurrent' }, p.send), code('chat_busy', 429));
  assert.equal(p.calls.length, 0);
  finish(Response.json({ choices: [{ message: { content: 'First completed' } }] }));
  await pending;
  assert.equal((await chat(f.vault, { message: 'Later' }, p.send)).reply, 'A provider-generated answer');
});
