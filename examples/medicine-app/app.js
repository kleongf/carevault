'use strict';
const $ = (id) => document.getElementById(id);
let selected = new Set();
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
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function resetDraft() { draftId = null; $('report').textContent = ''; $('report').hidden = true; $('report-actions').hidden = true; $('empty').hidden = false; }
function resetContext() { $('context').replaceChildren(); $('context-panel').hidden = true; }
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
  resetDraft(); resetContext(); selected = new Set();
  $('records').replaceChildren();
  const { records } = await api('/api/records');
  if (!records.length) {
    const message = document.createElement('p'); message.className = 'muted';
    message.textContent = 'No shared records';
    $('records').append(message);
  }
  records.forEach((record, index) => {
    const label = document.createElement('label'); label.className = 'record';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = record.id;
    const text = document.createElement('span'); const title = document.createElement('strong');
    title.textContent = `${record.kind === 'report' ? 'Report' : 'Record'} ${index + 1}`; label.title = record.id; text.append(title); label.append(checkbox, text); $('records').append(label);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selected.size >= 10) { checkbox.checked = false; status('Select at most 10 records.', true); return; }
      checkbox.checked ? selected.add(record.id) : selected.delete(record.id);
      resetDraft(); resetContext(); status(''); controls();
    });
  });
  status('');
}
$('refresh').addEventListener('click', () => action(refresh));
$('preview').addEventListener('click', () => action(async () => {
  const { context } = await api('/api/context', { recordIds: [...selected] });
  $('context').replaceChildren();
  context.forEach((source) => { const heading = document.createElement('h3'); const text = document.createElement('pre'); heading.textContent = source.recordId; text.textContent = source.text; $('context').append(heading, text); });
  $('context-panel').hidden = false; $('context-panel').open = true; status('');
}));
$('generate').addEventListener('click', () => action(async () => {
  resetDraft(); status('Creating discussion…');
  const result = await api('/api/analyze', { recordIds: [...selected] });
  draftId = result.draftId; $('report').textContent = result.report; $('report').hidden = false; $('empty').hidden = true; $('report-actions').hidden = false;
  status('Draft ready.'); $('report').focus();
}));
$('save').addEventListener('click', () => action(async () => {
  status('Saving report to CareVault…');
  await api('/api/save', { draftId }); draftId = null;
  status('Saved to CareVault · Unshared.'); $('report-actions').hidden = true;
}));
function signOut() {
  authorization = null; selected = new Set(); resetDraft(); resetContext();
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
