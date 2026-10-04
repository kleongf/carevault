import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { handleRequest } from '../lib/http.ts';
import { Store } from '../lib/store.ts';
import { Vault } from '../lib/service.ts';
import type { Account, Role, Session } from '../lib/accounts.ts';
import { defaultGrant } from '../lib/seed.ts';

const origin = 'http://127.0.0.1:3040';
async function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'carevault-accounts-'));
  let store = new Store(directory);
  t.after(() => { store.close(); rmSync(directory, { force: true, recursive: true }); });
  const request = (path: string, method = 'GET', body?: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) => handleRequest(new Request(`${origin}${path}`, {
    method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), store);
  const login = async (role: Role) => {
    const response = await request('/api/session', 'POST', store.credentials.demoAccounts![role]);
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  return { directory, request, login, get store() { return store; }, restart() { store.close(); store = new Store(directory); } };
}
const appInput = { name: 'Research app', description: 'Uses selected records', appUrl: 'http://localhost:3050/', capabilities: ['text:read', 'reports:create'] };

test('patient, developer, and integration identities remain separate and account hashes never leave the server', async t => {
  const f = await setup(t); const patient = await f.login('patient'); const developer = await f.login('developer');
  assert.equal((await f.request('/api/owner/dashboard', 'GET', undefined, developer)).status, 403);
  assert.equal((await f.request('/api/developer/apps', 'GET', undefined, patient)).status, 403);
  assert.equal((await f.request('/api/developer/apps')).status, 401);
  assert.equal((await f.request('/api/developer/apps', 'GET', undefined, undefined, { Authorization: `Bearer ${f.store.credentials.integrationTokens['trial-explorer']}` })).status, 401);
  const session = await (await f.request('/api/session', 'GET', undefined, developer)).json();
  assert.deepEqual(session.account, { id: 'demo-developer', username: 'developer', role: 'developer' });
  const dashboard = await (await f.request('/api/owner/dashboard', 'GET', undefined, patient)).text();
  const apps = await (await f.request('/api/developer/apps', 'GET', undefined, developer)).text();
  for (const account of f.store.all<Account>('account')) {
    assert.ok(!dashboard.includes(account.passwordHash)); assert.ok(!apps.includes(account.passwordHash));
    assert.notEqual(account.passwordHash, f.store.credentials.demoAccounts![account.role].password);
  }
  assert.ok(!apps.includes('grant')); assert.ok(!apps.includes('Alex Morgan')); assert.ok(!apps.includes('memories'));
  assert.equal((await f.request('/api/session', 'POST', { code: f.store.credentials.ownerCode })).status, 401);
});

test('sessions survive restart, expire, and are invalidated server-side by logout; login/session mutations enforce Origin', async t => {
  const f = await setup(t); const cookie = await f.login('patient'); f.restart();
  assert.equal((await f.request('/api/session', 'GET', undefined, cookie)).status, 200);
  assert.equal((await f.request('/api/session', 'DELETE', undefined, cookie, { Origin: 'https://elsewhere.test' })).status, 403);
  assert.equal((await f.request('/api/session', 'POST', f.store.credentials.demoAccounts!.patient, undefined, { Origin: 'https://elsewhere.test' })).status, 403);
  const logout = await f.request('/api/session', 'DELETE', undefined, cookie);
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal((await f.request('/api/session', 'GET', undefined, cookie)).status, 401);
  const other = await f.login('patient');
  for (const row of f.store.db.prepare("SELECT id, body FROM records WHERE kind='session'").all() as {id:string;body:string}[]) {
    const session: Session = JSON.parse(row.body); session.expiresAt = Date.now() - 1; f.store.put('session', row.id, session);
  }
  assert.equal((await f.request('/api/session', 'GET', undefined, other)).status, 401);
});

test('wrong passwords and unknown users share a generic error; throttling persists across restart', async t => {
  const f = await setup(t);
  const wrong = await f.request('/api/session', 'POST', { username: 'patient', password: 'wrong' });
  const unknown = await f.request('/api/session', 'POST', { username: 'unknown', password: 'wrong' });
  assert.equal(wrong.status, 401); assert.deepEqual(await wrong.json(), await unknown.json());
  for (let i = 0; i < 9; i++) assert.equal((await f.request('/api/session', 'POST', { username: 'patient', password: 'wrong' })).status, 401);
  f.restart();
  assert.equal((await f.request('/api/session', 'POST', f.store.credentials.demoAccounts!.patient)).status, 429);
  assert.equal((await f.request('/api/session', 'POST', f.store.credentials.demoAccounts!.developer)).status, 200);
});

test('developer app creation cannot inject grants or ownership and credentials rotate/revoke across restart', async t => {
  const f = await setup(t); const cookie = await f.login('developer');
  const response = await f.request('/api/developer/apps', 'POST', { ...appInput, developerId: 'attacker', grant: { connected: true }, credential: 'injected' }, cookie);
  assert.equal(response.status, 201); const app = await response.json();
  const saved = new Vault(f.store).integration(app.id);
  assert.equal(saved.developerId, 'demo-developer'); assert.equal(saved.grant.connected, false); assert.deepEqual(saved.grant.scopes, []);
  assert.ok(Object.values(saved.grant.categories).every(mode => mode === 'private'));
  const first = await (await f.request(`/api/developer/apps/${app.id}/credential`, 'POST', {}, cookie)).json();
  assert.equal(new Vault(f.store).authenticate(first.token), app.id);
  assert.equal(saved.recordApiOnly, true);
  assert.equal((await f.request('/api/v1/context', 'POST', {}, undefined, { Authorization: `Bearer ${first.token}` })).status, 403);
  assert.ok(!(await (await f.request('/api/developer/apps', 'GET', undefined, cookie)).text()).includes(first.token));
  const second = await (await f.request(`/api/developer/apps/${app.id}/credential`, 'POST', {}, cookie)).json();
  assert.throws(() => new Vault(f.store).authenticate(first.token));
  assert.equal(new Vault(f.store).authenticate(second.token), app.id);
  assert.equal((await f.request(`/api/developer/apps/${app.id}/credential`, 'DELETE', undefined, cookie)).status, 200);
  f.restart(); assert.throws(() => new Vault(f.store).authenticate(second.token));
  assert.equal((await f.request(`/api/developer/apps/trial-explorer/credential`, 'DELETE', undefined, cookie)).status, 200);
  f.restart(); assert.throws(() => new Vault(f.store).authenticate(f.store.credentials.integrationTokens['trial-explorer']));
});

test('developer edits and tokens require ownership and Origin; app URLs and capabilities are constrained', async t => {
  const f = await setup(t); const cookie = await f.login('developer');
  for (const appUrl of ['javascript:alert(1)', 'data:text/html,foo', 'http://public.example/app', 'https://user:pass@example.test/']) {
    assert.equal((await f.request('/api/developer/apps', 'POST', { ...appInput, appUrl }, cookie)).status, 400);
  }
  assert.equal((await f.request('/api/developer/apps', 'POST', { ...appInput, capabilities: ['patient:admin'] }, cookie)).status, 400);
  assert.equal((await f.request('/api/developer/apps', 'POST', appInput, cookie, { Origin: 'https://elsewhere.test' })).status, 403);
  const foreign = new Vault(f.store).integration('trial-explorer'); foreign.developerId = 'different-developer'; f.store.put('integration', foreign.id, foreign);
  for (const method of ['POST', 'DELETE']) assert.equal((await f.request(`/api/developer/apps/${foreign.id}/credential`, method, undefined, cookie)).status, 404);
  assert.equal((await f.request(`/api/developer/apps/${foreign.id}`, 'PUT', appInput, cookie)).status, 404);
});

test('additive account migration preserves legacy grants, memory, and integration credentials', async t => {
  const f = await setup(t); const vault = new Vault(f.store);
  const grant = vault.saveGrant('trial-explorer', { ...defaultGrant(), connected: true });
  vault.restrict('age', 'private');
  const token = f.store.credentials.integrationTokens['trial-explorer'];
  const credentialsPath = join(f.directory, 'credentials.json');
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')); delete credentials.demoAccounts;
  writeFileSync(credentialsPath, JSON.stringify(credentials));
  f.store.remove('account', 'demo-patient'); f.store.remove('account', 'demo-developer');
  f.restart();
  assert.equal(f.store.credentials.integrationTokens['trial-explorer'], token);
  assert.equal(new Vault(f.store).integration('trial-explorer').grant.version, grant.grant.version + 1);
  assert.equal(f.store.get<{restriction:string}>('memory', 'age')!.restriction, 'private');
  assert.equal((await f.request('/api/session', 'POST', f.store.credentials.demoAccounts!.developer)).status, 200);
});

test('developer capability removal does not silently restore old grants when later re-added', async t => {
  const f = await setup(t), cookie = await f.login('developer');
  const app = await (await f.request('/api/developer/apps', 'POST', appInput, cookie)).json();
  f.store.put('recordGrant', app.id, { id: app.id, connected: true, version: 1, allowReports: true, records: { example: { text: true, redacted: false, original: false } } });
  assert.equal((await f.request(`/api/developer/apps/${app.id}`, 'PUT', { ...appInput, capabilities: [] }, cookie)).status, 200);
  await f.request(`/api/developer/apps/${app.id}`, 'PUT', appInput, cookie);
  const grant = f.store.get<{records:Record<string,{text:boolean}>;allowReports:boolean;connected:boolean}>('recordGrant', app.id)!;
  assert.equal(grant.records.example.text, false); assert.equal(grant.allowReports, false);
  await f.request(`/api/developer/apps/${app.id}`, 'PUT', { ...appInput, appUrl: 'https://changed.example/app' }, cookie);
  assert.equal(f.store.get<{connected:boolean}>('recordGrant', app.id)!.connected, false);
});
