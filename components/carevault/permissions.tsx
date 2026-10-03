'use client';

import { useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { categories, categoryLabels, type Category, type ContextResponse, type Disclosure, type Grant, type Integration, type MemoryItem, type Scope } from '../../lib/types';
import { ContextPreview, DisclosureControl, errorMessage, modes, request, scopeLabels } from './shared';

export function PermissionDialog({ integration, memories, onClose, onSaved }: {
  integration: Integration; memories: MemoryItem[]; onClose: () => void; onSaved: (notice: string) => Promise<void>;
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
      await onSaved('Permissions saved. Future requests use your updated choices.');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  async function revoke() {
    setBusy('revoke'); setError('');
    try {
      await request(`/api/owner/connections/${encodeURIComponent(integration.id)}/revoke`, 'POST', {});
      await onSaved('Access revoked. Earlier disclosures remain in your activity history.');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  async function loadPreview() {
    setBusy('preview'); setError(''); setPreview(null);
    try { setPreview(await request<ContextResponse>('/api/owner/preview', 'POST', { integrationId: integration.id, grant: { ...grant, connected: true } })); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="permission-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{integration.name} permissions</DialogTitle><DialogDescription>Choose once. Access continues until you change or revoke it.</DialogDescription></DialogHeader>
      <div className="permission-body">
        <section><h3>Allowed actions</h3><div className="scope-list">
          {(Object.keys(scopeLabels) as Scope[]).map(scope => <label key={scope}><input type="checkbox" checked={grant.scopes.includes(scope)} disabled={!!busy} onChange={event => {
            const checked = event.target.checked;
            setGrant(current => ({ ...current, scopes: checked ? [...current.scopes, scope] : current.scopes.filter(value => value !== scope) })); setPreview(null);
          }} /><span>{scopeLabels[scope]}<small>{scope === 'facts:read' ? 'Only the memory you allow below.' : scope === 'files:download' ? 'Authorized redacted renditions, not original files.' : 'Add attributed reports without replacing established facts.'}</small></span></label>)}
        </div></section>
        <section><h3>Information access</h3><p className="helper">Share the value, show a redacted placeholder, or omit it entirely with Private. Redacted labels may reveal that information exists.</p>
          <div className="category-list">{categories.map(category => <div className="category-row" key={category}><span>{categoryLabels[category]}</span><DisclosureControl label={`${categoryLabels[category]} access`} value={grant.categories[category]} onChange={mode => changeCategory(category, mode)} disabled={!!busy} /></div>)}</div>
        </section>
        <details className="detail-block"><summary>Individual restrictions</summary><p className="helper">Narrow access to specific items. Source restrictions also apply to derived memory.</p>
          {memories.map(item => {
            const minimum = modes[Math.max(modes.indexOf(grant.categories[item.category]), modes.indexOf(item.restriction))];
            const selected = modes[Math.max(modes.indexOf(grant.overrides[item.id] || 'share'), modes.indexOf(minimum))];
            return <div className="override-row" key={item.id}><span>{item.label}</span><DisclosureControl label={`App restriction for ${item.label}`} value={selected} minimum={minimum} disabled={!!busy} onChange={mode => {
              setGrant(current => ({ ...current, overrides: { ...current.overrides, [item.id]: mode } })); setPreview(null);
            }} /></div>;
          })}
        </details>
        <section><div className="section-heading"><h3>Preview the actual response</h3><Button variant="outline" size="sm" disabled={!!busy} onClick={loadPreview}>{busy === 'preview' ? 'Checking…' : 'Preview access'}</Button></div><p className="helper">Uses the server permission evaluator. Your changes apply after saving.</p>{preview && <ContextPreview response={preview} />}</section>
        {error && <div className="alert error" role="alert">{error}</div>}
        <p className="privacy-note">Revocation stops future access. It cannot recall readable copies already shared with another app.</p>
      </div>
      <DialogFooter className="permission-footer">{integration.grant.connected && <Button variant="ghost" className="revoke-button" disabled={!!busy} onClick={revoke}>{busy === 'revoke' ? 'Revoking…' : 'Revoke access'}</Button>}<Button variant="outline" onClick={onClose} disabled={!!busy}>Cancel</Button><Button onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : integration.grant.connected ? 'Save permissions' : 'Connect app'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
