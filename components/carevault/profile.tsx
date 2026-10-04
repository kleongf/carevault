'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Eye, Info, Save } from 'lucide-react';
import type { PatientProfile } from '../../lib/profile';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { errorMessage, request, RequestError } from './shared';

type Field = keyof PatientProfile['fields'];
const basics: { key: Field; label: string; max: number; type?: string }[] = [
  { key: 'name', label: 'Name', max: 120 },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date', max: 10 },
  { key: 'email', label: 'Email', type: 'email', max: 254 },
  { key: 'phone', label: 'Phone', type: 'tel', max: 60 },
  { key: 'address', label: 'Address', max: 300 },
];
const medical: { key: Field; label: string }[] = [
  { key: 'allergies', label: 'Allergies' },
  { key: 'medications', label: 'Medications' },
  { key: 'conditions', label: 'Conditions' },
];

export function PatientProfileForm({ profile, snapshot, onSaved, onPreview }: {
  profile: PatientProfile;
  snapshot?: { status: 'queued' | 'processing' | 'ready' | 'failed' };
  onSaved: () => Promise<void>;
  onPreview: (opener: HTMLButtonElement) => void;
}) {
  const [saved, setSaved] = useState(profile);
  const [fields, setFields] = useState(profile.fields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty = (Object.keys(fields) as Field[]).some(key => fields[key] !== saved.fields[key]);
  useEffect(() => {
    if (!dirty && profile.version > saved.version) { setSaved(profile); setFields(profile.fields); }
  }, [profile, dirty, saved.version]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(key: Field, value: string) { setFields(current => ({ ...current, [key]: value })); setNotice(''); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); setConflict(false);
    try {
      const result = await request<PatientProfile>('/api/patient/profile', 'PUT', { version: saved.version, fields });
      setSaved(result); setFields(result.fields); setNotice('Saved.');
      await onSaved();
    } catch (err) { setError(errorMessage(err)); setConflict(err instanceof RequestError && err.status === 409); }
    finally { setBusy(false); }
  }
  async function reload() {
    if (dirty && !window.confirm('Discard unsaved changes and reload your profile?')) return;
    setBusy(true); setError('');
    try {
      const result = await request<PatientProfile>('/api/patient/profile');
      setSaved(result); setFields(result.fields); setConflict(false); setNotice('');
      await onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  function reset() {
    const latest = profile.version > saved.version ? profile : saved;
    setSaved(latest); setFields(latest.fields); setError(''); setNotice(''); setConflict(false);
  }
  return <form onSubmit={save} className="patient-profile">
    <div className="page-heading"><div><h1>Profile</h1><Badge variant="outline">Patient-reported</Badge></div><div className="flex flex-wrap items-center gap-2">{snapshot && <><Badge variant={snapshot.status === 'failed' ? 'destructive' : 'secondary'}>{snapshot.status === 'queued' ? 'Waiting' : snapshot.status === 'processing' ? 'Processing' : snapshot.status === 'ready' ? 'Ready' : 'Failed'}</Badge><Button type="button" variant="outline" onClick={event => onPreview(event.currentTarget)}><Eye size={16} aria-hidden="true" />Preview snapshot</Button></>}</div></div>
    {error && <div className="alert error" role="alert">{error}{conflict && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reload}>Reload profile</Button>}</div>}
    {notice && <p className="alert success" role="status">{notice}</p>}
    <div className="profile-grid">
      <Card><CardContent className="profile-card"><h2>Basics</h2><div className="profile-fields">{basics.map(field => <div key={field.key} className={field.key === 'address' ? 'profile-wide' : undefined}><label htmlFor={`profile-${field.key}`}>{field.label}</label><Input id={`profile-${field.key}`} type={field.type ?? 'text'} maxLength={field.max} value={fields[field.key]} onChange={event => change(field.key, event.target.value)} disabled={busy} placeholder="Not entered" /></div>)}</div></CardContent></Card>
      <Card><CardContent className="profile-card"><h2>Critical information</h2>{medical.map(field => <div key={field.key}><label htmlFor={`profile-${field.key}`}>{field.label}</label><Textarea id={`profile-${field.key}`} rows={2} maxLength={2000} value={fields[field.key]} onChange={event => change(field.key, event.target.value)} disabled={busy} placeholder="Not entered" /></div>)}</CardContent></Card>
      <Card className="profile-wide"><CardContent className="profile-card"><h2>Care preferences</h2><div className="profile-fields">{([{ key: 'accessibilityNeeds', label: 'Accessibility needs', max: 2000 }, { key: 'emergencyContact', label: 'Emergency contact', max: 300 }, { key: 'carePreferences', label: 'Care preferences', max: 2000 }] as const).map(field => <div key={field.key} className={field.key === 'carePreferences' ? 'profile-wide' : undefined}><label htmlFor={`profile-${field.key}`}>{field.label}</label><Textarea id={`profile-${field.key}`} rows={2} maxLength={field.max} value={fields[field.key]} onChange={event => change(field.key, event.target.value)} disabled={busy} placeholder="Not entered" /></div>)}</div></CardContent></Card>
    </div>
    <div className="profile-footer"><details className="compact-details"><summary aria-label="Profile sharing details" title="Profile sharing details"><Info size={17} aria-hidden="true" /></summary><p>Saving replaces the shared snapshot and revokes access to the old version. Share the new version in Apps. Copies already shared cannot be recalled.</p></details><div className="flex gap-2"><Button type="button" variant="outline" disabled={!dirty || busy} onClick={reset}>Cancel</Button><Button type="submit" disabled={!dirty || busy}><Save size={16} aria-hidden="true" />{busy ? 'Saving…' : 'Save changes'}</Button></div></div>
  </form>;
}
