'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Check, KeyRound, LoaderCircle, MessageCircle, Settings2, ShieldCheck } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import type { ContextResponse, Integration } from '../../lib/types';
import { ContextPreview, errorMessage, request } from './shared';

interface ChatStatus { configured: boolean; model: string; integrationId: string; }
interface ChatReply { reply: string; model: string; context: ContextResponse; conversationId: string; historyReset: boolean; }
interface ChatMessage { role: 'user' | 'assistant'; text: string; context?: ContextResponse; model?: string; }
const prompts = ['Summarize the health information I have shared.', 'What care preferences are in my memory?', 'Help me prepare questions for my next visit.'];

export function Chat({ integration, onPermissions, onActivity }: { integration?: Integration; onPermissions: () => void; onActivity: () => Promise<unknown> }) {
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    request<ChatStatus>('/api/owner/chat/status').then(setStatus).catch(err => setError(errorMessage(err))).finally(() => setLoadingStatus(false));
  }, []);
  useEffect(() => { if (messages.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);
  async function configure(event: FormEvent) {
    event.preventDefault(); const key = apiKey; setApiKey(''); setSavingKey(true); setError('');
    try {
      setStatus(await request<ChatStatus>('/api/owner/chat/key', 'POST', { key }));
      setEditingKey(false); setNotice('API key configured on this server for the current session.');
    } catch (err) { setError(errorMessage(err)); } finally { setSavingKey(false); }
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy || !integration?.grant.connected || !status?.configured) return;
    setMessages(current => [...current, { role: 'user', text }]);
    setDraft(''); setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<ChatReply>('/api/owner/chat', 'POST', { message: text, conversationId });
      setConversationId(result.conversationId);
      setMessages(current => result.historyReset
        ? [{ role: 'user', text }, { role: 'assistant', text: result.reply, context: result.context, model: result.model }]
        : [...current, { role: 'assistant', text: result.reply, context: result.context, model: result.model }]);
      if (result.historyReset) setNotice('The conversation context was reset to use your current permissions.');
      await onActivity();
    } catch (err) { setError(errorMessage(err)); await onActivity().catch(() => {}); }
    finally { setBusy(false); }
  }
  const enabled = !!integration?.grant.connected && !!status?.configured && !loadingStatus;
  return <section className="chat-view">
    <div className="page-heading chat-heading"><div><h1>Health companion</h1><p>A conversation with the memory you choose to share.</p></div><Button variant="outline" size="sm" onClick={onPermissions} disabled={!integration}><Settings2 size={14} />{integration?.grant.connected ? 'Manage access' : 'Connect'}</Button></div>
    <div className="chat-status"><Badge variant="outline"><span className={`status-dot ${status?.configured ? 'ready' : ''}`} />{loadingStatus ? 'Checking model…' : status?.configured ? 'OpenRouter · free models' : 'Model not configured'}</Badge><span><ShieldCheck size={12} />{integration?.grant.connected ? 'Your saved permissions apply' : 'No memory access yet'}</span>{status?.configured && <button className="text-button" onClick={() => setEditingKey(current => !current)}>Change API key</button>}</div>
    {!loadingStatus && (!status?.configured || editingKey) && <Card className="setup-card"><CardContent><div className="setup-card-heading"><KeyRound size={17} /><div><h3>Connect a free model</h3><p>Use your OpenRouter API key. Free model availability varies.</p></div></div><form onSubmit={configure}><label htmlFor="openrouter-key">OpenRouter API key</label><div className="key-form"><Input id="openrouter-key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sk-or-…" required disabled={savingKey} /><Button type="submit" disabled={savingKey || !apiKey.trim()}>{savingKey ? 'Saving…' : 'Use key for this session'}</Button></div></form><p className="helper">Stored only on this local server until restart. <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Get an API key ↗</a></p></CardContent></Card>}
    {notice && <div className="alert success" role="status"><Check size={14} />{notice}</div>}
    {messages.length === 0 ? <div className="chat-welcome"><div className="chat-welcome-icon"><MessageCircle size={26} strokeWidth={1.5} /></div><h2>Start with what matters to you.</h2><p>Explore your synthetic health memory, organize information, and prepare questions for a clinician.</p>{!integration?.grant.connected && <Button onClick={onPermissions} disabled={!integration}>Choose what to share</Button>}<div className="prompt-list">{prompts.map(prompt => <button key={prompt} onClick={() => setDraft(prompt)}>{prompt}<ArrowUp size={14} /></button>)}</div></div> : <div className="chat-messages" aria-live="polite">{messages.map((item, index) => <article key={index} className={`chat-message ${item.role}`}><span className="message-author">{item.role === 'user' ? 'You' : 'Health companion'}</span><div className="message-text">{item.text}</div>{item.model && <p className="helper">Model: {item.model}</p>}{item.context && <details className="chat-context"><summary>Memory sent with this request · {item.context.items.length} items</summary><ContextPreview response={item.context} /></details>}</article>)}{busy && <div className="chat-thinking" role="status"><LoaderCircle size={15} className="animate-spin" />Preparing a reply…</div>}<div ref={end} /></div>}
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="chat-composer-area"><form className="chat-composer" onSubmit={send}><Textarea aria-label="Message health companion" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={enabled ? 'Ask about your shared health memory…' : 'Connect the app and configure a model to chat…'} rows={2} maxLength={2000} disabled={busy} /><div className="composer-footer"><span>Synthetic data only</span><Button type="submit" size="icon" aria-label="Send message" disabled={!enabled || busy || !draft.trim()}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={17} />}</Button></div></form><p className="chat-disclaimer">Your message and authorized memory go to OpenRouter and its selected model provider. Use synthetic information only. This demo does not diagnose or make clinical decisions.</p></div>
  </section>;
}
