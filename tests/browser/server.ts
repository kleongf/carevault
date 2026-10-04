// Disposable browser-test server. Never opens the operator's vault or provider key.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Store } from '../../lib/store.ts';
import { RecordVault } from '../../lib/records.ts';
import { Developer } from '../../lib/developer.ts';
import type { Account } from '../../lib/accounts.ts';

const directory = mkdtempSync(join(tmpdir(), 'carevault-playwright-'));
const store = new Store(directory);
for (const account of store.all<Account>('account')) {
  account.passwordHash = scryptSync('Browser-test-only-2026', account.salt, 64).toString('hex');
  store.put('account', account.id, account);
}
// Small, valid two-page PDF; synthetic renditions isolate UI from OCR/model timing.
function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['Synthetic page one', 'Synthetic page two'].map(text => {
      const stream = `BT /F1 14 Tf 20 250 Td (${text}) Tj ET\n`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    }),
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
const vault = new RecordVault(store), bytes = pdf();
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=', 'base64');
for (const [title, mime, data, status] of [
  ['Synthetic visit.pdf', 'application/pdf', bytes, 'ready'],
  ['Synthetic image.png', 'image/png', image, 'ready'],
  ['Failed scan.pdf', 'application/pdf', bytes, 'failed'],
  ['Waiting scan.pdf', 'application/pdf', bytes, 'queued'],
] as const) {
  const doc = vault.upload(data, mime, title);
  if (status === 'ready') {
    writeFileSync(join(directory, 'documents', doc.id, 'extracted.txt'), 'Synthetic Person reports a cough.');
    writeFileSync(join(directory, 'documents', doc.id, 'redacted.txt'), '[REDACTED] reports a cough.');
    writeFileSync(join(directory, 'documents', doc.id, mime === 'image/png' ? 'redacted.png' : 'redacted.pdf'), data);
  }
  store.put('document', doc.id, { ...doc, status, provenance: 'Synthetic browser fixture; not a patient record.' });
}
const developer = new Developer(store, store.get<Account>('account', 'demo-developer')!);
for (const name of ['desktop', 'mobile']) developer.create({ name: `Browser Review ${name}`, description: 'Synthetic browser test integration.', appUrl: 'https://example.test/', capabilities: ['text:read', 'files:redacted', 'files:original', 'reports:create'] });
store.close();
const env = { ...process.env, CAREVAULT_DATA_DIR: directory, OPENROUTER_API_KEY: '', NEXT_TELEMETRY_DISABLED: '1' };
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3140'], { env, stdio: 'inherit' });
let closing = false;
function stop() { if (!closing) { closing = true; child.kill('SIGTERM'); } }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.on('exit', code => { rmSync(directory, { recursive: true, force: true }); process.exit(closing ? 0 : (code ?? 1)); });
