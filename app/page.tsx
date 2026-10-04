'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Activity as ActivityIcon, ArrowRight, Braces, Check, ChevronDown, Database, FileText, LoaderCircle, LockKeyhole, LogOut, MessageCircle, Plug, Search, ShieldCheck, X } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Chat } from '../components/carevault/chat';
import { PermissionDialog } from '../components/carevault/permissions';
import { ContextPreview, DisclosureControl, errorMessage, IntegrationIcon, readable, request, RequestError, scopeLabels, time } from '../components/carevault/shared';
import { categories, categoryLabels, type ContextResponse, type Dashboard, type Disclosure, type MemoryItem } from '../lib/types';

type View = 'chat' | 'memory' | 'integrations' | 'developers';
const navigation = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'memory', label: 'My memory', icon: Database },
  { id: 'integrations', label: 'Connected apps', icon: Plug },
  { id: 'developers', label: 'Developers', icon: Braces },
] as const;

export default function Home() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [view, setView] = useState<View>('chat');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [chatVersion, setChatVersion] = useState(0);
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
  useEffect(() => { refresh().catch(err => setError(errorMessage(err))).finally(() => setInitializing(false)); }, []);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy('login'); setError('');
    try { await request('/api/session', 'POST', { code }); setCode(''); await refresh(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  async function updatePrivacy(item: MemoryItem, restriction: Disclosure) {
    setBusy(item.id); setError(''); setNotice('');
    try {
      await request(`/api/owner/memory/${encodeURIComponent(item.id)}`, 'PUT', { restriction });
      await refresh(); setInspection(null); setChatVersion(current => current + 1);
      setNotice('Privacy preference saved. Chat starts fresh with your updated permissions.');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  async function inspect(operation: 'read' | 'write') {
    setBusy('inspect'); setInspectError(''); setWriteResult('');
    if (operation === 'read') setInspection(null);
    try {
      const result = await request<ContextResponse & { reportId?: string; verification?: string }>('/api/owner/inspect', 'POST', {
        integrationId: inspectorId, operation,
        contextRequestId: operation === 'write' && inspection?.integrationId === inspectorId ? inspection.response.requestId : undefined,
      });
      if (operation === 'read') setInspection({ integrationId: inspectorId, response: result });
      else setWriteResult(`Report ${result.reportId} saved · ${readable(result.verification || 'integration authored')}. Extraction uses a prepared example.`);
      await refresh();
    } catch (err) { setInspectError(errorMessage(err)); await refresh().catch(() => {}); }
    finally { setBusy(''); }
  }

  if (initializing) return <main className="login-page"><LoaderCircle className="animate-spin" size={22} aria-label="Opening vault" /></main>;
  if (!dashboard) return <main className="login-page"><Card className="login-card"><CardContent>
    <div className="brand"><span className="brand-mark"><ShieldCheck size={20} /></span>CareVault</div>
    <h1>Your health memory.<br />Your choice.</h1><p>One place to manage what your healthcare apps can see and remember.</p>
    <form onSubmit={login}><label htmlFor="access-code">Owner access code</label><Input id="access-code" type="password" autoComplete="current-password" value={code} onChange={event => setCode(event.target.value)} required autoFocus placeholder="Enter your access code" />{error && <p className="alert error" role="alert">{error}</p>}<Button disabled={!!busy} className="full-width">{busy ? 'Opening…' : 'Open my vault'}<ArrowRight size={16} /></Button></form>
    <p className="helper">First time? Run <code>npm run setup</code> in the project terminal.</p><Badge variant="outline">Synthetic-data demo</Badge>
  </CardContent></Card></main>;

  const selectedIntegration = dashboard.integrations.find(item => item.id === editing);
  const inspectorIntegration = dashboard.integrations.find(item => item.id === inspectorId);
  const companion = dashboard.integrations.find(item => item.id === 'care-assistant');
  const filteredMemory = dashboard.memories.filter(item => (categoryFilter === 'all' || item.category === categoryFilter) && `${item.label} ${item.value}`.toLowerCase().includes(memoryFilter.toLowerCase()));

  return <div className="app-shell">
    <aside className="sidebar"><a href="#" className="brand" onClick={event => { event.preventDefault(); setView('chat'); }}><span className="brand-mark"><ShieldCheck size={20} /></span>CareVault</a>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} onClick={() => setView(item.id)} className={view === item.id ? 'nav-link active' : 'nav-link'} aria-current={view === item.id ? 'page' : undefined}><item.icon size={17} strokeWidth={1.7} />{item.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-hint"><LockKeyhole size={15} /><p>You control what leaves your vault.</p></div><div className="patient"><span className="avatar">{dashboard.patient.initials}</span><div><strong>{dashboard.patient.name}</strong><span>Synthetic patient</span></div><Button variant="ghost" size="icon" aria-label="Sign out" disabled={!!busy} onClick={async () => {
        setBusy('logout'); try { await request('/api/session', 'DELETE'); setDashboard(null); setInspection(null); setChatVersion(current => current + 1); } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
      }}><LogOut size={15} /></Button></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><span>{navigation.find(item => item.id === view)?.label}</span><Badge variant="outline">Synthetic demo</Badge></header>
      <main className={`main-content ${view === 'chat' ? 'chat-main' : ''}`}>
        {error && <div className="alert error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}
        {notice && <div className="alert success" role="status"><Check size={14} />{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></button></div>}
        <div hidden={view !== 'chat'}><Chat key={chatVersion} integration={companion} onPermissions={() => companion && setEditing(companion.id)} onActivity={refresh} /></div>
        {view === 'integrations' && <>
          <div className="page-heading"><div><h1>Connected apps</h1><p>Choose what each app can read, download, and write.</p></div><Badge variant="secondary">{dashboard.integrations.filter(item => item.grant.connected).length} connected</Badge></div>
          <div className="integration-grid">{dashboard.integrations.map(integration => <Card className="integration-card" key={integration.id}><CardContent>
            <div className="card-top"><span className="integration-icon"><IntegrationIcon integration={integration} /></span><Badge variant={integration.grant.connected ? 'secondary' : 'outline'}>{integration.grant.connected ? 'Connected' : 'Not connected'}</Badge></div>
            <h2>{integration.name}</h2><p>{integration.description}</p><span className="integration-kind">{integration.id === 'care-assistant' ? 'Live demo · OpenRouter' : integration.id === 'visit-prep' ? 'Working mock integration' : `${integration.track} · Integration slot`}</span>
            <div className="card-scopes">{integration.grant.connected ? integration.grant.scopes.length ? integration.grant.scopes.map(scope => <span key={scope}><Check size={12} />{scopeLabels[scope]}</span>) : <span>No actions permitted</span> : <span><LockKeyhole size={12} />No access to your memory</span>}</div>
            <Button variant={integration.grant.connected ? 'outline' : 'default'} onClick={() => setEditing(integration.id)} className="full-width">{integration.grant.connected ? 'Manage access' : 'Connect app'}<ArrowRight size={14} /></Button>
          </CardContent></Card>)}</div>
          <p className="privacy-note"><ShieldCheck size={15} />Permissions apply on every request. Revoking access stops future sharing; it cannot recall earlier copies.</p>
        </>}
        {view === 'memory' && <>
          <div className="page-heading"><div><h1>My memory</h1><p>Your information, its sources, and your privacy preferences.</p></div><Badge variant="secondary">{dashboard.memories.length} items</Badge></div>
          <Tabs defaultValue="memory"><TabsList><TabsTrigger value="memory">Memory</TabsTrigger><TabsTrigger value="sources">Sources</TabsTrigger></TabsList>
            <TabsContent value="memory"><div className="memory-toolbar"><div className="search-field"><Search size={16} /><Input aria-label="Search memory" placeholder="Search memory…" value={memoryFilter} onChange={event => setMemoryFilter(event.target.value)} /></div><label className="select-wrap"><span className="sr-only">Filter by category</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map(category => <option value={category} key={category}>{categoryLabels[category]}</option>)}</select><ChevronDown size={14} /></label></div>
              <div className="memory-list">{filteredMemory.map(item => <MemoryCard key={item.id} item={item} dashboard={dashboard} disabled={!!busy} onRestrict={restriction => updatePrivacy(item, restriction)} />)}{filteredMemory.length === 0 && <div className="empty-state"><Search size={23} /><h3>No matching memory</h3><p>Try another category or search term.</p></div>}</div>
            </TabsContent>
            <TabsContent value="sources"><p className="helper source-intro">These documents and their extracted information are prepared examples. Arbitrary document processing is not part of this demo.</p><div className="source-grid">{dashboard.sources.map(source => <Card key={source.id}><CardContent className="source-card"><FileText size={20} /><h3>{source.title}</h3><p>{readable(source.type)}</p><Badge variant="outline">Prepared extraction</Badge>{source.rendition && <small>Redacted rendition available through the gateway.</small>}</CardContent></Card>)}</div></TabsContent>
          </Tabs>
        </>}
        {view === 'developers' && <>
          <div className="page-heading"><div><h1>Developer workspace</h1><p>Connect an app to the same patient-controlled memory gateway.</p></div><Badge variant="outline">Owner sandbox</Badge></div>
          <a className="visit-prep-link" href="/visit-prep"><span><strong>Try the Visit Prep AI integration</strong><small>A mock third-party app that reads authorized context and writes an attributed preparation report.</small></span><ArrowRight size={15} /></a>
          <Tabs defaultValue="integrations"><TabsList><TabsTrigger value="integrations">Integrations</TabsTrigger><TabsTrigger value="inspector">Request inspector</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
            <TabsContent value="integrations"><Card className="developer-table"><CardContent><div className="section-heading"><h2>Registered integrations</h2><span>{dashboard.integrations.length} registrations</span></div><p className="helper">The three track apps are registered slots for teammates. The health companion is the working chat demo.</p>{dashboard.integrations.map(integration => <div className="registration-row" key={integration.id}><span className="integration-icon"><IntegrationIcon integration={integration} /></span><div><strong>{integration.name}</strong><code>{integration.id}</code><small>{integration.publisher}</small></div><Badge variant={integration.grant.connected ? 'secondary' : 'outline'}>{integration.grant.connected ? 'Connected' : 'Disconnected'}</Badge><Button variant="ghost" size="sm" onClick={() => setEditing(integration.id)}>Permissions</Button></div>)}</CardContent></Card>
              <Card className="api-card"><CardContent><h2>One API. Scoped context.</h2><p className="helper">Use server-side integration credentials generated by setup. Never put those credentials in browser code.</p><pre>{`POST /api/v1/context\nAuthorization: Bearer <integration-token>\nContent-Type: application/json\n\n{ "patientId": "patient-demo-001" }\n\nPOST /api/v1/reports\nAuthorization: Bearer <integration-token>\nContent-Type: application/json`}</pre><p className="helper">See <code>docs/INTEGRATION-CONTRACT.md</code> for request bodies, source dependencies, and error responses. New registrations and credential rotation are configured locally, not through this screen.</p></CardContent></Card>
            </TabsContent>
            <TabsContent value="inspector"><Card className="inspector"><CardContent><div className="section-heading"><h2>Exercise the gateway</h2><Badge variant="outline">Live checks & saved writes</Badge></div><p className="helper">Prepared fixture requests use real permissions. This inspector does not perform medical analysis.</p><div className="inspector-toolbar"><label className="select-wrap"><span className="sr-only">Integration to inspect</span><select value={inspectorId} onChange={event => { setInspectorId(event.target.value); setInspection(null); setInspectError(''); setWriteResult(''); }}><option value="">Choose an integration</option>{dashboard.integrations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></label><Button variant="outline" disabled={!inspectorId || !!busy} onClick={() => inspect('read')}>Run read request</Button><Button variant="outline" disabled={!inspectorId || !!busy || inspection?.integrationId !== inspectorId || !inspection?.response.requestId} onClick={() => inspect('write')}>Save fixture report</Button></div>
              {inspectorIntegration && <p className="helper">{inspectorIntegration.grant.connected ? `Connected · policy v${inspectorIntegration.grant.version}. ` : 'Disconnected: requests should be denied. '}{inspection?.response.requestId ? 'The report will reference the last successful read.' : 'Run a read request before saving a prepared report.'}</p>}
              {inspectError && <div className="alert error" role="alert">{inspectError}</div>}{writeResult && <div className="alert success" role="status">{writeResult}</div>}
              {inspection && <div className="inspection-result"><h3>Actual response</h3><ContextPreview response={inspection.response} /><details className="detail-block"><summary>Response JSON</summary><pre>{JSON.stringify(inspection.response, null, 2)}</pre></details></div>}
            </CardContent></Card></TabsContent>
            <TabsContent value="activity"><p className="helper source-intro">Access receipts record what this vault released. They cannot track use outside the vault.</p><Card><CardContent className="activity-list">{dashboard.activity.length === 0 ? <div className="empty-state"><ActivityIcon size={24} /><h3>No activity yet</h3><p>Connect an app or run a request to see its access history.</p></div> : dashboard.activity.map(event => <article className="activity-item" key={event.id}><div className="event-icon">{event.outcome.includes('denied') ? <LockKeyhole size={16} /> : <ActivityIcon size={16} />}</div><div><div className="activity-title"><strong>{event.actor}</strong><Badge variant="outline">{readable(event.outcome)}</Badge></div><p>{event.detail}</p><div className="activity-meta"><span>{readable(event.operation)}</span><span>{time(event.at)}</span>{event.policyVersion !== undefined && <span>Policy v{event.policyVersion}</span>}</div>{event.itemIds.length > 0 && <details className="activity-details"><summary>Record references ({event.itemIds.length})</summary><p>{event.itemIds.join(' · ')}</p></details>}</div></article>)}</CardContent></Card></TabsContent>
          </Tabs>
        </>}
      </main>
    </div>
    {selectedIntegration && <PermissionDialog integration={selectedIntegration} memories={dashboard.memories} onClose={() => setEditing(null)} onSaved={async text => { await refresh(); setInspection(null); setChatVersion(current => current + 1); setNotice(`${text} Chat starts fresh after permission changes.`); setEditing(null); }} />}
  </div>;
}

function MemoryCard({ item, dashboard, disabled, onRestrict }: { item: MemoryItem; dashboard: Dashboard; disabled: boolean; onRestrict: (mode: Disclosure) => void }) {
  const dependents = dashboard.memories.filter(candidate => candidate.parentIds.includes(item.id));
  const parents = dashboard.memories.filter(candidate => item.parentIds.includes(candidate.id));
  return <Card className="memory-card"><CardContent><div className="memory-card-top"><div><span className="item-category">{categoryLabels[item.category]}</span><h3>{item.label}</h3></div><DisclosureControl label={`Privacy for ${item.label}`} value={item.restriction} onChange={onRestrict} disabled={disabled} /></div><p className="memory-value">{item.value}</p><div className="memory-meta"><span>{item.author}</span><span>{readable(item.verification)}</span><span>v{item.version}</span></div><details className="detail-block"><summary>Sources & privacy details</summary><dl><div><dt>Sources</dt><dd>{item.sourceIds.map(id => dashboard.sources.find(source => source.id === id)?.title || id).join(', ') || 'No source recorded'}</dd></div><div><dt>Derived from</dt><dd>{parents.map(parent => parent.label).join(', ') || 'Original memory item'}</dd></div><div><dt>Dependents</dt><dd>{dependents.map(child => child.label).join(', ') || 'None'}</dd></div><div><dt>Recorded</dt><dd>{time(item.createdAt)}</dd></div></dl><p className="helper">Share still follows each app’s permissions. Redact keeps a placeholder; Private omits information. More restrictive source rules also apply.</p>{item.pendingReview && <p className="helper">Private pending review. A privacy preference does not verify clinical content.</p>}</details></CardContent></Card>;
}
