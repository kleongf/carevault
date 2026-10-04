'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Clock3, FlaskConical, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import type { Dashboard, Integration, MemoryItem, TrialFactRequest, TrialMatchesResponse } from '../../lib/types';
import { errorMessage, request, readable } from './shared';

interface UsedFact { requestId: string; studyId: string; field: string; value: string; }

export function TrialExplorer({ integration, requests, memories, onPermissions, onRefresh }: {
  integration?: Integration; requests: TrialFactRequest[]; memories: MemoryItem[];
  onPermissions: () => void; onRefresh: () => Promise<Dashboard | null>;
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
      setNotice('Trial Explorer requested one additional fact. Review the request below.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  async function decide(requestId: string, decision: 'approve' | 'deny') {
    setBusy(requestId); setError(''); setNotice('');
    try {
      await request(`/api/owner/trials/requests/${requestId}/${decision}`, 'POST', {});
      await onRefresh();
      setNotice(decision === 'approve' ? 'One-request access approved. It will not change saved permissions.' : 'Request denied. No fact was shared.');
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
      setNotice('Trial Explorer used the fact in one request. Access is now consumed; it is absent from later matches.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  return <>
    <div className="page-heading"><div><h1>Trial Explorer</h1><p>Potential matches from the facts you have chosen to share.</p></div><Badge variant="outline">Synthetic study catalog</Badge></div>
    <div className="trial-intro"><div className="trial-intro-icon"><FlaskConical size={19} /></div><p>Study criteria are compared with currently authorized facts. Unknown criteria stay unresolved. One-time sharing requires your approval and does not update the app’s saved grant.</p><Button variant="outline" size="sm" onClick={onPermissions}><ShieldCheck size={14} />{integration?.grant.connected ? 'Manage access' : 'Connect app'}</Button></div>
    {!canRead && <div className="trial-empty"><LockKeyhole size={18} /><span>{integration?.grant.connected ? 'Trial Explorer needs read-memory permission to compare facts.' : 'Connect Trial Explorer to compare authorized facts.'}</span></div>}
    {canRead && <div className="trial-toolbar"><span>{matches ? `Permission version ${matches.policyVersion}` : 'Loading authorized facts…'}</span><Button variant="outline" size="sm" disabled={!!busy} onClick={loadMatches}>{busy === 'matches' ? 'Checking…' : 'Refresh matches'}</Button></div>}
    {error && <div className="alert error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}
    {notice && <div className="alert success" role="status"><Check size={14} />{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {matches && <div className="trial-grid">{matches.studies.map(study => {
      const openRequest = trialRequests.find(item => item.studyId === study.studyId && ['pending', 'approved'].includes(item.status));
      return <Card className="trial-card" key={study.studyId}><CardContent>
        <div className="trial-card-top"><div><span>{study.sponsor}</span><h2>{study.title}</h2></div><Badge variant={study.status === 'potential' ? 'secondary' : 'outline'}>{study.status === 'potential' ? 'Potential match' : 'Not currently a potential match'}</Badge></div>
        <p className="trial-summary">{study.summary}</p>
        <ul className="trial-criteria">{study.criteria.map(criterion => <li key={criterion.id}><span className={`criterion-state ${criterion.status}`} aria-hidden="true">{criterion.status === 'met' ? <Check size={12} /> : criterion.status === 'unknown' ? <Clock3 size={12} /> : <X size={12} />}</span><span>{criterion.label}</span><small>{criterion.status === 'met' ? 'Met by shared fact' : criterion.status === 'unknown' ? 'Not available in shared facts' : 'Not met by shared facts'}</small></li>)}</ul>
        {study.unresolvedCount > 0 && <p className="trial-unresolved">{study.unresolvedCount} unresolved {study.unresolvedCount === 1 ? 'criterion' : 'criteria'}</p>}
        {openRequest ? <p className="trial-request-state"><Clock3 size={13} />Additional fact request {openRequest.status} · expires {new Date(openRequest.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p> : study.additionalFactRequestAvailable && canRead && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => createRequest(study.studyId)}>Request one fact <ArrowRight size={14} /></Button>}
      </CardContent></Card>;
    })}</div>}
    {usedFact && <Card className="trial-used"><CardContent><div><Check size={16} /><strong>One-time fact used</strong></div><p>{usedFact.field}: {usedFact.value}</p><small>Request {usedFact.requestId} · {usedFact.studyId}. Future matching uses saved permissions only.</small></CardContent></Card>}
    {trialRequests.length > 0 && <section className="trial-requests"><div className="section-heading"><h2>Fact access requests</h2><span>Owner approval</span></div>{trialRequests.map(item => {
      const fact = memories.find(memory => memory.id === item.factId);
      return <Card className="trial-request" key={item.id}><CardContent><div className="trial-request-info"><strong>{fact?.label ?? 'Requested fact'}</strong><span>{item.studyId.replaceAll('-', ' ')} · {readable(item.status)}</span>{item.status === 'pending' && fact && <p>{fact.value}</p>}<small>Single fact · single request · {new Date(item.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} expiry</small></div>
        {item.status === 'pending' && <div className="trial-request-actions"><Button size="sm" disabled={!!busy} onClick={() => decide(item.id, 'approve')}>Approve one use</Button><Button variant="outline" size="sm" disabled={!!busy} onClick={() => decide(item.id, 'deny')}>Deny</Button></div>}
        {item.status === 'approved' && <Button size="sm" disabled={!!busy} onClick={() => useFact(item)}>{busy === item.id ? 'Using…' : 'Use approved fact once'}</Button>}
        {item.status === 'consumed' && <Badge variant="secondary">Access consumed</Badge>}
        {item.status === 'denied' && <Badge variant="outline">No access granted</Badge>}
        {item.status === 'expired' && <Badge variant="outline">Request expired</Badge>}
      </CardContent></Card>;
    })}</section>}
    <p className="trial-disclaimer">Synthetic demo only. These results are not clinical-trial eligibility decisions, medical advice, or live study listings. No real health information should be used.</p>
  </>;
}