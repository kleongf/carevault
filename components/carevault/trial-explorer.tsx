'use client';

import { useEffect, useState, type Ref } from 'react';
import { ArrowRight, Check, Clock3, Info, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import type { Dashboard, Integration, MemoryItem, TrialFactRequest, TrialMatchesResponse } from '../../lib/types';
import { errorMessage, request, readable } from './shared';

interface UsedFact { requestId: string; studyId: string; field: string; value: string; }

export function TrialExplorer({ integration, requests, memories, onPermissions, onRefresh, permissionButtonRef }: {
  integration?: Integration; requests: TrialFactRequest[]; memories: MemoryItem[];
  onPermissions: () => void; onRefresh: () => Promise<Dashboard | null>; permissionButtonRef?: Ref<HTMLButtonElement>;
}) {
  const [matches, setMatches] = useState<TrialMatchesResponse | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [usedFact, setUsedFact] = useState<UsedFact | null>(null);
  const canRead = Boolean(integration?.grant.connected && integration.grant.scopes.includes('facts:read'));
  const trialRequests = requests.filter(item => item.integrationId === integration?.id);

  async function loadMatches() {
    if (!integration) return;
    setBusy('matches'); setError('');
    try {
      setMatches(await request<TrialMatchesResponse>('/api/owner/trials/matches', 'POST', { integrationId: integration.id }));
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  useEffect(() => {
    if (!canRead || !integration) { setMatches(null); return; }
    let current = true;
    request<TrialMatchesResponse>('/api/owner/trials/matches', 'POST', { integrationId: integration.id })
      .then(result => { if (current) setMatches(result); })
      .catch(err => { if (current) setError(errorMessage(err)); });
    return () => { current = false; };
  }, [canRead, integration?.id, integration?.grant.version]);

  async function createRequest(studyId: string) {
    setBusy(studyId); setError(''); setNotice('');
    try {
      await request('/api/owner/trials/requests', 'POST', { integrationId: integration?.id, studyId });
      await onRefresh();
      setNotice('Fact requested.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  async function decide(requestId: string, decision: 'approve' | 'deny') {
    setBusy(requestId); setError(''); setNotice('');
    try {
      await request(`/api/owner/trials/requests/${requestId}/${decision}`, 'POST', {});
      await onRefresh();
      setNotice(decision === 'approve' ? 'One use approved.' : 'Request denied.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  async function useFact(item: TrialFactRequest) {
    setBusy(item.id); setError(''); setNotice(''); setUsedFact(null);
    try {
      const result = await request<{ studyId: string; fact: { field: string; value: string } }>(`/api/owner/trials/requests/${item.id}/use`, 'POST', { integrationId: item.integrationId });
      setUsedFact({ requestId: item.id, studyId: result.studyId, field: result.fact.field, value: result.fact.value });
      await onRefresh();
      await loadMatches();
      setNotice('Fact used once.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  return <>
    <div className="page-heading"><div><h1>Trial Explorer</h1><Badge variant="outline">Synthetic studies</Badge></div><Button variant="outline" size="sm" ref={permissionButtonRef} onClick={onPermissions}><ShieldCheck size={14} />{integration?.grant.connected ? 'Manage access' : 'Connect app'}</Button></div>
    {!canRead && <div className="trial-empty"><LockKeyhole size={18} /><span>{integration?.grant.connected ? 'Memory access required.' : 'Connect to see matches.'}</span></div>}
    {canRead && <div className="trial-toolbar"><span>{matches ? `${matches.studies.length} studies` : 'Loading matches…'}</span><Button variant="outline" size="sm" disabled={!!busy} onClick={loadMatches}>{busy === 'matches' ? 'Checking…' : 'Refresh matches'}</Button></div>}
    {error && <div className="alert error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}
    {notice && <div className="alert success" role="status"><Check size={14} />{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {matches && <div className="trial-grid">{matches.studies.map(study => {
      const openRequest = trialRequests.find(item => item.studyId === study.studyId && ['pending', 'approved'].includes(item.status));
      return <Card className="trial-card" key={study.studyId}><CardContent>
        <div className="trial-card-top"><h2>{study.title}</h2><Badge variant={study.status === 'potential' ? 'secondary' : 'outline'}>{study.status === 'potential' ? 'Potential match' : 'No match yet'}</Badge></div>
        <ul className="trial-criteria">{study.criteria.map(criterion => <li key={criterion.id}><span className={`criterion-state ${criterion.status}`} role="img" aria-label={criterion.status === 'met' ? 'Met' : criterion.status === 'unknown' ? 'Unknown' : 'Not met'} title={criterion.status === 'met' ? 'Met' : criterion.status === 'unknown' ? 'Unknown' : 'Not met'}>{criterion.status === 'met' ? <Check size={12} /> : criterion.status === 'unknown' ? <Clock3 size={12} /> : <X size={12} />}</span><span>{criterion.label}</span></li>)}</ul>
        {openRequest ? <p className="trial-request-state"><Clock3 size={13} />Request {openRequest.status} · expires {new Date(openRequest.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p> : study.additionalFactRequestAvailable && canRead && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => createRequest(study.studyId)}>Request one fact <ArrowRight size={14} /></Button>}
      </CardContent></Card>;
    })}</div>}
    {usedFact && <Card className="trial-used"><CardContent><Badge variant="secondary">One-time fact used</Badge><p>{usedFact.field}: {usedFact.value}</p></CardContent></Card>}
    {trialRequests.length > 0 && <section className="trial-requests"><div className="section-heading"><h2>Fact requests</h2></div>{trialRequests.map(item => {
      const fact = memories.find(memory => memory.id === item.factId);
      return <Card className="trial-request" key={item.id}><CardContent><div className="trial-request-info"><strong>{fact?.label ?? 'Requested fact'}</strong><span>{item.studyId.replaceAll('-', ' ')}{['pending', 'approved'].includes(item.status) && ` · ${readable(item.status)}`}</span>{item.status === 'pending' && fact && <p>{fact.value}</p>}<small>Expires {new Date(item.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div>
        {item.status === 'pending' && <div className="trial-request-actions"><Button size="sm" disabled={!!busy} onClick={() => decide(item.id, 'approve')}>Approve one use</Button><Button variant="outline" size="sm" disabled={!!busy} onClick={() => decide(item.id, 'deny')}>Deny</Button></div>}
        {item.status === 'approved' && <Button size="sm" disabled={!!busy} onClick={() => useFact(item)}>{busy === item.id ? 'Using…' : 'Use approved fact once'}</Button>}
        {item.status === 'consumed' && <Badge variant="secondary">Access consumed</Badge>}
        {item.status === 'denied' && <Badge variant="outline">No access granted</Badge>}
        {item.status === 'expired' && <Badge variant="outline">Request expired</Badge>}
      </CardContent></Card>;
    })}</section>}
    <details className="detail-block mt-4"><summary className="inline-flex cursor-pointer items-center" aria-label="About Trial Explorer and one-use access"><Info size={16} aria-hidden="true" /><span className="sr-only">About Trial Explorer and one-use access</span></summary><p className="helper">Matches use shared facts. Extra facts need one-use approval; saved permissions stay unchanged. A consumed fact is absent from future matches.</p><p className="helper">Synthetic studies, not live listings or eligibility decisions. No medical advice. Use fictional health data only.</p></details>
  </>;
}