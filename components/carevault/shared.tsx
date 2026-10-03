'use client';

import { Badge } from '../ui/badge';
import { FlaskConical, MessageCircle, Pill, ScanLine } from 'lucide-react';
import type { ContextResponse, Disclosure, Integration, Scope } from '../../lib/types';

export const scopeLabels: Record<Scope, string> = {
  'facts:read': 'Read memory',
  'files:download': 'Download redacted files',
  'reports:create': 'Write reports',
};
export const modes: Disclosure[] = ['share', 'redact', 'private'];
export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(data?.message || data?.error || `Request failed (${response.status}).`, response.status);
  return data as T;
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
export function readable(value: string) { return value.replaceAll('_', ' ').replaceAll('-', ' '); }
export function time(value: string) { return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
export function IntegrationIcon({ integration }: { integration: Integration }) {
  const Icon = integration.id === 'care-assistant' ? MessageCircle : integration.icon === 'scan' ? ScanLine : integration.icon === 'flask' ? FlaskConical : Pill;
  return <Icon size={19} strokeWidth={1.7} />;
}
export function DisclosureControl({ value, onChange, label, disabled = false, minimum = 'share' }: {
  value: Disclosure; onChange: (value: Disclosure) => void; label: string; disabled?: boolean; minimum?: Disclosure;
}) {
  return <div className="disclosure-control" role="group" aria-label={label}>
    {modes.map(mode => <button type="button" key={mode} disabled={disabled || modes.indexOf(mode) < modes.indexOf(minimum)} className={value === mode ? `selected ${mode}` : ''} aria-pressed={value === mode} onClick={() => onChange(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
  </div>;
}
export function ContextPreview({ response }: { response: ContextResponse }) {
  return <div className="context-preview">
    <div className="preview-meta"><span>{response.items.length} returned items</span><span>Policy v{response.policyVersion}</span></div>
    {response.items.length === 0 ? <p className="empty-small">No memory is available under these permissions.</p> : response.items.map(item => <div key={item.id} className="released-item">
      <div><strong>{item.field}</strong><Badge variant="outline">{item.disclosure}</Badge></div>
      <p>{item.value}</p>{item.verification && <small>{readable(item.verification)}</small>}
    </div>)}
  </div>;
}
