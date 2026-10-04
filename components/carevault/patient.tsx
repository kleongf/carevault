'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, FileText, Image as ImageIcon, LoaderCircle, LogOut, Plug, Search, ShieldCheck } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { errorMessage, request, time } from './shared';
import { PdfPreview } from './pdf-preview';

interface RecordItem {
  id: string; title: string; mime: string; kind: 'document' | 'image' | 'report'; status: 'queued' | 'processing' | 'ready' | 'failed';
  createdAt: string; profile: string; author?: string; provenance?: string; processing?: { textCharacters?: number };
}
interface Access { text: boolean; redacted: boolean; original: boolean; }
interface Grant { connected: boolean; version: number; allowReports: boolean; records: Record<string, Access>; }
interface App { id: string; name: string; description: string; appUrl?: string; capabilities?: string[]; recordGrant: Grant; legacyConnected: boolean; }
interface Dashboard { records: RecordItem[]; apps: App[]; activity: {id:string;actor:string;detail:string;at:string;outcome:string}[]; }
const noAccess = (): Access => ({ text: false, redacted: false, original: false });
const names = { records: 'Records', apps: 'Apps', activity: 'Activity' } as const;
const icons = { records: FileText, apps: Plug, activity: Activity };
const capabilityFor = { text: 'text:read', redacted: 'files:redacted', original: 'files:original' };

export function PatientWorkspace({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [view, setView] = useState<keyof typeof names>('records');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [editing, setEditing] = useState<App | null>(null);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [profile, setProfile] = useState('identifiers');
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => setDashboard(await request<Dashboard>('/api/patient/dashboard')), []);
  useEffect(() => { refresh().catch(err => setError(errorMessage(err))); }, [refresh]);
  const processing = dashboard?.records.some(record => record.status === 'queued' || record.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => refresh().catch(err => setError(errorMessage(err))), 3000);
    return () => clearInterval(timer);
  }, [processing, refresh]);
  async function upload(event: FormEvent) {
    event.preventDefault(); const file = fileRef.current?.files?.[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError('Choose a file smaller than 20 MB.'); return; }
    setUploading(true); setError('');
    try {
      const response = await fetch('/api/patient/records', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name), 'X-Redaction-Profile': profile }, body: file });
      const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Upload failed.');
      setUploadOpen(false); await refresh();
    } catch (err) { setError(errorMessage(err)); } finally { setUploading(false); }
  }
  function manage(app: App) { setEditing(app); setGrant(structuredClone(app.recordGrant)); setError(''); }
  async function saveConnection() {
    if (!editing || !grant) return;
    setBusy('connection'); setError('');
    try { await request(`/api/patient/apps/${editing.id}`, 'PUT', { ...grant, connected: true }); setEditing(null); await refresh(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  async function disconnect() {
    if (!editing) return;
    setBusy('connection'); setError('');
    try { await request(`/api/patient/apps/${editing.id}/revoke`, 'POST', {}); setEditing(null); await refresh(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  const records = dashboard?.records.filter(record => record.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  const activeRecord = selected && (dashboard?.records.find(record => record.id === selected.id) ?? selected);
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><ShieldCheck size={21} /></span>CareVault</div>
      <nav aria-label="Patient navigation">{(Object.keys(names) as (keyof typeof names)[]).map(key => { const Icon = icons[key]; return <button key={key} className={`nav-link ${view === key ? 'active' : ''}`} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}><Icon size={18} />{names[key]}</button>; })}</nav>
      <div className="sidebar-bottom"><div className="patient"><span className="avatar">AM</span><div><strong>Alex Morgan</strong><span>Patient</span></div></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><span>{names[view]}</span><div className="flex items-center gap-3"><Badge variant="outline">Demo</Badge><Button variant="ghost" size="sm" disabled={!!busy} onClick={async () => { setBusy('logout'); try { await onSignOut(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); } }}><LogOut size={15} />Sign out</Button></div></header>
      <main className="main-content">
        {error && <div role="alert" className="alert error">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {!dashboard && !error && <p className="flex items-center gap-2"><LoaderCircle size={18} className="animate-spin" />Loading…</p>}
        {view === 'records' && <>
          <div className="page-heading"><div><h1>Your records</h1><p>Documents, images, and reports in one place.</p></div><Button onClick={() => { setError(''); setUploadOpen(true); }}><ArrowUpFromLine size={17} />Upload</Button></div>
          <div className="memory-toolbar"><div className="search-field"><Search size={17} /><Input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search records" placeholder="Search records" /></div></div>
          <div className="record-list">{records.map(record => <button key={record.id} className="record-row" onClick={() => setSelected(record)}><span className="record-icon">{record.kind === 'image' ? <ImageIcon size={22} /> : <FileText size={22} />}</span><span className="min-w-0 flex-1"><strong>{record.title}</strong><small>{record.kind === 'report' ? 'Integration-generated' : record.mime === 'application/pdf' ? 'PDF document' : 'Image'} · {time(record.createdAt)}</small></span><Badge variant={record.status === 'failed' ? 'destructive' : 'secondary'}>{record.status === 'queued' ? 'Waiting' : record.status === 'processing' ? 'Processing' : record.status === 'ready' ? 'Ready' : 'Failed'}</Badge></button>)}</div>
          {dashboard && !records.length && <div className="empty-state"><FileText size={32} /><h2>{search ? 'No matching records' : 'Start with a document'}</h2><p>{search ? 'Try another search.' : 'Upload a PDF, scan, or image.'}</p></div>}
        </>}
        {view === 'apps' && <><div className="page-heading"><div><h1>Your apps</h1><p>Choose an app and the records it can access.</p></div></div><div className="integration-grid">{dashboard?.apps.map(app => <Card className="integration-card" key={app.id}><CardContent><div className="card-top"><span className="integration-icon"><Plug size={22} /></span><Badge variant={app.recordGrant.connected ? 'secondary' : 'outline'}>{app.legacyConnected ? 'Earlier memory access' : app.recordGrant.connected ? 'Connected' : 'Not connected'}</Badge></div><h2>{app.name}</h2><p>{app.description}</p><div className="flex flex-wrap gap-2 mt-5"><Button variant={app.recordGrant.connected ? 'outline' : 'default'} onClick={() => manage(app)}>{app.recordGrant.connected || app.legacyConnected ? 'Manage access' : 'Connect'}</Button>{app.recordGrant.connected && app.appUrl && <Button asChild variant="outline"><a href={app.appUrl} target="_blank" rel="noopener noreferrer">Open app ↗</a></Button>}</div></CardContent></Card>)}</div></>}
        {view === 'activity' && <><div className="page-heading"><div><h1>Activity</h1><p>Access and updates to your records.</p></div></div><Card><CardContent className="activity-list">{dashboard?.activity.map(event => <article key={event.id} className="activity-item"><span className="event-icon"><Activity size={17} /></span><div><div className="activity-title"><strong>{event.actor}</strong></div><p>{event.detail}</p><small>{time(event.at)}</small></div></article>)}{dashboard?.activity.length === 0 && <div className="empty-state">No activity yet.</div>}</CardContent></Card></>}
      </main>
    </div>
    {uploadOpen && <Dialog open onOpenChange={open => { if (!uploading) setUploadOpen(open); }}><DialogContent><DialogHeader><DialogTitle>Upload a record</DialogTitle><DialogDescription>PDF, PNG, or JPEG · up to 20 MB</DialogDescription></DialogHeader><form onSubmit={upload} className="space-y-5"><Input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" aria-label="Record file" required disabled={uploading} /><div><label htmlFor="redaction-profile" className="block mb-2 text-sm">Redaction preset</label><select id="redaction-profile" className="record-select" value={profile} onChange={event => setProfile(event.target.value)} disabled={uploading}><option value="identifiers">Identifiers</option><option value="healthcare">Healthcare identifiers</option></select></div>{error && <p role="alert" className="alert error">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={uploading} onClick={() => setUploadOpen(false)}>Cancel</Button><Button type="submit" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</Button></DialogFooter></form></DialogContent></Dialog>}
    {activeRecord && <RecordDialog record={activeRecord} onClose={() => setSelected(null)} />}
    {editing && grant && <Dialog open onOpenChange={open => { if (!open && !busy) setEditing(null); }}><DialogContent className="connection-dialog"><DialogHeader><DialogTitle>{editing.name}</DialogTitle><DialogDescription>Select the records and versions this app may read.</DialogDescription></DialogHeader>{editing.legacyConnected && <p className="helper">Earlier memory permissions are still active. Disconnect all access to remove them.</p>}<div className="connection-records">{dashboard?.records.map(record => <div className="connection-record" key={record.id}><strong>{record.title}</strong><div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">{(['text', 'redacted', 'original'] as const).map(key => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`${record.title}: ${key}`} disabled={!!busy || !(editing.capabilities ?? Object.values(capabilityFor)).includes(capabilityFor[key])} checked={grant.records[record.id]?.[key] ?? false} onChange={event => setGrant({ ...grant, records: { ...grant.records, [record.id]: { ...(grant.records[record.id] ?? noAccess()), [key]: event.target.checked } } })} />{key === 'text' ? 'Redacted text' : key === 'redacted' ? 'Redacted file' : 'Original file'}</label>)}</div></div>)}{dashboard?.records.length === 0 && <p className="helper">Upload a record to share it.</p>}</div><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!!busy || !(editing.capabilities ?? ['reports:create']).includes('reports:create')} checked={grant.allowReports} onChange={event => setGrant({ ...grant, allowReports: event.target.checked })} />Allow reports</label>{error && <p role="alert" className="alert error">{error}</p>}<DialogFooter>{(grant.connected || editing.legacyConnected) && <Button variant="destructive" disabled={!!busy} onClick={disconnect}>Disconnect all access</Button>}<Button variant="outline" disabled={!!busy} onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!!busy} onClick={saveConnection}>{busy ? 'Saving…' : 'Save access'}</Button></DialogFooter></DialogContent></Dialog>}
  </div>;
}

function RecordDialog({ record, onClose }: { record: RecordItem; onClose: () => void }) {
  const [tab, setTab] = useState('original');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const base = `/api/patient/records/${record.id}`;
  useEffect(() => {
    if (tab !== 'text' || record.status !== 'ready') return;
    const abort = new AbortController(); setLoading(true); setError('');
    fetch(`${base}/text`, { signal: abort.signal, cache: 'no-store' }).then(async response => { if (!response.ok) throw new Error('Extracted text is unavailable.'); return response.text(); }).then(setText).catch(err => { if (!abort.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [tab, base, record.status]);
  const ready = record.status === 'ready';
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="record-dialog"><DialogHeader><DialogTitle>{record.title}</DialogTitle><DialogDescription>{record.provenance ?? (record.kind === 'report' ? 'Integration-generated report' : 'Your uploaded record')}</DialogDescription></DialogHeader><Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="original">Original</TabsTrigger><TabsTrigger value="text">Extracted text</TabsTrigger><TabsTrigger value="redacted">Redacted copy</TabsTrigger></TabsList>{(['original', 'redacted'] as const).map(variant => <TabsContent value={variant} key={variant}>{variant === 'redacted' && !ready ? <ProcessingState status={record.status} /> : <>{variant === 'redacted' && record.processing?.textCharacters === 0 && <p className="helper mb-3">No text detected. Image metadata removed.</p>}<div className="record-preview">{record.mime.startsWith('image/') ? <img alt={`${variant === 'redacted' ? 'Redacted' : 'Original'} ${record.title}`} src={`${base}/files/${variant}`} /> : variant === 'redacted' || record.mime === 'application/pdf' ? <PdfPreview url={`${base}/files/${variant}`} /> : <iframe title={`${variant} document preview`} src={`${base}/files/${variant}`} />}</div><Button asChild variant="outline" className="mt-3"><a href={`${base}/files/${variant}?download=1`} download><ArrowDownToLine size={16} />Download {variant === 'redacted' ? 'redacted copy' : 'original'}</a></Button></>}</TabsContent>)}<TabsContent value="text">{!ready ? <ProcessingState status={record.status} /> : loading ? <p role="status">Loading text…</p> : error ? <p role="alert">{error}</p> : <pre className="extracted-text">{text || 'No text found.'}</pre>}</TabsContent></Tabs></DialogContent></Dialog>;
}
function ProcessingState({ status }: { status: RecordItem['status'] }) {
  return <div className="empty-state">{status === 'failed' ? <><h3>Processing failed</h3><p>The original is still available.</p></> : <><LoaderCircle size={22} className="animate-spin" /><h3>{status === 'queued' ? 'Waiting to process' : 'Processing record'}</h3><p>This view updates automatically.</p></>}</div>;
}
