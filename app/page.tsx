'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Login } from '../components/carevault/login';
import { DeveloperWorkspace } from '../components/carevault/developer';
import { PatientWorkspace } from '../components/carevault/patient';
import { request, RequestError, errorMessage } from '../components/carevault/shared';

type Account = { id: string; username: string; role: 'patient' | 'developer' };
export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    request<{ account: Account }>('/api/session').then(result => setAccount(result.account)).catch(err => {
      if (!(err instanceof RequestError) || err.status !== 401) setError(errorMessage(err));
    }).finally(() => setLoading(false));
  }, []);
  async function signOut() { await request('/api/session', 'DELETE'); setAccount(null); }
  if (loading) return <main className="login-page"><LoaderCircle className="animate-spin" aria-label="Loading CareVault" /></main>;
  if (error) return <main className="login-page"><div role="alert">{error}<button className="text-button block mt-4" onClick={() => window.location.reload()}>Retry</button></div></main>;
  if (!account) return <Login onSignedIn={setAccount} />;
  return account.role === 'developer'
    ? <DeveloperWorkspace username={account.username} onSignOut={signOut} />
    : <PatientWorkspace onSignOut={signOut} />;
}
