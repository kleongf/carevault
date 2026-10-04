const $ = id => document.getElementById(id);
let records = [], draftId = null, previewUrl = null, selectionVersion = 0;
let authorization = '', session = new AbortController(), signingIn = false;
const messages = {sign_in_required:'Incorrect username or password. Please sign in again.',image_not_shared:'This image is no longer shared. Refresh the list.',access_denied:'CareVault denied access. Check the app connection and permissions.',selected_model_not_available_free:'The selected language model is unavailable or is no longer free.',configure_openrouter_model_and_key:'Configure the language model and API key on this app’s server.',inference_unavailable_check_local_weights_and_dependencies:'The local classifier is not ready. Check its dependencies and model weights.',save_outcome_unknown_check_carevault:'The save result is uncertain. Check your vault before creating another report.'};
function status(text) { $('status').textContent = text; }
function clearSession() {
  session.abort(); session = new AbortController(); authorization = ''; selectionVersion++;
  records = []; draftId = null;
  if(previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null; $('preview').removeAttribute('src'); $('preview').hidden = true;
  $('report').textContent = ''; $('result').hidden = true; $('image').replaceChildren(); $('variant').replaceChildren();
  $('password').value = ''; $('login-error').textContent = ''; status('');
  $('workspace').hidden = true; $('login').hidden = false;
}
function showError(error) { if(error.name !== 'AbortError' && authorization) status(error.message); }
async function api(path, body, image = false) {
  const active = session;
  const response = await fetch(path, {method:body ? 'POST' : 'GET',credentials:'omit',cache:'no-store',signal:active.signal,headers:{Authorization:authorization,'X-Requested-With':'CareVaultDemo',...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  const result = response.ok && image ? await response.blob() : await response.json();
  if(active !== session || active.signal.aborted) throw new DOMException('Session ended','AbortError');
  if (!response.ok) {
    const error = new Error(messages[result.error] || result.error?.replaceAll('_',' ') || 'Request failed.');
    if(response.status === 401) { clearSession(); $('login-error').textContent = error.message; }
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
  draftId=null; $('report').textContent=''; $('result').hidden=true; $('variant').replaceChildren();
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
  try { await api('/api/session'); $('login').hidden=true; $('workspace').hidden=false; await refresh(); }
  catch(error) { if(error.name!=='AbortError') { clearSession(); $('login-error').textContent=error.message; } }
  finally { signingIn=false; $('sign-in').disabled=false; }
});
$('sign-out').addEventListener('click',()=>{clearSession(); $('username').focus();});
$('refresh').addEventListener('click',refresh); $('image').addEventListener('change',selectImage);
$('variant').addEventListener('change',()=>{draftId=null; $('report').textContent=''; $('result').hidden=true; preview();});
$('analyze').addEventListener('click',async()=>{
  $('analyze').disabled=true; $('refresh').disabled=true; $('image').disabled=true; $('variant').disabled=true; $('result').hidden=true; draftId=null;
  status('Running classifier and drafting the report…');
  try { const result=await api('/api/analyze',{recordId:$('image').value,variant:$('variant').value}); draftId=result.draftId; $('report').textContent=result.report; $('save').disabled=false; $('result').hidden=false; status('Report ready.'); }
  catch(error) {showError(error);}
  finally { $('analyze').disabled=!records.length; $('refresh').disabled=false; $('image').disabled=false; $('variant').disabled=false; }
});
$('save').addEventListener('click',async()=>{
  if(!draftId)return; $('save').disabled=true; status('Saving report…');
  try {await api('/api/save',{draftId}); status('Saved to CareVault. The new report is unshared.');}
  catch(error) {showError(error);}
});
