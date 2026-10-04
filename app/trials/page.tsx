'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, LogOut, ShieldCheck } from 'lucide-react';
import { Login } from '../../components/carevault/login';
import { PermissionDialog } from '../../components/carevault/permissions';
import { TrialExplorer } from '../../components/carevault/trial-explorer';
import { errorMessage, request, RequestError } from '../../components/carevault/shared';
import { Button } from '../../components/ui/button';
import type { Dashboard } from '../../lib/types';

type Account = { id: string; username: string; role: 'patient' | 'developer' };

export default function TrialsPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [error, setError] = useState('');
  const permissionButtonRef = useRef<HTMLButtonElement>(null);

  async function refresh(): Promise<Dashboard | null> {
    try {
      const result = await request<Dashboard>('/api/owner/dashboard');
      setDashboard(result);
      return result;
    } catch (err) {
      if (err instanceof RequestError && err.status === 401) {
        setAccount(null); setDashboard(null); setPermissionsOpen(false);
        return null;
      }
      throw err;
    }
  }
  useEffect(() => {
    request<{ account: Account }>('/api/session').then(async result => {
      setAccount(result.account);
      if (result.account.role === 'patient') await refresh();
    }).catch(err => {
      if (!(err instanceof RequestError) || err.status !== 401) setError(errorMessage(err));
    }).finally(() => setLoading(false));
  }, []);

  async function signedIn(next: Account) {
    setAccount(next); setError(''); setDashboard(null);
    if (next.role !== 'patient') return;
    setLoading(true);
    try { await refresh(); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }
  async function signOut() {
    setSigningOut(true); setError('');
    try {
      await request('/api/session', 'DELETE');
      setAccount(null); setDashboard(null); setPermissionsOpen(false);
    } catch (err) { setError(errorMessage(err)); } finally { setSigningOut(false); }
  }

  if (loading) return <main className="login-page"><LoaderCircle className="animate-spin" aria-label="Loading Trial Explorer" /></main>;
  if (!account) return error ? <main className="login-page"><div role="alert">{error}<Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>Retry</Button></div></main> : <Login onSignedIn={signedIn} />;
  const integration = dashboard?.integrations.find(app => app.id === 'trial-explorer');

  return <div className="min-h-screen"><header className="topbar"><a href="/" className="flex items-center gap-2"><ArrowLeft size={16} />CareVault</a><Button variant="ghost" size="sm" disabled={signingOut} onClick={signOut}><LogOut size={15} />Sign out</Button></header>
    <main className="main-content mx-auto max-w-6xl">
      {error && <p className="alert error" role="alert">{error}</p>}
      {account.role !== 'patient' ? <div className="empty-state"><ShieldCheck size={28} /><h1>Patient account required</h1><p>Sign out and use your patient account to open Trial Explorer.</p><Button asChild variant="outline" className="mt-4"><a href="/">Back to developer workspace</a></Button></div> : dashboard && integration ? <>
        <TrialExplorer key={integration.grant.version} integration={integration} requests={dashboard.trialRequests} memories={dashboard.memories} onPermissions={() => setPermissionsOpen(true)} onRefresh={refresh} permissionButtonRef={permissionButtonRef} />
        {permissionsOpen && <PermissionDialog onCloseAutoFocus={event => { event.preventDefault(); permissionButtonRef.current?.focus(); }} integration={integration} memories={dashboard.memories} onClose={() => setPermissionsOpen(false)} onSaved={async () => { await refresh(); setPermissionsOpen(false); }} />}
      </> : <div className="empty-state"><p>Trial Explorer is unavailable.</p><Button variant="outline" className="mt-4" onClick={async () => { setError(''); try { await refresh(); } catch (err) { setError(errorMessage(err)); } }}>Retry</Button></div>}
    </main>
  </div>;
}
