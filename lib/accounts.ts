import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Store } from './store.ts';
import { ApiError } from './policy.ts';

export type Role = 'patient' | 'developer';
export interface Account { id: string; username: string; role: Role; salt: string; passwordHash: string; }
export interface Session { accountId: string; expiresAt: number; }
export const sessionCookie = 'carevault_session';
const sessionLifetime = 8 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function initializeAccounts(store: Store) {
  for (const role of ['patient', 'developer'] as const) {
    const id = `demo-${role}`;
    if (store.get('account', id)) continue;
    const initial = store.credentials.demoAccounts![role];
    const salt = randomBytes(16).toString('hex');
    store.put('account', id, { id, username: initial.username, role, salt,
      passwordHash: scryptSync(initial.password, salt, 64).toString('hex') } satisfies Account);
  }
}
export function publicAccount(account: Account) {
  return { id: account.id, username: account.username, role: account.role };
}
function tokenFrom(request: Request) {
  return request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
}
export function requireAccount(request: Request, store: Store, role?: Role): Account {
  const token = tokenFrom(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'sign_in_required');
  const session = store.get<Session>('session', hash(token));
  const account = session && session.expiresAt > Date.now() ? store.get<Account>('account', session.accountId) : undefined;
  if (!account) throw new ApiError(401, 'sign_in_required');
  if (role && account.role !== role) throw new ApiError(403, 'role_not_allowed');
  return account;
}
export function issueSession(store: Store, account: Account): string {
  const token = randomBytes(32).toString('hex');
  store.transaction(() => {
    for (const row of store.db.prepare("SELECT id, body FROM records WHERE kind='session'").all() as { id: string; body: string }[]) {
      if ((JSON.parse(row.body) as Session).expiresAt <= Date.now()) store.remove('session', row.id);
    }
    const active = (store.db.prepare("SELECT id, body FROM records WHERE kind='session' ORDER BY rowid").all() as { id: string; body: string }[])
      .filter(row => (JSON.parse(row.body) as Session).accountId === account.id);
    for (const row of active.slice(0, Math.max(0, active.length - 9))) store.remove('session', row.id);
    store.put('session', hash(token), { accountId: account.id, expiresAt: Date.now() + sessionLifetime } satisfies Session);
  });
  return token;
}
export function endSession(request: Request, store: Store) {
  const token = tokenFrom(request);
  if (token && /^[a-f0-9]{64}$/.test(token)) store.remove('session', hash(token));
}
export async function authenticateAccount(store: Store, input: Record<string, unknown>): Promise<Account> {
  if (typeof input.username !== 'string' || input.username.length > 64 || typeof input.password !== 'string' || input.password.length > 256) throw new ApiError(401, 'invalid_login', 'Incorrect username or password.');
  const username = input.username.trim().toLowerCase();
  const account = store.all<Account>('account').find(a => a.username === username);
  // Only two seeded accounts. Unknown usernames share a bounded throttle bucket.
  const bucket = account?.id ?? 'unknown';
  const prior = store.get<{ count: number; since: number }>('login_attempt', bucket);
  const attempt = !prior || Date.now() - prior.since >= 60_000 ? { count: 0, since: Date.now() } : prior;
  if (attempt.count >= 10) throw new ApiError(429, 'try_again_later', 'Too many attempts. Try again in a minute.');
  attempt.count++; store.put('login_attempt', bucket, attempt);
  // Use the same expensive operation for an unknown username.
  const salt = account?.salt ?? '00000000000000000000000000000000';
  const candidate = await new Promise<Buffer>((resolve, reject) => scrypt(input.password as string, salt, 64, (error, value) => error ? reject(error) : resolve(value)));
  const expected = Buffer.from(account?.passwordHash ?? '00'.repeat(64), 'hex');
  if (!timingSafeEqual(candidate, expected) || !account) throw new ApiError(401, 'invalid_login', 'Incorrect username or password.');
  store.remove('login_attempt', bucket);
  return account;
}
export function cookieHeader(request: Request, token: string, clear = false): string {
  return `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : sessionLifetime / 1000}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
