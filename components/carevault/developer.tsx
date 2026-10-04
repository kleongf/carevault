'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Braces, Check, Eye, EyeOff, KeyRound, LoaderCircle, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { errorMessage, request } from './shared';

const capabilityLabels = {
  'text:read': 'Read extracted text',
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

  async function refresh() {
    const result = await request<{ apps: DeveloperApp[] }>('/api/developer/apps');
    setApps(result.apps);
  }
  useEffect(() => { refresh().catch(err => setError(errorMessage(err))).finally(() => setLoading(false)); }, []);

  function edit(app: DeveloperApp | 'new') {
    setForm(app === 'new' ? { ...emptyForm, capabilities: [] } : { name: app.name, description: app.description, appUrl: app.appUrl, capabilities: [...app.capabilities] });
    setFormError(''); setEditing(app);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing) return;
    setBusy('save'); setFormError(''); setNotice('');
    let saved = false;
    try {
      await request(editing === 'new' ? '/api/developer/apps' : `/api/developer/apps/${encodeURIComponent(editing.id)}`, editing === 'new' ? 'POST' : 'PUT', form);
      saved = true; setEditing(null); setNotice('App saved.');
      await refresh();
    } catch (err) { if (saved) setError(errorMessage(err)); else setFormError(errorMessage(err)); }
    finally { setBusy(''); }
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
      <nav aria-label="Developer navigation"><button type="button" className={`nav-link ${view === 'apps' ? 'active' : ''}`} aria-current={view === 'apps' ? 'page' : undefined} onClick={() => setView('apps')}><Braces size={17} />My apps</button><button type="button" className={`nav-link ${view === 'setup' ? 'active' : ''}`} aria-current={view === 'setup' ? 'page' : undefined} onClick={() => setView('setup')}><KeyRound size={17} />API setup</button></nav>
      <div className="sidebar-bottom"><div className="patient"><span className="avatar"><Braces size={16} /></span><div><strong>{username}</strong><span>Developer</span></div></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><span>Developer workspace</span><div className="flex items-center gap-3"><Badge variant="outline">Demo</Badge><Button variant="ghost" size="sm" disabled={!!busy} onClick={signOut}><LogOut size={14} />Sign out</Button></div></header>
      <main className="main-content">
        {error && <div className="alert error" role="alert">{error}<Button variant="ghost" size="sm" disabled={!!busy || loading} onClick={async () => { setError(''); setLoading(true); try { await refresh(); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); } }}>Retry</Button></div>}
        {notice && <div className="alert success" role="status"><Check size={14} />{notice}</div>}
        {view === 'apps' ? <>
          <div className="page-heading"><div><h1>My apps</h1><p>Build integrations for CareVault.</p></div><Button disabled={!!busy || loading} onClick={() => edit('new')}><Plus size={16} />New app</Button></div>
          {loading ? <p className="flex items-center gap-2" role="status"><LoaderCircle size={16} className="animate-spin" />Loading apps…</p> : <div className="integration-grid">{apps.map(app => <Card className="integration-card" key={app.id}><CardContent>
            <div className="card-top"><span className="integration-icon"><Braces size={19} /></span><Badge variant={app.credentialActive ? 'secondary' : 'outline'}>{app.credentialActive ? 'Credential active' : 'No credential'}</Badge></div>
            <h2>{app.name}</h2><p>{app.description}</p><code className="break-all text-xs">{app.id}</code>
            <div className="card-scopes">{app.capabilities.length ? app.capabilities.map(capability => <span key={capability}>{capabilityLabels[capability]}</span>) : <span>No capabilities requested</span>}</div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!!busy} aria-label={`Edit ${app.name}`} onClick={() => edit(app)}>Edit</Button><Button variant="outline" disabled={!!busy} aria-label={`Manage credentials for ${app.name}`} onClick={() => { setToken(''); setRevealed(false); setCredentialError(''); setCredentialApp(app); }}><KeyRound size={14} />Credentials</Button></div>
          </CardContent></Card>)}{!apps.length && <Card><CardContent className="py-8"><p>No apps yet. Create your first integration.</p></CardContent></Card>}</div>}
        </> : <>
          <div className="page-heading"><div><h1>API setup</h1><p>Use your app credential from your backend.</p></div></div>
          <Card className="api-card"><CardContent><h2>Connect your app</h2><ol className="my-4 list-decimal space-y-2 pl-5 text-sm"><li>Create an app and issue a credential.</li><li>Store the credential in your server environment.</li><li>The patient connects your app from Apps and selects records.</li><li>Request only the records and file versions they allow.</li></ol><pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs">{`CAREVAULT_URL=http://127.0.0.1:3040\nCAREVAULT_TOKEN=<your-app-credential>`}</pre><p className="helper mt-3">Credentials identify your app. Patient permissions determine its access.</p></CardContent></Card>
          <Card className="api-card"><CardContent><h2>Read selected records</h2><pre className="mt-4 overflow-x-auto rounded-md bg-muted p-4 text-xs">{`const response = await fetch(
  process.env.CAREVAULT_URL + "/api/v2/records",
  { headers: { Authorization: "Bearer " + process.env.CAREVAULT_TOKEN } }
);
if (!response.ok) throw new Error("CareVault request denied or failed");
const result = await response.json();`}</pre><p className="helper mt-3">Only currently authorized records are returned. Keep credentials out of frontend code and model prompts.</p><pre className="mt-4 overflow-x-auto rounded-md bg-muted p-4 text-xs">{`GET /api/v2/records/:id/text
GET /api/v2/records/:id/files/redacted
GET /api/v2/records/:id/files/original`}</pre><p className="helper mt-3">Each version requires its own permission. Fetch fresh context for every operation.</p></CardContent></Card>
          <Card className="api-card"><CardContent><h2>Write a report</h2><pre className="mt-4 overflow-x-auto rounded-md bg-muted p-4 text-xs">{`POST /api/v2/reports
Authorization: Bearer <your-app-credential>
Content-Type: application/json

{
  "title": "Chest X-ray review",
  "body": "Your integration-generated report",
  "sourceReceiptIds": ["<X-CareVault-Receipt from a read>"]
}`}</pre><p className="helper mt-3">Requires report-writing permission. New reports remain unshared until the patient selects them.</p></CardContent></Card>
        </>}
      </main>
    </div>
    {editing && <Dialog open onOpenChange={open => { if (!open && !busy) setEditing(null); }}><DialogContent className="permission-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{editing === 'new' ? 'New app' : 'Edit app'}</DialogTitle><DialogDescription>Patients will see this app in their directory.</DialogDescription></DialogHeader>
      <form onSubmit={save} className="space-y-4">
        <div><label htmlFor="app-name" className="mb-2 block text-sm">App name</label><Input id="app-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} maxLength={80} required disabled={!!busy} /></div>
        <div><label htmlFor="app-description" className="mb-2 block text-sm">Description</label><Textarea id="app-description" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} maxLength={400} required disabled={!!busy} /></div>
        <div><label htmlFor="app-url" className="mb-2 block text-sm">App URL</label><Input id="app-url" type="url" placeholder="http://127.0.0.1:3050" value={form.appUrl} onChange={event => setForm({ ...form, appUrl: event.target.value })} maxLength={2048} required disabled={!!busy} /></div>
        <fieldset disabled={!!busy}><legend className="mb-2 text-sm">Requested capabilities</legend><div className="space-y-2">{(Object.keys(capabilityLabels) as Capability[]).map(capability => <label key={capability} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.capabilities.includes(capability)} onChange={event => setForm({ ...form, capabilities: event.target.checked ? [...form.capabilities, capability] : form.capabilities.filter(value => value !== capability) })} />{capabilityLabels[capability]}</label>)}</div></fieldset>
        {formError && <p className="alert error" role="alert">{formError}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={!!busy} onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save app'}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>}
    {credentialApp && <Dialog open onOpenChange={open => { if (!open && !busy) closeCredentials(); }}><DialogContent onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{credentialApp.name} credential</DialogTitle><DialogDescription>{token ? 'Save this credential now. It is shown only once.' : credentialApp.credentialActive ? 'Rotation replaces the current credential immediately.' : 'Issue a credential to authenticate your app.'}</DialogDescription></DialogHeader>
      {token && <div><label htmlFor="app-credential" className="mb-2 block text-sm">New credential</label><div className="flex gap-2"><Input id="app-credential" type={revealed ? 'text' : 'password'} value={token} readOnly autoComplete="off" spellCheck={false} onFocus={event => event.target.select()} /><Button variant="outline" size="icon" aria-label={revealed ? 'Hide credential' : 'Reveal credential'} onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={16} /> : <Eye size={16} />}</Button></div></div>}
      {credentialError && <p className="alert error" role="alert">{credentialError}</p>}
      <DialogFooter>{!token && credentialApp.credentialActive && <Button variant="destructive" disabled={!!busy} onClick={() => credentialAction('revoke')}>{busy === 'revoke' ? 'Revoking…' : 'Revoke'}</Button>}{!token && <Button disabled={!!busy} onClick={() => credentialAction('issue')}>{busy === 'issue' ? 'Issuing…' : credentialApp.credentialActive ? 'Rotate credential' : 'Issue credential'}</Button>}<Button variant="outline" disabled={!!busy} onClick={closeCredentials}>{token ? 'Done' : 'Close'}</Button></DialogFooter>
    </DialogContent></Dialog>}
  </div>;
}
