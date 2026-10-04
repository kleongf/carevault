'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { errorMessage, request } from './shared';

type Account = { id: string; username: string; role: 'patient' | 'developer' };

export function Login({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request<{ account: Account }>('/api/session', 'POST', { username, password });
      setPassword('');
      onSignedIn(result.account);
    } catch (err) { setPassword(''); setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  return <main className="login-page"><Card className="login-card"><CardContent>
    <div className="brand"><span className="brand-mark"><ShieldCheck size={20} /></span>CareVault</div>
    <h1>Welcome back</h1><p>Sign in to your patient or developer account.</p>
    <form onSubmit={signIn}>
      <label htmlFor="username">Username</label><Input id="username" name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} maxLength={64} disabled={busy} required autoFocus />
      <div className="mt-4"><label htmlFor="password">Password</label><Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={256} disabled={busy} required /></div>
      {error && <p className="alert error" role="alert">{error}</p>}
      <Button type="submit" disabled={busy} className="full-width">{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></Button>
    </form>
    <Badge variant="outline">Synthetic-data demo</Badge>
  </CardContent></Card></main>;
}
