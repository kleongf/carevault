'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Braces, Check, Copy, Eye, EyeOff, Info, KeyRound, LoaderCircle, LogOut, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { errorMessage, request } from './shared';

const capabilityLabels = {
  'text:read': 'Read redacted text',
  'files:redacted': 'Read redacted files',
  'files:original': 'Read original files',
  'reports:create': 'Write reports',
} as const;
type Capability = keyof typeof capabilityLabels;
type DeveloperApp = {
  id: string; name: string; description: string; appUrl: string;
  capabilities: Capability[]; credentialActive: boolean;
};
type AppForm = Pick<DeveloperApp, 'name' | 'description' | 'appUrl' | 'capabilities'>;
const emptyForm: AppForm = { name: '', description: '', appUrl: '', capabilities: [] };

export function DeveloperWorkspace({ username, onSignOut }: { username: string; onSignOut: () => void | Promise<void> }) {
  const [view, setView] = useState<'apps' | 'setup'>('apps');
  const [apps, setApps] = useState<DeveloperApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<DeveloperApp | 'new' | null>(null);
  const [form, setForm] = useState<AppForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [credentialApp, setCredentialApp] = useState<DeveloperApp | null>(null);
  const [token, setToken] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [credentialError, setCredentialError] = useState('');
  const dialogOpener = useRef<HTMLButtonElement | null>(null);
  function restoreDialogFocus(event: Event) {
    event.preventDefault();
    dialogOpener.current?.focus();
  }

  async function refresh() {
    const result = await request<{ apps: DeveloperApp[] }>('/api/developer/apps');
    setApps(result.apps);
  }
  useEffect(() => { refresh().catch(err => setError(errorMessage(err))).finally(() => setLoading(false)); }, []);

  function edit(app: DeveloperApp | 'new', opener: HTMLButtonElement) {
    dialogOpener.current = opener;
    setForm(app === 'new' ? { ...emptyForm, capabilities: [] } : { name: app.name, description: app.description, appUrl: app.appUrl, capabilities: [...app.capabilities] });
    setFormError(''); setEditing(app);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing) return;
    setBusy('save'); setFormError(''); setNotice('');
    let saved = false;
    try {
      await request(editing === 'new' ? '/api/developer/apps' : `/api/developer/apps/${encodeURIComponent(editing.id)}`, editing === 'new' ? 'POST' : 'PUT', form);
      saved = true; setNotice('App saved.');
      await refresh();
    } catch (err) { if (saved) setError(errorMessage(err)); else setFormError(errorMessage(err)); }
    finally { setBusy(''); if (saved) setEditing(null); }
  }
  function closeCredentials() { setToken(''); setRevealed(false); setCredentialError(''); setCredentialApp(null); }
  async function credentialAction(action: 'issue' | 'revoke') {
    if (!credentialApp) return;
    setBusy(action); setCredentialError(''); setToken(''); setRevealed(false); setNotice('');
    try {
      const path = `/api/developer/apps/${encodeURIComponent(credentialApp.id)}/credential`;
      if (action === 'issue') {
        const result = await request<{ token: string; app: DeveloperApp }>(path, 'POST', {});
        setToken(result.token); setCredentialApp(result.app);
      } else {
        await request(path, 'DELETE');
        setCredentialApp({ ...credentialApp, credentialActive: false });
        setNotice('Credential revoked.');
      }
      await refresh();
    } catch (err) { setCredentialError(errorMessage(err)); }
    finally { setBusy(''); }
  }
  async function signOut() {
    setBusy('logout'); setError(''); setToken(''); setRevealed(false);
    try { await onSignOut(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><ShieldCheck size={20} /></span>CareVault</div>
      <nav aria-label="Developer navigation"><button type="button" className={`nav-link ${view === 'apps' ? 'active' : ''}`} aria-current={view === 'apps' ? 'page' : undefined} onClick={() => { setView('apps'); setNotice(''); }}><Braces size={17} />My apps</button><button type="button" className={`nav-link ${view === 'setup' ? 'active' : ''}`} aria-current={view === 'setup' ? 'page' : undefined} onClick={() => { setView('setup'); setNotice(''); }}><KeyRound size={17} />API setup</button></nav>
      <div className="sidebar-bottom"><div className="patient"><span className="avatar"><Braces size={16} /></span><div><strong>{username}</strong><span>Developer</span></div></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><span>Developer</span><div className="flex items-center gap-3"><Badge variant="outline">Demo</Badge><Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" disabled={!!busy} onClick={signOut}><LogOut size={17} aria-hidden="true" /></Button></div></header>
      <main className="main-content">
        {error && <div className="alert error" role="alert">{error}<Button variant="ghost" size="sm" disabled={!!busy || loading} onClick={async () => { setError(''); setLoading(true); try { await refresh(); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); } }}>Retry</Button></div>}
        {notice && <div className="alert success" role="status"><Check size={14} />{notice}</div>}
        {view === 'apps' ? <>
          <div className="page-heading"><div><h1>My apps</h1></div><Button disabled={!!busy || loading} onClick={event => edit('new', event.currentTarget)}><Plus size={16} />New app</Button></div>
          {loading ? <p className="flex items-center gap-2" role="status"><LoaderCircle size={16} className="animate-spin" />Loading apps…</p> : <div className="integration-grid">{apps.map(app => <Card className="integration-card" key={app.id}><CardContent>
            <span className="integration-icon"><Braces size={16} /></span>
            <div className="integration-main"><div className="integration-title"><h2>{app.name}</h2><details className="compact-details"><summary aria-label={`About ${app.name}`} title="App details"><Info size={16} aria-hidden="true" /></summary><div className="integration-about"><p>{app.description}</p><code className="break-all text-xs">{app.id}</code><div className="card-scopes">{app.capabilities.length ? app.capabilities.map(capability => <span key={capability}>{capabilityLabels[capability].replace(/^(Read|Write) /, '')}</span>) : <span>No capabilities</span>}</div></div></details></div></div>
            <Badge variant={app.credentialActive ? 'secondary' : 'outline'}>{app.credentialActive ? 'Credential active' : 'No credential'}</Badge>
            <div className="integration-actions"><Button size="sm" variant="outline" title="Edit app" disabled={!!busy} aria-label={`Edit ${app.name}`} onClick={event => edit(app, event.currentTarget)}><Pencil size={15} aria-hidden="true" />Edit</Button><Button size="sm" variant="outline" title="Credentials" disabled={!!busy} aria-label={`Manage credentials for ${app.name}`} onClick={event => { dialogOpener.current = event.currentTarget; setToken(''); setRevealed(false); setCredentialError(''); setCredentialApp(app); }}><KeyRound size={15} aria-hidden="true" />Credentials</Button></div>
          </CardContent></Card>)}{!apps.length && <Card><CardContent className="py-8"><p>No apps yet.</p></CardContent></Card>}</div>}
        </> : <>
          <div className="page-heading"><div><h1>API setup</h1></div></div>
          <Card className="api-card"><CardContent><details className="api-details"><summary><h2>Server setup</h2></summary><ol className="my-4 list-decimal space-y-2 pl-5 text-sm"><li>Register your app and issue a credential.</li><li>Set the server variables below.</li><li>The patient connects your app and selects records.</li></ol><CodeSample label="Server setup example" source={'CAREVAULT_URL=http://127.0.0.1:3040\nCAREVAULT_TOKEN=<your-app-credential>'} /><p className="helper mt-3">Keep credentials on your server, outside frontend code and model prompts.</p></details></CardContent></Card>
          <Card className="api-card"><CardContent><details className="api-details"><summary><h2>Read records</h2></summary><CodeSample label="Read records example" source={`const response = await fetch(
  process.env.CAREVAULT_URL + "/api/v2/records",
  { headers: { Authorization: "Bearer " + process.env.CAREVAULT_TOKEN } }
);
if (!response.ok) throw new Error("CareVault request denied or failed");
const result = await response.json();`} /><CodeSample label="Record routes" source={`GET /api/v2/records/:id/text
GET /api/v2/records/:id/files/redacted
GET /api/v2/records/:id/files/original`} /><p className="helper mt-3">Each version needs permission. Read fresh context for each operation.</p></details></CardContent></Card>
          <Card className="api-card"><CardContent><details className="api-details"><summary><h2>Write a report</h2></summary><CodeSample label="Write a report example" source={`POST /api/v2/reports
Authorization: Bearer <your-app-credential>
Content-Type: application/json

{
  "title": "Chest X-ray review",
  "body": "Your integration-generated report",
  "sourceReceiptIds": ["<X-CareVault-Receipt from a read>"]
}`} /><p className="helper mt-3">Requires report permission. New reports start unshared.</p></details></CardContent></Card>
        </>}
      </main>
    </div>
    {editing && <Dialog open onOpenChange={open => { if (!open && !busy) setEditing(null); }}><DialogContent className="permission-dialog" onCloseAutoFocus={restoreDialogFocus} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{editing === 'new' ? 'New app' : 'Edit app'}</DialogTitle><DialogDescription className="sr-only">Shown in the patient’s app directory.</DialogDescription></DialogHeader>
      <form onSubmit={save} className="space-y-4">
        <div><label htmlFor="app-name" className="mb-2 block text-sm">App name</label><Input id="app-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} maxLength={80} required disabled={!!busy} /></div>
        <div><label htmlFor="app-description" className="mb-2 block text-sm">Description</label><Textarea id="app-description" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} maxLength={400} required disabled={!!busy} /></div>
        <div><label htmlFor="app-url" className="mb-2 block text-sm">App URL</label><Input id="app-url" type="url" placeholder="http://127.0.0.1:3050" value={form.appUrl} onChange={event => setForm({ ...form, appUrl: event.target.value })} maxLength={2048} required disabled={!!busy} /></div>
        <fieldset disabled={!!busy}><legend className="mb-2 text-sm">Requested capabilities</legend><div className="space-y-2">{(Object.keys(capabilityLabels) as Capability[]).map(capability => <label key={capability} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.capabilities.includes(capability)} onChange={event => setForm({ ...form, capabilities: event.target.checked ? [...form.capabilities, capability] : form.capabilities.filter(value => value !== capability) })} />{capabilityLabels[capability]}</label>)}</div></fieldset>
        {formError && <p className="alert error" role="alert">{formError}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={!!busy} onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save app'}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>}
    {credentialApp && <Dialog open onOpenChange={open => { if (!open && !busy) closeCredentials(); }}><DialogContent onCloseAutoFocus={restoreDialogFocus} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{credentialApp.name} credential</DialogTitle><DialogDescription>{token ? 'Shown once. Save it before closing.' : credentialApp.credentialActive ? 'Rotation invalidates the current credential.' : 'Keep this credential on your server.'}</DialogDescription></DialogHeader>
      {token && <div><label htmlFor="app-credential" className="mb-2 block text-sm">New credential</label><div className="flex gap-2"><Input id="app-credential" type={revealed ? 'text' : 'password'} value={token} readOnly autoComplete="off" spellCheck={false} onFocus={event => event.target.select()} /><Button variant="outline" size="icon" aria-label={revealed ? 'Hide credential' : 'Reveal credential'} onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={16} /> : <Eye size={16} />}</Button></div></div>}
      {credentialError && <p className="alert error" role="alert">{credentialError}</p>}
      <DialogFooter>{!token && credentialApp.credentialActive && <Button variant="destructive" disabled={!!busy} onClick={() => credentialAction('revoke')}>{busy === 'revoke' ? 'Revoking…' : 'Revoke'}</Button>}{!token && <Button disabled={!!busy} onClick={() => credentialAction('issue')}>{busy === 'issue' ? 'Issuing…' : credentialApp.credentialActive ? 'Rotate credential' : 'Issue credential'}</Button>}<Button variant="outline" disabled={!!busy} onClick={closeCredentials}>{token ? 'Done' : 'Close'}</Button></DialogFooter>
    </DialogContent></Dialog>}
  </div>;
}

function CodeSample({ source, label }: { source: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  }
  return <div className="doc-code"><button type="button" className="doc-copy" aria-label={copied ? `Copied ${label}` : `Copy ${label}`} onClick={copy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}</button><pre>{tokenize(source).map((token, index) => <span key={index} className={token.kind === 'plain' ? undefined : `tok-${token.kind}`}>{token.text}</span>)}</pre></div>;
}

function tokenize(source: string) {
  const pattern = /\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|<[^>\n]+>|\b(?:const|let|var|if|else|throw|new|return|await|function|true|false|null)\b|\b(?:GET|POST|PUT|DELETE|PATCH)\b|\b[A-Za-z_$][\w$]*(?=\s*\()|\b[A-Z][A-Z0-9_]{1,}\b|:[A-Za-z_][\w-]*|\.[A-Za-z_$][\w$]*/g;
  const tokens: { kind: string; text: string }[] = [];
  let index = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > index) tokens.push({ kind: 'plain', text: source.slice(index, start) });
    const text = match[0];
    tokens.push({ kind: tokenKind(text), text });
    index = start + text.length;
  }
  if (index < source.length) tokens.push({ kind: 'plain', text: source.slice(index) });
  return tokens;
}

function tokenKind(text: string) {
  if (text.startsWith('//')) return 'comment';
  if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`') || text.startsWith('<')) return 'string';
  if (text.startsWith(':') || text.startsWith('.')) return 'param';
  if (/^(GET|POST|PUT|DELETE|PATCH)$/.test(text)) return 'method';
  if (/^(const|let|var|if|else|throw|new|return|await|function|true|false|null)$/.test(text)) return 'keyword';
  if (/^[A-Z][A-Z0-9_]+$/.test(text)) return 'prop';
  return 'fn';
}
