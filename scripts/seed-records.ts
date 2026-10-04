import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Store } from '../lib/store.ts';
import { RecordVault, type DocumentRecord, type RedactionProfile } from '../lib/records.ts';

// Explicit, additive demo import: never reset existing records or grant access.
const store = new Store();
const vault = new RecordVault(store);
let imported = 0;
try {
  for (const name of ['manifest.json', 'nih-manifest.json']) {
    const manifest = JSON.parse(readFileSync(resolve('demo', name), 'utf8')) as { records: { filename: string; title: string; mime: string; profile: RedactionProfile; provenance: string; sha256?: string }[] };
    for (const item of manifest.records) {
      if (basename(item.filename) !== item.filename) throw new Error('Invalid fixture filename');
      const path = resolve('demo/files', item.filename);
      if (!existsSync(path)) { console.log(`Missing ${item.filename}; generate or fetch demo files first.`); continue; }
      const bytes = readFileSync(path), hash = createHash('sha256').update(bytes).digest('hex');
      if (item.sha256 && hash !== item.sha256) throw new Error(`Fixture checksum mismatch: ${item.filename}`);
      if (store.get('demoFixture', `${item.filename}:${hash}`)) continue;
      const document = vault.upload(bytes, item.mime, item.title, item.profile);
      store.put('document', document.id, { ...document, provenance: item.provenance } satisfies DocumentRecord);
      store.put('demoFixture', `${item.filename}:${hash}`, { recordId: document.id });
      imported++;
    }
  }
  console.log(`Queued ${imported} demo records. No access grants changed.`);
} finally { store.close(); }
