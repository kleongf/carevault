import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { integrations, memories, sources } from './seed.ts';

export interface Credentials { ownerCode: string; sessionSecret: string; integrationTokens: Record<string, string>; }
export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export class Store {
  db: DatabaseSync; credentials: Credentials;
  constructor(directory = process.env.CAREVAULT_DATA_DIR || resolve(process.cwd(), 'data')) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const credentialsPath = resolve(directory, 'credentials.json');
    if (!existsSync(credentialsPath)) {
      const credentials: Credentials = {
        ownerCode: randomBytes(18).toString('base64url'), sessionSecret: randomBytes(32).toString('hex'),
        integrationTokens: Object.fromEntries(integrations().map(i => [i.id, randomBytes(32).toString('base64url')]))
      };
      writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600, flag: 'wx' });
    }
    this.credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    chmodSync(credentialsPath, 0o600);
    this.db = new DatabaseSync(resolve(directory, 'vault.sqlite'));
    chmodSync(resolve(directory, 'vault.sqlite'), 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));');
    if (!this.get('meta', 'seeded')) this.transaction(() => {
      for (const i of integrations()) this.put('integration', i.id, i);
      for (const m of memories()) this.put('memory', m.id, m);
      for (const s of sources) this.put('source', s.id, s);
      for (const [id, token] of Object.entries(this.credentials.integrationTokens)) this.put('credential', id, { hash: digest(token) });
      this.put('meta', 'seeded', { version: 1 });
    });
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as T : undefined;
  }
  all<T>(kind: string): T[] { return (this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind) as { body: string }[]).map(row => JSON.parse(row.body) as T); }
  put(kind: string, id: string, body: unknown): void {
    this.db.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, id, JSON.stringify(body));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
const holder = globalThis as typeof globalThis & { carevaultStore?: Store };
export function getStore(): Store { return holder.carevaultStore ??= new Store(); }
