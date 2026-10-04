const $ = id => document.getElementById(id);
let records = [], draftId = null, previewUrl = null, selectionVersion = 0;
let authorization = '', session = new AbortController(), signingIn = false;
const messages = {sign_in_required:'Incorrect username or password. Please sign in again.',image_not_shared:'This image is no longer shared. Refresh the list.',access_denied:'CareVault denied access. Check the app connection and permissions.',selected_model_price_limit: 'The selected model is unavailable or exceeds the configured price limit.', selected_model_not_available_free:'The selected language model is unavailable or is no longer free.',configure_openrouter_model_and_key:'Configure the language model and API key on this app’s server.',inference_unavailable_check_local_weights_and_dependencies:'The local classifier is not ready. Check its dependencies and model weights.',save_outcome_unknown_check_carevault:'The save result is uncertain. Check your vault before creating another report.'};

function boundary(text, index) {
  return index < 0 || index >= text.length || /[^\w]/.test(text[index]);
}
function closedSpan(text, start, marker) {
  if (!text.startsWith(marker, start)) return null;
  const single = marker === '*' || marker === '_';
  if (single && !boundary(text, start - 1)) return null;
  const contentStart = start + marker.length;
  const lead = text[contentStart];
  if (lead === undefined || /\s/.test(lead)) return null;
  let end = text.indexOf(marker, contentStart);
  while (end !== -1) {
    const content = text.slice(contentStart, end);
    const trail = content[content.length - 1];
    const after = end + marker.length;
    if (content && !content.includes('\n') && trail && !/\s/.test(trail) && (!single || boundary(text, after))) {
      return {tag: single ? 'em' : 'strong', content, next: after};
    }
    if (!single) return null;
    end = text.indexOf(marker, end + 1);
  }
  return null;
}
function inlineToken(text, start) {
  if (text.startsWith('`', start)) {
    const end = text.indexOf('`', start + 1);
    if (end > start + 1 && !text.slice(start + 1, end).includes('\n')) return {tag: 'code', content: text.slice(start + 1, end), next: end + 1};
    return null;
  }
  return closedSpan(text, start, '**') || closedSpan(text, start, '__') || closedSpan(text, start, '*') || closedSpan(text, start, '_');
}
function appendPlain(parent, value) {
  String(value).split('\n').forEach((part, index) => {
    if (index) parent.append(document.createElement('br'));
    if (part) parent.append(document.createTextNode(part));
  });
}
function appendInline(parent, text) {
  let index = 0;
  while (index < text.length) {
    const token = inlineToken(text, index);
    if (!token || token.next <= index) {
      const nextSpecial = text.slice(index + 1).search(/[`*_]/);
      const end = nextSpecial === -1 ? text.length : index + 1 + nextSpecial;
      appendPlain(parent, text.slice(index, end));
      index = end;
      continue;
    }
    const el = document.createElement(token.tag);
    if (token.tag === 'code') el.textContent = token.content;
    else appendInline(el, token.content);
    parent.append(el);
    index = token.next;
  }
}
function renderBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const headingPattern = /^(#{1,6})\s+(\S.*)$/;
  const listPattern = /^(\s*)([-*+]|\d+[.)])\s+(\S.*)$/;
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    const heading = headingPattern.exec(lines[index]);
    if (heading) {
      const el = document.createElement('h' + Math.min(heading[1].length + 2, 6));
      appendInline(el, heading[2]);
      blocks.push(el);
      index += 1;
      continue;
    }
    const list = listPattern.exec(lines[index]);
    if (list) {
      const ordered = /^\d/.test(list[2]);
      const el = document.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const item = listPattern.exec(lines[index]);
        if (!item || /^\d/.test(item[2]) !== ordered) break;
        const li = document.createElement('li');
        appendInline(li, item[3]);
        el.append(li);
        index += 1;
      }
      blocks.push(el);
      continue;
    }
    const parts = [];
    while (index < lines.length && lines[index].trim() && !headingPattern.test(lines[index]) && !listPattern.test(lines[index])) {
      parts.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendInline(paragraph, parts.join('\n'));
    blocks.push(paragraph);
  }
  return blocks;
}
function renderReport(markdown) {
  const root = $('report');
  root.replaceChildren(...renderBlocks(markdown));
  const visible = root.childNodes.length > 0;
  root.hidden = !visible;
  $('report-empty').hidden = visible;
}
function clearDraft() {
  draftId = null;
  renderReport('');
  $('save').disabled = true;
}
let noticeTimer = 0;
function showNotice(node, text, error = false) {
  window.clearTimeout(noticeTimer);
  node.textContent = text;
  node.className = error ? 'error' : '';
  if (!text) return;
  noticeTimer = window.setTimeout(() => { if (node.textContent === text) { node.textContent = ''; node.className = ''; } }, 4200);
}
function status(text, error = false) { showNotice($('status'), text, error); }
function clearSession() {
  session.abort(); session = new AbortController(); authorization = ''; selectionVersion++;
  records = [];
  if(previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null; $('preview').removeAttribute('src'); $('preview').hidden = true;
  clearDraft(); $('image').replaceChildren(); $('variant').replaceChildren();
  $('password').value = ''; showNotice($('login-error'), ''); status('');
  $('sign-out').hidden = true; $('workspace').hidden = true; $('login').hidden = false;
}
function showError(error) { if(error.name !== 'AbortError' && authorization) status(error.message, true); }
async function api(path, body, image = false) {
  const active = session;
  const response = await fetch(path, {method:body ? 'POST' : 'GET',credentials:'omit',cache:'no-store',signal:active.signal,headers:{Authorization:authorization,'X-Requested-With':'CareVaultDemo',...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  const result = response.ok && image ? await response.blob() : await response.json();
  if(active !== session || active.signal.aborted) throw new DOMException('Session ended','AbortError');
  if (!response.ok) {
    const error = new Error(messages[result.error] || result.error?.replaceAll('_',' ') || 'Request failed.');
    if(response.status === 401) { clearSession(); showNotice($('login-error'), error.message, true); }
    throw error;
  }
  return result;
}
async function refresh() {
  try {
    records = (await api('/api/records')).records;
    $('image').replaceChildren();
    records.forEach((record,index) => { const option=document.createElement('option'); option.value=record.id; option.textContent=`Shared image ${index+1} · ${record.id.slice(0,8)}`; $('image').append(option); });
    if (!records.length) { const option=document.createElement('option'); option.value=''; option.textContent='No images shared'; $('image').append(option); }
    await selectImage(); if(authorization) status('');
  } catch(error) { showError(error); }
}
async function selectImage() {
  clearDraft(); $('variant').replaceChildren();
  const record=records.find(record=>record.id===$('image').value);
  for(const value of record?.variants || []) { const option=document.createElement('option'); option.value=value; option.textContent=value==='original'?'Original image':'Redacted image'; $('variant').append(option); }
  $('analyze').disabled=!record;
  await preview();
}
async function preview() {
  const version=++selectionVersion; $('preview').hidden=true;
  if(previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl=null; }
  if(!$('image').value || !$('variant').value) return;
  try { const blob=await api(`/api/image?id=${encodeURIComponent($('image').value)}&variant=${encodeURIComponent($('variant').value)}`,undefined,true); if(version!==selectionVersion)return; previewUrl=URL.createObjectURL(blob); $('preview').src=previewUrl; $('preview').hidden=false; }
  catch(error) { showError(error); }
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault(); if(signingIn)return; signingIn=true; $('sign-in').disabled=true;
  const bytes=new TextEncoder().encode(`${$('username').value}:${$('password').value}`);
  clearSession(); authorization='Basic '+btoa(String.fromCharCode(...bytes));
  try { await api('/api/session'); $('login').hidden=true; $('workspace').hidden=false; $('sign-out').hidden=false; await refresh(); }
  catch(error) { if(error.name!=='AbortError') { clearSession(); showNotice($('login-error'), error.message, true); } }
  finally { signingIn=false; $('sign-in').disabled=false; }
});
$('sign-out').addEventListener('click',()=>{clearSession(); $('username').focus();});
$('refresh').addEventListener('click',refresh); $('image').addEventListener('change',selectImage);
$('variant').addEventListener('change',()=>{clearDraft(); preview();});
$('analyze').addEventListener('click',async()=>{
  $('analyze').disabled=true; $('refresh').disabled=true; $('image').disabled=true; $('variant').disabled=true; clearDraft();
  status('Running classifier and drafting the report…');
  try {
    const result=await api('/api/analyze',{recordId:$('image').value,variant:$('variant').value});
    draftId=result.draftId; renderReport(result.report); $('save').disabled=false; status('Report ready.');
    if(!$('report').hidden) $('report').focus();
  }
  catch(error) {showError(error);}
  finally { $('analyze').disabled=!records.length; $('refresh').disabled=false; $('image').disabled=false; $('variant').disabled=false; }
});
$('save').addEventListener('click',async()=>{
  if(!draftId)return; $('save').disabled=true; status('Saving report…');
  try {await api('/api/save',{draftId}); status('Saved to CareVault. The new report is unshared.');}
  catch(error) {showError(error);}
});
