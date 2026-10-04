'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Eye, Info, Save } from 'lucide-react';
import type { PatientProfile } from '../../lib/profile';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableRow } from '../ui/table';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { errorMessage, request, RequestError } from './shared';

type Field = keyof PatientProfile['fields'];
const sections: { id: string; title: string; fields: { key: Field; label: string; max: number; type?: string; multiline?: boolean }[] }[] = [
  { id: 'basics', title: 'Basics', fields: [
    { key: 'name', label: 'Name', max: 120 },
    { key: 'dateOfBirth', label: 'Date of birth', type: 'date', max: 10 },
    { key: 'email', label: 'Email', type: 'email', max: 254 },
    { key: 'phone', label: 'Phone', type: 'tel', max: 60 },
    { key: 'address', label: 'Address', max: 300 },
  ] },
  { id: 'critical', title: 'Critical information', fields: [
    { key: 'allergies', label: 'Allergies', max: 2000, multiline: true },
    { key: 'medications', label: 'Medications', max: 2000, multiline: true },
    { key: 'conditions', label: 'Conditions', max: 2000, multiline: true },
  ] },
  { id: 'care', title: 'Care preferences', fields: [
    { key: 'accessibilityNeeds', label: 'Accessibility needs', max: 2000, multiline: true },
    { key: 'emergencyContact', label: 'Emergency contact', max: 300, multiline: true },
    { key: 'carePreferences', label: 'Care preferences', max: 2000, multiline: true },
  ] },
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
    <div className="profile-tables">
      {sections.map(section => <section key={section.id} aria-labelledby={`profile-section-${section.id}`}>
        <h2 id={`profile-section-${section.id}`}>{section.title}</h2>
        <Table className="profile-table" aria-labelledby={`profile-section-${section.id}`}><TableBody>
          {section.fields.map(field => <TableRow key={field.key}>
            <TableHead scope="row"><label htmlFor={`profile-${field.key}`}>{field.label}</label></TableHead>
            <TableCell>{field.multiline
              ? <Textarea id={`profile-${field.key}`} rows={2} maxLength={field.max} value={fields[field.key]} onChange={event => change(field.key, event.target.value)} disabled={busy} placeholder="Not entered" />
              : <Input id={`profile-${field.key}`} type={field.type ?? 'text'} maxLength={field.max} value={fields[field.key]} onChange={event => change(field.key, event.target.value)} disabled={busy} placeholder="Not entered" />
            }</TableCell>
          </TableRow>)}
        </TableBody></Table>
      </section>)}
    </div>
    <div className="profile-footer"><details className="compact-details"><summary aria-label="Profile sharing details" title="Profile sharing details"><Info size={17} aria-hidden="true" /></summary><p>Saving replaces the shared snapshot and revokes access to the old version. Share the new version in Apps. Copies already shared cannot be recalled.</p></details><div className="flex gap-2"><Button type="button" variant="outline" disabled={!dirty || busy} onClick={reset}>Cancel</Button><Button type="submit" disabled={!dirty || busy}><Save size={16} aria-hidden="true" />{busy ? 'Saving…' : 'Save changes'}</Button></div></div>
  </form>;
}
