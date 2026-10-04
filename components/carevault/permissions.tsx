'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { categories, categoryLabels, type Category, type ContextResponse, type Disclosure, type Grant, type Integration, type MemoryItem, type Scope } from '../../lib/types';
import { ContextPreview, DisclosureControl, errorMessage, modes, request, scopeLabels } from './shared';

export function PermissionDialog({ integration, memories, onClose, onSaved, onCloseAutoFocus }: {
  integration: Integration; memories: MemoryItem[]; onClose: () => void; onSaved: (notice: string) => Promise<void>; onCloseAutoFocus?: (event: Event) => void;
}) {
  const [grant, setGrant] = useState<Grant>(() => structuredClone(integration.grant));
  const [preview, setPreview] = useState<ContextResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  function changeCategory(category: Category, mode: Disclosure) {
    setGrant(current => ({ ...current, categories: { ...current.categories, [category]: mode } }));
    setPreview(null);
  }
  async function save() {
    setBusy('save'); setError('');
    try {
      await request(`/api/owner/connections/${encodeURIComponent(integration.id)}`, 'PUT', { ...grant, connected: true });
      await onSaved('Permissions saved.');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  async function revoke() {
    setBusy('revoke'); setError('');
    try {
      await request(`/api/owner/connections/${encodeURIComponent(integration.id)}/revoke`, 'POST', {});
      await onSaved('Access revoked. Earlier sharing remains in your activity history.');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  async function loadPreview() {
    setBusy('preview'); setError(''); setPreview(null);
    try { setPreview(await request<ContextResponse>('/api/owner/preview', 'POST', { integrationId: integration.id, grant: { ...grant, connected: true } })); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="permission-dialog" onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{integration.name} permissions</DialogTitle><DialogDescription className="sr-only">Choose the app’s allowed actions and information access.</DialogDescription></DialogHeader>
      <div className="permission-body">
        <section><h3>Allowed actions</h3><div className="scope-list">
          {(Object.keys(scopeLabels) as Scope[]).map(scope => <label key={scope}><input type="checkbox" checked={grant.scopes.includes(scope)} disabled={!!busy} onChange={event => {
            const checked = event.target.checked;
            setGrant(current => ({ ...current, scopes: checked ? [...current.scopes, scope] : current.scopes.filter(value => value !== scope) })); setPreview(null);
          }} /><span>{scopeLabels[scope]}</span></label>)}
        </div></section>
        <section><h3>Information access</h3>
          <div className="category-list">{categories.map(category => <div className="category-row" key={category}><span>{categoryLabels[category]}</span><DisclosureControl label={`${categoryLabels[category]} access`} value={grant.categories[category]} onChange={mode => changeCategory(category, mode)} disabled={!!busy} /></div>)}</div>
        </section>
        <details className="detail-block"><summary>Individual restrictions</summary><p className="helper">Further limit individual facts. Source restrictions also apply to derived facts.</p>
          {memories.map(item => {
            const minimum = modes[Math.max(modes.indexOf(grant.categories[item.category]), modes.indexOf(item.restriction))];
            const selected = modes[Math.max(modes.indexOf(grant.overrides[item.id] || 'share'), modes.indexOf(minimum))];
            return <div className="override-row" key={item.id}><span>{item.label}</span><DisclosureControl label={`App restriction for ${item.label}`} value={selected} minimum={minimum} disabled={!!busy} onChange={mode => {
              setGrant(current => ({ ...current, overrides: { ...current.overrides, [item.id]: mode } })); setPreview(null);
            }} /></div>;
          })}
        </details>
        <section><div className="section-heading"><h3>Access preview</h3><Button variant="outline" size="sm" disabled={!!busy} onClick={loadPreview}>{busy === 'preview' ? 'Checking…' : 'Preview access'}</Button></div>{preview && <ContextPreview response={preview} />}</section>
        {error && <div className="alert error" role="alert">{error}</div>}
        <details className="detail-block"><summary className="inline-flex cursor-pointer items-center" aria-label="Permission help"><Info size={16} aria-hidden="true" /><span className="sr-only">Permission help</span></summary><p className="helper">Share reveals the value; Redact shows a placeholder; Private hides the item. Placeholders reveal that information exists.</p><p className="helper">Only allowed facts and redacted files can be read. Reports do not replace existing facts.</p><p className="helper">Changes apply after saving and last until changed or revoked. Revoking stops future access; copies already shared cannot be recalled.</p></details>
      </div>
      <DialogFooter className="permission-footer">{integration.grant.connected && <Button variant="ghost" className="revoke-button" disabled={!!busy} onClick={revoke}>{busy === 'revoke' ? 'Revoking…' : 'Revoke access'}</Button>}<Button variant="outline" onClick={onClose} disabled={!!busy}>Cancel</Button><Button onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : integration.grant.connected ? 'Save permissions' : 'Connect app'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
