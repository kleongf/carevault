'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity as ActivityIcon, ArrowDownToLine, ArrowRight, Check, ChevronDown, Code2, Database, FileText, FlaskConical, Heart, Layers, LockKeyhole, LogOut, Pill, Plug, ScanLine, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { categories, categoryLabels, type Category, type ContextResponse, type Dashboard, type Disclosure, type Grant, type Integration, type MemoryItem, type Scope } from '../lib/types';

const scopeLabels: Record<Scope, string> = { 'facts:read': 'Read authorized memory', 'files:download': 'Download redacted files', 'reports:create': 'Create attributed reports' };
const modes: Disclosure[] = ['share', 'redact', 'private'];
type View = 'integrations' | 'memory' | 'activity';

class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(data?.message || data?.error || `Request failed (${response.status}).`, response.status);
  return data as T;
}

function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
function time(value: string) { return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function readable(value: string) { return value.replaceAll('_', ' ').replaceAll('-', ' '); }
function IntegrationIcon({ kind }: { kind: Integration['icon'] }) {
  const Icon = kind === 'scan' ? ScanLine : kind === 'flask' ? FlaskConical : Pill;
  return <Icon size={23} strokeWidth={1.65} />;
}
function Badge({ children, tone = '' }: { children: React.ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
function DisclosureControl({ value, onChange, label, disabled = false, minimum = 'share' }: { value: Disclosure; onChange: (value: Disclosure) => void; label: string; disabled?: boolean; minimum?: Disclosure }) {
  return <div className="disclosure-control" role="group" aria-label={label}>{modes.map(mode => <button type="button" key={mode} disabled={disabled || modes.indexOf(mode) < modes.indexOf(minimum)} className={value === mode ? `selected ${mode}` : ''} aria-pressed={value === mode} onClick={() => onChange(mode)}>{mode === 'private' && <LockKeyhole size={11} />}{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div>;
}

function ContextPreview({ response }: { response: ContextResponse }) {
  return <div className="context-preview">
    <div className="preview-meta"><span>{response.items.length} returned items</span><span>Policy v{response.policyVersion}</span></div>
    {response.items.length === 0 ? <p className="empty-small">No memory is available under these permissions.</p> : response.items.map(item => <div key={item.id} className={`released-item ${item.disclosure}`}><div><strong>{item.field}</strong><Badge tone={item.disclosure === 'redacted' ? 'amber' : 'green'}>{item.disclosure}</Badge></div><p>{item.value}</p>{item.verification && <small>{readable(item.verification)}</small>}</div>)}
  </div>;
}

export default function Home() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [view, setView] = useState<View>('integrations');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [memoryFilter, setMemoryFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [inspectorId, setInspectorId] = useState('');
  const [inspection, setInspection] = useState<{ integrationId: string; response: ContextResponse } | null>(null);
  const [inspectError, setInspectError] = useState('');
  const [writeResult, setWriteResult] = useState('');

  async function refresh() {
    try { const data = await request<Dashboard>('/api/owner/dashboard'); setDashboard(data); return data; }
    catch (err) { if (err instanceof RequestError && err.status === 401) { setDashboard(null); return null; } throw err; }
  }
  useEffect(() => { refresh().catch(err => setError(message(err))).finally(() => setInitializing(false)); }, []);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy('login'); setError('');
    try { await request('/api/session', 'POST', { code }); setCode(''); await refresh(); }
    catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function mutate(key: string, path: string, method: string, body: unknown, success: string) {
    setBusy(key); setError(''); setNotice('');
    try { await request(path, method, body); await refresh(); setInspection(null); setNotice(success); }
    catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function inspect(operation: 'read' | 'write') {
    setBusy('inspect'); setInspectError(''); setWriteResult('');
    if (operation === 'read') setInspection(null);
    try {
      const result = await request<ContextResponse & { reportId?: string; verification?: string }>('/api/owner/inspect', 'POST', { integrationId: inspectorId, operation, contextRequestId: operation === 'write' && inspection?.integrationId === inspectorId ? inspection.response.requestId : undefined });
      if (operation === 'read') setInspection({ integrationId: inspectorId, response: result });
      else setWriteResult(`Report ${result.reportId} saved. ${readable(result.verification || 'integration authored')}. Memory processing uses a prepared example.`);
      await refresh();
    } catch (err) { setInspectError(message(err)); await refresh().catch(() => {}); }
    finally { setBusy(''); }
  }

  if (initializing) return <main className="login-page"><div className="loading"><ShieldCheck size={34} /><p>Opening your vault…</p></div></main>;
  if (!dashboard) return <main className="login-page"><div className="login-card"><div className="brand-mark"><ShieldCheck size={25} /></div><Badge tone="green">Synthetic demonstration</Badge><h1>Your health.<br />Your permissions.</h1><p>One place to manage the information your healthcare apps can read and write.</p><form onSubmit={login}><label htmlFor="access-code">Owner access code</label><input id="access-code" type="password" autoComplete="current-password" value={code} onChange={event => setCode(event.target.value)} required autoFocus placeholder="Enter your local access code" />{error && <p className="alert error" role="alert">{error}</p>}<button className="button primary" disabled={!!busy}>{busy ? 'Opening…' : 'Open my vault'}<ArrowRight size={16} /></button></form><p className="setup-note">First time? Run <code>npm run setup</code> in the project terminal to configure access.</p><div className="login-footer"><LockKeyhole size={14} /> Synthetic records · No clinical decisions</div></div></main>;

  const connectedCount = dashboard.integrations.filter(item => item.grant.connected).length;
  const protectedCount = dashboard.memories.filter(item => item.restriction !== 'share').length;
  const selectedIntegration = dashboard.integrations.find(item => item.id === editing);
  const inspectorIntegration = dashboard.integrations.find(item => item.id === inspectorId);
  const filteredMemory = dashboard.memories.filter(item => (categoryFilter === 'all' || item.category === categoryFilter) && `${item.label} ${item.value}`.toLowerCase().includes(memoryFilter.toLowerCase()));

  return <div className="app-shell">
    <aside className="sidebar"><a href="#" className="brand" onClick={event => { event.preventDefault(); setView('integrations'); }}><span className="brand-mark"><ShieldCheck size={22} /></span>CareVault<span className="brand-dot">·</span></a><div className="workspace-label">PERSONAL WORKSPACE</div><nav aria-label="Main navigation">{([{ id: 'integrations', label: 'Integrations', icon: Plug }, { id: 'memory', label: 'My memory', icon: Database }, { id: 'activity', label: 'Activity', icon: ActivityIcon }] as const).map(item => <button key={item.id} onClick={() => setView(item.id)} className={view === item.id ? 'nav-link active' : 'nav-link'} aria-current={view === item.id ? 'page' : undefined}><item.icon size={18} />{item.label}{item.id === 'integrations' && <span className="nav-count">{dashboard.integrations.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="vault-note"><ShieldCheck size={20} /><strong>Control at the source</strong><p>Your permissions are checked before information leaves your vault.</p></div><div className="patient"><span className="avatar">{dashboard.patient.initials}</span><div><strong>{dashboard.patient.name}</strong><span>Personal vault</span></div><button aria-label="Sign out" className="icon-button" disabled={!!busy} onClick={async () => { setBusy('logout'); try { await request('/api/session', 'DELETE'); setDashboard(null); setInspection(null); } catch (err) { setError(message(err)); } finally { setBusy(''); } }}><LogOut size={16} /></button></div></div></aside>
    <div className="workspace"><header className="topbar"><span>My workspace <span className="breadcrumb-slash">/</span> <strong>{view === 'integrations' ? 'Integrations' : view === 'memory' ? 'My memory' : 'Activity'}</strong></span><Badge tone="green"><span className="status-dot" />Synthetic demo</Badge></header>
      <main className="main-content">
        {error && <div className="alert error" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        {notice && <div className="alert success" role="status"><Check size={16} />{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {view === 'integrations' && <>
          <div className="page-heading"><div><div className="eyebrow">YOUR HEALTHCARE, CONNECTED</div><h1>Your integration hub</h1><p>Useful apps. Only the information you choose to share.</p></div><span className="outline-label"><LockKeyhole size={14} />Private by default</span></div>
          <div className="stats-grid"><div className="stat"><span className="stat-icon"><Plug size={19} /></span><div><strong>{connectedCount}<small> / {dashboard.integrations.length}</small></strong><span>Connected integrations</span></div></div><div className="stat"><span className="stat-icon"><Layers size={19} /></span><div><strong>{dashboard.memories.length}</strong><span>Items in your memory</span></div></div><div className="stat"><span className="stat-icon"><LockKeyhole size={19} /></span><div><strong>{protectedCount}</strong><span>Items with direct restrictions</span></div></div></div>
          <div className="section-heading"><h2>Your applications</h2><span>Three tracks. One permission layer.</span></div>
          <div className="integration-grid">{dashboard.integrations.map(integration => <article className="integration-card" key={integration.id}><div className="card-top"><div className={`integration-icon ${integration.icon}`}><IntegrationIcon kind={integration.icon} /></div><Badge tone={integration.grant.connected ? 'green' : ''}>{integration.grant.connected ? 'Connected' : 'Not connected'}</Badge></div><div className="track-label">{integration.track}</div><h3>{integration.name}</h3><p className="card-description">{integration.description}</p><div className="publisher">{integration.publisher} <span>· Integration slot</span></div><div className="card-permissions">{integration.grant.connected ? <>{integration.grant.scopes.length ? integration.grant.scopes.map(scope => <span key={scope}><Check size={13} />{scopeLabels[scope]}</span>) : <span><LockKeyhole size={13} />No operations permitted</span>}</> : <span><LockKeyhole size={13} />No access to your memory</span>}</div><button className={`button full ${integration.grant.connected ? 'secondary' : 'primary'}`} onClick={() => setEditing(integration.id)}><SlidersHorizontal size={15} />{integration.grant.connected ? 'Manage access' : 'Connect integration'}<ArrowRight size={15} /></button></article>)}</div>
          <div className="info-strip"><ShieldCheck size={21} /><div><strong>You choose what each app receives.</strong><p>Share a value, show a redacted placeholder, or keep an item private. Protecting a source also restricts known derived content.</p></div></div>
          <section className="inspector panel"><div className="section-heading"><div><div className="eyebrow">OWNER SANDBOX</div><h2><Code2 size={19} />Request inspector</h2></div><Badge>Live permission checks</Badge></div><p className="muted">Exercise the shared gateway with prepared requests. These are integration slots, not medical applications.</p><div className="inspector-toolbar"><label className="select-wrap"><span className="sr-only">Integration to inspect</span><select value={inspectorId} onChange={event => { setInspectorId(event.target.value); setInspection(null); setInspectError(''); setWriteResult(''); }}><option value="">Choose an integration</option>{dashboard.integrations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></label><button className="button secondary" disabled={!inspectorId || !!busy} onClick={() => inspect('read')}><Search size={15} />Run read request</button><button className="button secondary" disabled={!inspectorId || !!busy || inspection?.integrationId !== inspectorId || !inspection?.response.requestId} onClick={() => inspect('write')}><FileText size={15} />Save fixture report</button></div>{inspectorIntegration && <p className="helper">{inspectorIntegration.grant.connected ? `Connected · policy v${inspectorIntegration.grant.version}. ` : 'Disconnected: requests should be denied. '}Report text is prepared; persistence and permission checks are live. {inspection?.response.requestId ? 'The report will reference the last successful read.' : 'Run a read request before saving the prepared report.'}</p>}{inspectError && <div className="alert error" role="alert"><LockKeyhole size={16} />{inspectError}</div>}{writeResult && <div className="alert success" role="status"><Check size={16} />{writeResult}</div>}{inspection && <div className="inspection-result"><div className="section-heading"><h3>Actual gateway response</h3><span>{inspection.response.requestId}</span></div><ContextPreview response={inspection.response} /><details className="json-details"><summary>Inspect response JSON</summary><pre>{JSON.stringify(inspection.response, null, 2)}</pre></details></div>}</section>
        </>}
        {view === 'memory' && <>
          <div className="page-heading"><div><div className="eyebrow">YOUR PERSONAL CONTEXT</div><h1>My memory</h1><p>See what is remembered, where it came from, and how it is protected.</p></div><Badge>{dashboard.memories.length} items</Badge></div>
          <section className="source-section"><div className="section-heading"><h2>Source library</h2><span>Prepared extraction examples</span></div><div className="source-grid">{dashboard.sources.map(source => <div className="source-card" key={source.id}><FileText size={20} /><strong>{source.title}</strong><span>{readable(source.type)}</span><Badge>Prepared extraction</Badge>{source.rendition && <small><ArrowDownToLine size={12} />Redacted rendition available through the gateway</small>}</div>)}</div></section>
          <div className="memory-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Search memory" placeholder="Search your memory…" value={memoryFilter} onChange={event => setMemoryFilter(event.target.value)} /></label><label className="select-wrap"><span className="sr-only">Filter by category</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map(category => <option value={category} key={category}>{categoryLabels[category]}</option>)}</select><ChevronDown size={15} /></label></div>
          <div className="memory-list">{filteredMemory.map(item => <MemoryCard key={item.id} item={item} dashboard={dashboard} disabled={!!busy} onRestrict={restriction => mutate(`memory-${item.id}`, `/api/owner/memory/${encodeURIComponent(item.id)}`, 'PUT', { restriction }, 'Memory restriction saved. Future requests use the updated policy.')} />)}{filteredMemory.length === 0 && <div className="empty-state"><Search size={24} /><h3>No matching memory</h3><p>Try another category or search term.</p></div>}</div>
        </>}
        {view === 'activity' && <>
          <div className="page-heading"><div><div className="eyebrow">A RECORD OF ACCESS</div><h1>Your vault activity</h1><p>See which applications requested information and what your vault released.</p></div><Badge>{dashboard.activity.length} events</Badge></div><div className="info-strip"><LockKeyhole size={20} /><div><strong>Revocation stops future access.</strong><p>Earlier disclosures stay in this history. CareVault cannot erase copies already received by an external app.</p></div></div><div className="activity-list panel">{dashboard.activity.length === 0 ? <div className="empty-state"><ActivityIcon size={26} /><h3>Your activity starts here</h3><p>Connect an app or run a request to see its access history.</p></div> : dashboard.activity.map(event => <article className="activity-item" key={event.id}><div className={`event-icon ${event.outcome.includes('denied') ? 'denied' : ''}`}>{event.outcome.includes('denied') ? <LockKeyhole size={17} /> : event.operation.includes('write') || event.operation.includes('report') ? <FileText size={17} /> : <ActivityIcon size={17} />}</div><div className="activity-body"><div className="activity-title"><strong>{event.actor}</strong><Badge tone={event.outcome.includes('denied') ? 'amber' : ''}>{readable(event.outcome)}</Badge></div><p>{event.detail}</p><div className="activity-meta"><span>{readable(event.operation)}</span><span>{time(event.at)}</span>{event.policyVersion !== undefined && <span>Policy v{event.policyVersion}</span>}</div>{event.itemIds.length > 0 && <details><summary>Record references ({event.itemIds.length})</summary><p className="record-refs">{event.itemIds.join(' · ')}</p></details>}</div></article>)}</div>
        </>}
        <footer className="workspace-footer"><Heart size={13} /> Built around your choices.<span>Synthetic data · Prepared extraction · No compliance certification</span></footer>
      </main>
    </div>
    {selectedIntegration && <PermissionDialog integration={selectedIntegration} memories={dashboard.memories} onClose={() => setEditing(null)} onSaved={async text => { await refresh(); setInspection(null); setNotice(text); setEditing(null); }} />}
  </div>;
}

function MemoryCard({ item, dashboard, disabled, onRestrict }: { item: MemoryItem; dashboard: Dashboard; disabled: boolean; onRestrict: (mode: Disclosure) => void }) {
  const dependents = dashboard.memories.filter(candidate => candidate.parentIds.includes(item.id));
  const parents = dashboard.memories.filter(candidate => item.parentIds.includes(candidate.id));
  return <article className="memory-card"><div className="memory-main"><div className="memory-heading"><span className="item-kind">{categoryLabels[item.category]}</span><Badge tone={item.restriction === 'private' ? 'amber' : ''}>{item.restriction === 'share' ? 'App permissions apply' : `Keep ${item.restriction === 'redact' ? 'redacted' : 'private'}`}</Badge></div><h3>{item.label}</h3><p className="memory-value">{item.value}</p><div className="memory-meta"><span>{item.author}</span><span>{readable(item.verification)}</span><span>v{item.version}</span></div><details className="memory-details"><summary>Sources & relationships</summary><dl><div><dt>Sources</dt><dd>{item.sourceIds.map(id => dashboard.sources.find(source => source.id === id)?.title || id).join(', ') || 'No source recorded'}</dd></div><div><dt>Derived from</dt><dd>{parents.map(parent => parent.label).join(', ') || 'Original memory item'}</dd></div><div><dt>Known dependents</dt><dd>{dependents.map(child => child.label).join(', ') || 'None'}</dd></div><div><dt>Recorded</dt><dd>{time(item.createdAt)}</dd></div></dl>{parents.some(parent => parent.restriction !== 'share') && <p className="helper">A protected source can restrict this item further. Integration access follows the most restrictive applicable rule.</p>}{item.pendingReview && <p className="helper">Private pending review. Changing a privacy preference does not verify clinical content.</p>}</details></div><div className="memory-controls"><span className="control-label">Vault-wide preference</span><DisclosureControl label={`Privacy for ${item.label}`} value={item.restriction} onChange={onRestrict} disabled={disabled} /><p>Share follows each app’s permissions. More restrictive source rules still apply.</p></div></article>;
}

function PermissionDialog({ integration, memories, onClose, onSaved }: { integration: Integration; memories: MemoryItem[]; onClose: () => void; onSaved: (notice: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [grant, setGrant] = useState<Grant>(() => structuredClone(integration.grant));
  const [preview, setPreview] = useState<ContextResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  function changeCategory(category: Category, mode: Disclosure) { setGrant(current => ({ ...current, categories: { ...current.categories, [category]: mode } })); setPreview(null); }
  async function save() {
    setBusy('save'); setError('');
    try { await request(`/api/owner/connections/${encodeURIComponent(integration.id)}`, 'PUT', { ...grant, connected: true }); await onSaved('Permissions saved. This integration uses your grant until you change or revoke it.'); }
    catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function revoke() {
    setBusy('revoke'); setError('');
    try { await request(`/api/owner/connections/${encodeURIComponent(integration.id)}/revoke`, 'POST', {}); await onSaved('Access revoked. Earlier disclosures remain in your activity history.'); }
    catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function loadPreview() {
    setBusy('preview'); setError(''); setPreview(null);
    try { setPreview(await request<ContextResponse>('/api/owner/preview', 'POST', { integrationId: integration.id, grant: { ...grant, connected: true } })); }
    catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  return <dialog ref={dialog} className="permission-dialog" aria-labelledby="permission-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><div className="dialog-heading"><div className="integration-icon"><IntegrationIcon kind={integration.icon} /></div><div><div className="eyebrow">CONNECTION PERMISSIONS</div><h2 id="permission-title">{integration.name}</h2></div><button className="icon-button close-dialog" aria-label="Close permissions" onClick={onClose} disabled={!!busy}><X size={21} /></button></div><div className="dialog-body"><p className="muted">{integration.description} Access continues until you change or revoke it.</p><section><h3>What this app can do</h3><div className="scope-list">{(Object.keys(scopeLabels) as Scope[]).map(scope => <label key={scope}><input type="checkbox" checked={grant.scopes.includes(scope)} disabled={!!busy} onChange={event => { const checked = event.target.checked; setGrant(current => ({ ...current, scopes: checked ? [...current.scopes, scope] : current.scopes.filter(value => value !== scope) })); setPreview(null); }} /><span>{scopeLabels[scope]}<small>{scope === 'facts:read' ? 'Only information allowed by the rules below.' : scope === 'files:download' ? 'Authorized redacted renditions; no automatic access to originals.' : 'Append reports with authorship and sources. Cannot overwrite clinical facts.'}</small></span></label>)}</div></section><section><h3>Choose what to disclose</h3><p className="helper">Share returns a value. Redact may reveal that a field exists. Private omits the information. More restrictive rules always win.</p><div className="category-list">{categories.map(category => <div className="category-row" key={category}><label>{categoryLabels[category]}</label><DisclosureControl label={`${categoryLabels[category]} access`} value={grant.categories[category]} onChange={mode => changeCategory(category, mode)} disabled={!!busy} /></div>)}</div></section><section><details className="override-section"><summary>Individual restrictions <span>{Object.keys(grant.overrides).length} rules</span></summary><p className="helper">Individual rules can narrow category permissions. Vault-wide and inherited protection still applies.</p>{memories.map(item => { const effectiveMinimum = modes[Math.max(modes.indexOf(grant.categories[item.category]), modes.indexOf(item.restriction))]; const stored = grant.overrides[item.id] || 'share'; const selected = modes[Math.max(modes.indexOf(stored), modes.indexOf(effectiveMinimum))]; return <div className="override-row" key={item.id}><div><strong>{item.label}</strong><small>{categoryLabels[item.category]}</small></div><DisclosureControl label={`App-specific restriction for ${item.label}`} value={selected} minimum={effectiveMinimum} disabled={!!busy} onChange={mode => { setGrant(current => ({ ...current, overrides: { ...current.overrides, [item.id]: mode } })); setPreview(null); }} /></div>; })}</details></section><section className="permission-preview"><div className="section-heading"><h3><Search size={16} />What this app will receive</h3><button className="button secondary small" disabled={!!busy} onClick={loadPreview}>{busy === 'preview' ? 'Checking…' : 'Preview access'}</button></div><p className="helper">An unsaved preview uses the same server permission evaluator as a real read. Changes apply after saving.</p>{preview && <ContextPreview response={preview} />}</section>{error && <div className="alert error" role="alert">{error}</div>}<div className="boundary-note"><ShieldCheck size={16} /><p>CareVault controls what leaves this vault. It cannot recall readable copies already received by another app.</p></div></div><div className="dialog-actions">{integration.grant.connected && <button className="button danger" disabled={!!busy} onClick={revoke}>{busy === 'revoke' ? 'Revoking…' : 'Revoke access'}</button>}<div><button className="button secondary" onClick={onClose} disabled={!!busy}>Cancel</button><button className="button primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : integration.grant.connected ? 'Save permissions' : 'Connect & save'}<Check size={15} /></button></div></div></dialog>;
}
