'use strict';
const $ = (id) => document.getElementById(id);
let selected = new Set();
let described = new Map();
let draftId = null;
let busy = false;
let authorization = null;
const errors = {
  sign_in_required: 'The username or password was not accepted. Please sign in again.',
  access_denied: 'Access was denied. Check this app’s connection and permissions in CareVault.',
  record_not_shared: 'A selected record is no longer shared. Refresh and try again.',
  source_changed_run_again: 'The shared text changed. Refresh and create a new discussion.',
  selected_model_not_available_free: 'The configured model is unavailable or is no longer free. Check server configuration.',
  configure_openrouter_model_and_key: 'Configure the OpenRouter key and a free model on the app server.',
  upstream_unavailable: 'CareVault or the model provider is unavailable. Check the connection and try again.',
  context_too_large_select_fewer_records: 'The selected text is too long. Select fewer records.',
  record_has_no_text: 'A selected record has no extracted text. Select a text document.',
  incomplete_llm_report: 'The model did not finish a usable response. Try again.',
  invalid_llm_report: 'The model returned an unusable response. Try again.',
  draft_expired_run_again: 'This draft expired after 10 minutes. Create a new discussion.',
  save_outcome_unknown_check_carevault: 'The save outcome is uncertain. Check Records in CareVault before creating another report.',
};
let noticeTimer = 0;
function status(text, error = false) {
  window.clearTimeout(noticeTimer);
  const node = $('status');
  node.textContent = text;
  node.className = error ? 'error' : '';
  if (!text) return;
  noticeTimer = window.setTimeout(() => { if (node.textContent === text) { node.textContent = ''; node.className = ''; } }, 4200);
}
function resetDraft() { draftId = null; $('report').replaceChildren(); $('report').hidden = true; $('report-actions').hidden = true; $('empty').hidden = false; }
function shareGroup(record) {
  if (record.kind === 'report') return 'reports';
  if (record.kind === 'document' && record.mime === 'text/plain') return 'profile';
  return 'documents';
}
function shareLabel(record) {
  if (record.kind === 'report') return 'Unverified report';
  if (record.kind === 'document' && record.mime === 'text/plain') return 'Patient profile';
  if (record.mime === 'application/pdf') return 'PDF document';
  if (record.mime === 'image/png') return 'PNG image';
  if (record.mime === 'image/jpeg') return 'JPEG image';
  if (record.kind === 'image') return 'Image';
  return 'Document';
}
function shareDetail(record) {
  if (record.kind === 'document' && record.mime === 'text/plain') return 'Plain text shared';
  const allowed = record.allowed || {};
  const parts = [];
  if (allowed.text) parts.push('text');
  if (allowed.redacted) parts.push('redacted copy');
  if (allowed.original) parts.push('original file');
  if (!parts.length) return 'Shared';
  return `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `, ${parts.slice(1).join(', ')}` : ''} shared`;
}
function findMarker(text, from, marker) {
  for (let i = from; i <= text.length - marker.length; i++) {
    if (!text.startsWith(marker, i)) continue;
    if (marker === '*' && text.startsWith('**', i)) { i++; continue; }
    return i;
  }
  return -1;
}
function appendInlines(parent, text) {
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('`', i)) {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        const code = document.createElement('code');
        code.textContent = text.slice(i + 1, end);
        parent.append(code);
        i = end + 1;
        continue;
      }
    }
    const boldMarker = text.startsWith('**', i) ? '**' : text.startsWith('__', i) ? '__' : '';
    if (boldMarker) {
      const end = text.indexOf(boldMarker, i + 2);
      if (end > i + 2) {
        const strong = document.createElement('strong');
        appendInlines(strong, text.slice(i + 2, end));
        parent.append(strong);
        i = end + 2;
        continue;
      }
    }
    if (text.startsWith('*', i) && !text.startsWith('**', i)) {
      const end = findMarker(text, i + 1, '*');
      if (end > i + 1) {
        const em = document.createElement('em');
        appendInlines(em, text.slice(i + 1, end));
        parent.append(em);
        i = end + 1;
        continue;
      }
    }
    let j = i + 1;
    while (j < text.length && text[j] !== '`' && text[j] !== '*' && text[j] !== '_') j++;
    parent.append(document.createTextNode(text.slice(i, j)));
    i = j;
  }
}
function renderMarkdown(container, source) {
  container.replaceChildren();
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const heading = /^(#{1,6})[ \t]+(\S.*)$/;
  const bullet = /^[-*][ \t]+\S/;
  const numbered = /^(\d{1,3})\.[ \t]+\S/;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const headingMatch = heading.exec(line);
    if (headingMatch) {
      const el = document.createElement(`h${Math.min(headingMatch[1].length + 2, 6)}`);
      appendInlines(el, headingMatch[2].trim());
      container.append(el);
      i++;
      continue;
    }
    if (bullet.test(line)) {
      const list = document.createElement('ul');
      while (i < lines.length && bullet.test(lines[i])) {
        const li = document.createElement('li');
        appendInlines(li, lines[i].replace(/^[-*][ \t]+/, ''));
        list.append(li);
        i++;
      }
      container.append(list);
      continue;
    }
    const ordered = numbered.exec(line);
    if (ordered) {
      const list = document.createElement('ol');
      const start = Number(ordered[1]);
      if (start !== 1) list.start = start;
      while (i < lines.length && numbered.test(lines[i])) {
        const li = document.createElement('li');
        appendInlines(li, lines[i].replace(/^\d{1,3}\.[ \t]+/, ''));
        list.append(li);
        i++;
      }
      container.append(list);
      continue;
    }
    const block = [];
    while (i < lines.length && lines[i].trim() && !heading.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) {
      block.push(lines[i]);
      i++;
    }
    const paragraph = document.createElement('p');
    block.forEach((part, index) => {
      if (index) paragraph.append(document.createTextNode('\n'));
      appendInlines(paragraph, part);
    });
    container.append(paragraph);
  }
}
function recordOption(record) {
  const label = document.createElement('label');
  label.className = 'record';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = record.id;
  const text = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = shareLabel(record);
  const detail = document.createElement('small');
  detail.textContent = shareDetail(record);
  text.append(title, detail);
  label.append(checkbox, text);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked && selected.size >= 10) { checkbox.checked = false; status('Select at most 10 records.', true); return; }
    checkbox.checked ? selected.add(record.id) : selected.delete(record.id);
    resetDraft(); resetContext(); status(''); controls();
  });
  return label;
}
function showTab(tabs, panels, index) {
  tabs.forEach((tab, tabIndex) => {
    const selectedTab = tabIndex === index;
    tab.setAttribute('aria-selected', selectedTab ? 'true' : 'false');
    tab.tabIndex = selectedTab ? 0 : -1;
    panels[tabIndex].hidden = !selectedTab;
  });
}
function resetContext() { $('context').replaceChildren(); if ($('preview-dialog').open) $('preview-dialog').close(); }
function controls() {
  for (const control of document.querySelectorAll('button, input')) control.disabled = busy;
  $('preview').disabled = busy || !selected.size;
  $('generate').disabled = busy || !selected.size;
  $('save').disabled = busy || !draftId;
}
async function api(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', headers: { Authorization: authorization || '', 'X-Requested-With': 'CareVaultDemo', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (response.status === 401) signOut();
  if (!response.ok) throw new Error(errors[result.error] || 'The request could not be completed. Refresh and try again.');
  return result;
}
async function action(task) {
  if (busy) return;
  busy = true; controls();
  try { await task(); }
  catch (error) { resetDraft(); resetContext(); status(error.message, true); }
  finally { busy = false; controls(); }
}
async function refresh() {
  resetDraft(); resetContext(); selected = new Set(); described = new Map();
  $('records').replaceChildren();
  const { records } = await api('/api/records');
  if (!records.length) {
    const message = document.createElement('p'); message.className = 'muted';
    message.textContent = 'No shared records';
    $('records').append(message);
    status('');
    return;
  }
  const groups = [
    { id: 'profile', label: 'Patient Info', empty: 'No patient profile shared', records: [] },
    { id: 'documents', label: 'Documents', empty: 'No documents shared', records: [] },
    { id: 'reports', label: 'Reports', empty: 'No reports shared', records: [] },
  ];
  for (const record of records) {
    described.set(record.id, record);
    groups.find((group) => group.id === shareGroup(record)).records.push(record);
  }
  const visible = groups.filter((group) => group.id !== 'reports' || group.records.length);
  const tabs = [];
  const panels = [];
  const tablist = document.createElement('div');
  tablist.className = 'tabs';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Shared information');
  visible.forEach((group) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.id = `tab-${group.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `panel-${group.id}`);
    tab.textContent = group.label;
    const panel = document.createElement('div');
    panel.className = 'record-panel';
    panel.id = `panel-${group.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    if (!group.records.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = group.empty;
      panel.append(empty);
    }
    for (const record of group.records) panel.append(recordOption(record));
    tab.addEventListener('click', () => showTab(tabs, panels, tabs.indexOf(tab)));
    tab.addEventListener('keydown', (event) => {
      const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: tabs.length - 1 };
      if (!(event.key in keys)) return;
      event.preventDefault();
      const next = event.key === 'Home' || event.key === 'End' ? keys[event.key] : (tabs.indexOf(tab) + keys[event.key] + tabs.length) % tabs.length;
      showTab(tabs, panels, next);
      tabs[next].focus();
    });
    tabs.push(tab);
    panels.push(panel);
    tablist.append(tab);
  });
  const initial = Math.max(0, visible.findIndex((group) => group.records.length));
  showTab(tabs, panels, initial);
  $('records').append(tablist, ...panels);
  status('');
}
$('refresh').addEventListener('click', () => action(refresh));
$('close-preview').addEventListener('click', () => $('preview-dialog').close());
$('preview').addEventListener('click', () => action(async () => {
  const { context } = await api('/api/context', { recordIds: [...selected] });
  $('context').replaceChildren();
  context.forEach((source) => { const heading = document.createElement('h3'); const text = document.createElement('pre'); const record = described.get(source.recordId); heading.textContent = record ? shareLabel(record) : 'Shared text'; text.textContent = source.text; $('context').append(heading, text); });
  if (!$('preview-dialog').open) $('preview-dialog').showModal(); status('');
}));
$('generate').addEventListener('click', () => action(async () => {
  resetDraft(); status('Creating discussion…');
  const result = await api('/api/analyze', { recordIds: [...selected] });
  draftId = result.draftId; renderMarkdown($('report'), result.report); $('report').hidden = false; $('empty').hidden = true; $('report-actions').hidden = false;
  status('Draft ready.'); $('report').focus();
}));
$('save').addEventListener('click', () => action(async () => {
  status('Saving report to CareVault…');
  await api('/api/save', { draftId }); draftId = null;
  status('Saved to CareVault · Unshared.'); $('report-actions').hidden = true;
}));
function signOut() {
  authorization = null; selected = new Set(); described = new Map(); resetDraft(); resetContext();
  $('records').replaceChildren(); $('password').value = ''; $('username').value = '';
  $('workspace').hidden = true; $('login-panel').hidden = false; $('logout').hidden = true;
}
$('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;
  const bytes = new TextEncoder().encode(`${$('username').value}:${$('password').value}`);
  authorization = 'Basic ' + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  $('password').value = '';
  action(async () => {
    await api('/api/session');
    $('login-panel').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
    await refresh();
  });
});
$('logout').addEventListener('click', () => { signOut(); status('Signed out.'); controls(); $('username').focus(); });
controls();
