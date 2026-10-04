'use client';

import { useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, ClipboardList, FileOutput, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { ContextPreview, errorMessage, readable, request, RequestError } from '../../components/carevault/shared';
import type { ContextResponse } from '../../lib/types';

type ReportResponse = { reportId: string; verification: string; memoryProcessing: string };

function makeDraft(context: ContextResponse) {
  const shared = context.items.filter(item => item.disclosure === 'shared');
  const find = (...labels: string[]) => shared.find(item => labels.some(label => item.field.toLowerCase().includes(label)));
  const symptom = find('reported symptom');
  const medication = find('medication');
  const allergy = find('ingredient restriction', 'allerg');
  const appointment = find('appointment preference');
  const language = find('preferred language');
  const contact = find('contact preference');
  const questions = [
    symptom && `Discuss the reported symptom: ${symptom.value}.`,
    medication && `Review the medication record: ${medication.value}.`,
    allergy && `Confirm the reported safety information: ${allergy.value}.`,
    appointment && `Request the patient’s preferred timing: ${appointment.value}.`,
  ].filter((item): item is string => Boolean(item));
  const details = [
    symptom && `Reported symptom: ${symptom.value}`,
    medication && `Medication record: ${medication.value}`,
    allergy && `Allergy or ingredient restriction: ${allergy.value}`,
    appointment && `Appointment preference: ${appointment.value}`,
    language && `Preferred language: ${language.value}`,
    contact && `Contact preference: ${contact.value}`,
  ].filter((item): item is string => Boolean(item));
  return `Visit preparation draft\n\nAuthorized patient context\n${details.length ? details.join('\n') : 'No shareable details were returned.'}\n\nQuestions to discuss:\n${questions.length ? questions.map((question, index) => `${index + 1}. ${question}`).join('\n') : '1. Ask the patient what they would like to discuss at the visit.'}\n\nOnly authorized information from CareVault was used. This draft is for appointment preparation, not diagnosis or medical advice.`;
}

export default function VisitPrepPage() {
  const [patientId, setPatientId] = useState('patient-demo-001');
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState<ReportResponse | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function loadContext(event?: FormEvent) {
    event?.preventDefault();
    setBusy('read'); setError(''); setSaved(null);
    try {
      const result = await request<ContextResponse>('/api/visit-prep/context', 'POST', { patientId, query: 'Information relevant to preparing a healthcare visit' });
      setContext(result); setDraft(makeDraft(result));
    } catch (err) {
      setContext(null); setDraft(''); setError(err instanceof RequestError && err.status === 401 ? 'Open your CareVault owner session first, then return to Visit Prep AI.' : errorMessage(err));
    } finally { setBusy(''); }
  }

  async function saveReport() {
    if (!context?.requestId || !draft) return;
    setBusy('write'); setError(''); setSaved(null);
    try {
      setSaved(await request<ReportResponse>('/api/visit-prep/reports', 'POST', {
        patientId, title: 'Visit preparation draft', body: draft, contextRequestId: context.requestId,
        sourceItemIds: context.items.map(item => item.id),
      }));
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }

  return <main className="visit-prep-shell">
    <header className="visit-prep-header"><a href="/" className="back-link"><ArrowLeft size={15} />Back to CareVault</a><Badge variant="outline">Integration demo</Badge></header>
    <div className="visit-prep-content">
      <div className="visit-prep-hero"><div className="visit-prep-icon"><ClipboardList size={25} /></div><div><p className="eyebrow">Third-party health application</p><h1>Visit Prep AI</h1><p className="visit-prep-subtitle">A patient-authorized assistant for preparing better healthcare conversations.</p></div></div>
      <div className="visit-prep-banner"><ShieldCheck size={17} /><span><strong>CareVault controls the context.</strong> This app requests a current, policy-filtered view and never receives the patient’s complete record.</span></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <form className="visit-prep-request" onSubmit={loadContext}><label htmlFor="patient-id">Patient context request</label><div className="visit-prep-request-row"><Input id="patient-id" value={patientId} onChange={event => setPatientId(event.target.value)} aria-describedby="patient-help" /><Button disabled={!!busy || !patientId}>{busy === 'read' ? <><LoaderCircle className="animate-spin" size={15} />Loading context…</> : <><RefreshCw size={15} />Load authorized context</>}</Button></div><p id="patient-help" className="helper">The patient ID identifies the requested resource; the owner session and integration grant establish access.</p></form>
      <div className="visit-prep-grid">
        <Card><CardContent><div className="section-heading"><h2>Context received</h2>{context && <Badge variant="secondary"><CheckCircle2 size={12} />Live response</Badge>}</div>{context ? <><div className="visit-prep-meta"><span>Request {context.requestId}</span><span>Policy v{context.policyVersion}</span></div><ContextPreview response={context} /></> : <div className="visit-prep-empty"><LockKeyhole size={21} /><p>Load context to see the exact information this application is allowed to use.</p></div>}</CardContent></Card>
        <Card><CardContent><div className="section-heading"><h2>Appointment preparation</h2><Badge variant="outline"><Sparkles size={12} />Unverified draft</Badge></div>{draft ? <><pre className="visit-prep-draft">{draft}</pre><Button className="full-width" onClick={saveReport} disabled={!!busy || !context?.requestId}>{busy === 'write' ? <><LoaderCircle className="animate-spin" size={15} />Saving report…</> : <><FileOutput size={15} />Save to CareVault</>}</Button>{saved && <div className="visit-prep-saved" role="status"><CheckCircle2 size={15} /><span><strong>Saved as integration-authored</strong><small>Report {saved.reportId} · {readable(saved.verification)} · pending review</small></span></div>}</> : <div className="visit-prep-empty"><Sparkles size={21} /><p>Your preparation draft will be generated from permitted context only.</p></div>}</CardContent></Card>
      </div>
      <p className="visit-prep-disclaimer">Demo boundary: synthetic data only. Visit Prep AI provides appointment preparation, not diagnosis, prescribing, or clinical decision-making.</p>
    </div>
  </main>;
}
