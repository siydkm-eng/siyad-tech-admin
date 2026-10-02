/* Siyad Tech Admin — vanilla JS, no dependencies.
   All data lives in GitHub repos; writes go through the GitHub Contents API. */
'use strict';

/* ---------- config ---------- */
const DATA_REPO  = 'siydkm-eng/siyad-tech-data';
const MEDIA_REPO = 'siydkm-eng/siyad-tech-media';
const RAW_BASE   = 'https://raw.githubusercontent.com/' + MEDIA_REPO + '/main/';
const LS_PIN     = 'st_admin_pin';
const LS_TOKEN   = 'st_admin_token';
const SS_UNLOCK  = 'st_admin_unlocked';

const DATA_FILES = {
  videos:   'videos.json',
  tips:     'tricks.json',
  products: 'products.json',
  news:     'news.json',
  newsedits:'news-edits.json',
  blocklist:'blocklist.json'
};
const MEDIA_FOLDERS = { videos:'thumbnails/videos/', tips:'thumbnails/tricks/',
                        products:'thumbnails/products/', news:'thumbnails/news/' };

/* ---------- tiny utils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function toast(msg, kind){
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s';
    setTimeout(() => t.remove(), 320); }, 3200);
}
function b64ToUtf8(b64){
  const bin = atob(String(b64).replace(/\s/g,''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function utf8ToB64(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
const nowIso = () => new Date().toISOString();
const nextId = list => list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

function shortcodeFromUrl(url){
  const m = String(url || '').match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

/* ---------- PIN gate ---------- */
function gateShowError(msg){
  const e = $('#gate-err');
  e.textContent = msg; e.hidden = false;
}
function initGate(){
  const gate = $('#pin-gate');
  if (sessionStorage.getItem(SS_UNLOCK) === '1'){ gate.hidden = true; $('#app').hidden = false; return; }
  gate.hidden = false; $('#app').hidden = true;
  const hasPin = !!localStorage.getItem(LS_PIN);
  $('#gate-set').hidden = hasPin;
  $('#gate-enter').hidden = !hasPin;
  $('#gate-sub').textContent = hasPin ? 'തുടരാൻ PIN അടിക്കുക' : 'ആദ്യമായാണ് — ഒരു PIN സെറ്റ് ചെയ്യുക';
}
function trySetPin(){
  const a = $('#pin-new').value.trim(), b = $('#pin-confirm').value.trim();
  if (!/^\d{4,}$/.test(a)){ gateShowError('PIN കുറഞ്ഞത് 4 അക്കം വേണം'); return; }
  if (a !== b){ gateShowError('രണ്ട് PIN-ഉം ഒന്നല്ല'); return; }
  localStorage.setItem(LS_PIN, a);
  sessionStorage.setItem(SS_UNLOCK, '1');
  initGate(); toast('PIN സെറ്റ് ചെയ്തു', 'ok'); boot();
}
function tryUnlock(){
  if ($('#pin-input').value === localStorage.getItem(LS_PIN)){
    sessionStorage.setItem(SS_UNLOCK, '1');
    initGate(); boot();
  } else gateShowError('തെറ്റായ PIN');
}

/* ---------- GitHub API ---------- */
function token(){ return (localStorage.getItem(LS_TOKEN) || '').trim(); }
function needToken(){
  if (!token()){
    toast('GitHub token ചേർക്കുക (Settings)', 'err');
    switchTab('settings');
    return true;
  }
  return false;
}
async function ghApi(method, path, body){
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token(),
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 404) { const e = new Error('not-found'); e.is404 = true; throw e; }
  if (!res.ok){
    const t = await res.text().catch(() => '');
    throw new Error('GitHub ' + res.status + ' ' + t.slice(0, 160));
  }
  return res.status === 204 ? null : res.json();
}
/* data file cache: { sha, data } */
const cache = {};
async function loadDataFile(key){
  if (cache[key]) return cache[key];
  const path = DATA_FILES[key];
  try {
    const j = await ghApi('GET', '/repos/' + DATA_REPO + '/contents/' + path);
    cache[key] = { sha: j.sha, data: JSON.parse(b64ToUtf8(j.content)) };
  } catch(e){
    if (e.is404){ cache[key] = { sha: null, data: null }; }
    else throw e;
  }
  return cache[key];
}
async function saveDataFile(key, data, message){
  const path = DATA_FILES[key];
  const entry = cache[key] || { sha: null };
  const body = { message, content: utf8ToB64(JSON.stringify(data, null, 2)) };
  if (entry.sha) body.sha = entry.sha;
  const j = await ghApi('PUT', '/repos/' + DATA_REPO + '/contents/' + path, body);
  cache[key] = { sha: j.content.sha, data };
  return j;
}
/* media upload -> returns raw URL */
async function uploadMedia(folderKey, filename, file){
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
  const base64 = String(dataUrl).split(',')[1];
  const path = MEDIA_FOLDERS[folderKey] + filename;
  let sha = null;
  try { const j = await ghApi('GET', '/repos/' + MEDIA_REPO + '/contents/' + path); sha = j.sha; }
  catch(e){ if (!e.is404) throw e; }
  const body = { message: 'Upload ' + path, content: base64 };
  if (sha) body.sha = sha;
  await ghApi('PUT', '/repos/' + MEDIA_REPO + '/contents/' + path, body);
  return RAW_BASE + path;
}
const extOf = name => (String(name).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';

/* ---------- tab shell ---------- */
let activeTab = 'videos';
function switchTab(t){
  activeTab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  render();
}
async function render(){
  const el = $('#tab-content');
  try {
    if (activeTab === 'videos')   await renderVideos(el);
    if (activeTab === 'tips')     await renderTips(el);
    if (activeTab === 'products') await renderProducts(el);
    if (activeTab === 'news')     await renderNews(el);
    if (activeTab === 'settings') renderSettings(el);
  } catch(e){
    el.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  }
}
const head = (title, count, addLabel, addFn) =>
  '<div class="sec-head"><h2>' + esc(title) + '</h2>' +
  '<span class="row-flex"><span class="count-chip">' + count + '</span>' +
  (addLabel ? '<button class="btn small primary" id="add-btn">' + esc(addLabel) + '</button>' : '') +
  '</span></div>';

/* ---------- Videos ---------- */
async function renderVideos(el){
  if (needToken()) return;
  el.innerHTML = '<div class="loading">ലോഡ് ചെയ്യുന്നു…</div>';
  const { data } = await loadDataFile('videos');
  const list = Array.isArray(data) ? data : [];
  el.innerHTML = head('വീഡിയോകൾ', list.length, '＋ ചേർക്കുക') +
    (list.length ? '' : '<div class="empty">വീഡിയോകളില്ല</div>') +
    list.slice().reverse().map(v =>
      '<div class="card glass"><img class="thumb" loading="lazy" src="' + esc(v.thumbnail_url || '') + '" onerror="this.style.opacity=.2">' +
      '<div class="c-body"><div class="c-title">' + esc(v.title) + '</div>' +
      '<div class="c-meta">#' + v.id + ' · ' + esc(v.model_tag || '-') + '</div></div>' +
      '<div class="c-actions"><button class="btn small" data-edit-v="' + v.id + '">എഡിറ്റ്</button>' +
      '<button class="btn small danger" data-del-v="' + v.id + '">✕</button></div></div>'
    ).join('');
  $('#add-btn').onclick = () => openVideoEditor(null);
  el.querySelectorAll('[data-edit-v]').forEach(b => b.onclick = () =>
    openVideoEditor(list.find(x => String(x.id) === b.dataset.editV)));
  el.querySelectorAll('[data-del-v]').forEach(b => b.onclick = () =>
    deleteItem('videos', list, b.dataset.delV, 'വീഡിയോ'));
}

function openVideoEditor(v){
  const isNew = !v;
  const item = v || {};
  const reservedId = isNew ? nextId(cache.videos.data || []) : item.id;
  openSheet('വീഡിയോ ' + (isNew ? 'ചേർക്കുക' : 'എഡിറ്റ് ചെയ്യുക'), `
    <label class="f-lbl">Instagram Reel URL</label>
    <input id="f-reel" placeholder="https://www.instagram.com/reel/…" value="${esc(item.reel_url || '')}">
    <label class="f-lbl">Title</label>
    <input id="f-title" value="${esc(item.title || '')}">
    <label class="f-lbl">Model Tag</label>
    <input id="f-tag" placeholder="ഉദാ: V80, X300" value="${esc(item.model_tag || '')}">
    <label class="f-lbl">Thumbnail</label>
    <div class="row-flex">
      <input id="f-thumb" placeholder="image URL" value="${esc(item.thumbnail_url || '')}">
      <label class="btn small" style="flex-shrink:0">📤<input id="f-upload" type="file" accept="image/*" hidden></label>
    </div>
    <img id="f-preview" class="preview" src="${esc(item.thumbnail_url || '')}" ${item.thumbnail_url ? '' : 'hidden'}>
    <div class="sheet-actions">
      <button class="btn" id="sheet-cancel">റദ്ദാക്കുക</button>
      <button class="btn primary" id="sheet-save">സേവ്</button>
    </div>`);
  $('#sheet-cancel').onclick = closeSheet;
  $('#f-thumb').oninput = e => { const p = $('#f-preview');
    p.src = e.target.value; p.hidden = !e.target.value; };
  $('#f-upload').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      toast('അപ്‌ലോഡ് ചെയ്യുന്നു…');
      const url = await uploadMedia('videos', reservedId + '.' + extOf(f.name), f);
      $('#f-thumb').value = url;
      const p = $('#f-preview'); p.src = url; p.hidden = false;
      toast('അപ്‌ലോഡ് OK', 'ok');
    } catch(err){ toast('അപ്‌ലോഡ് പരാജയം: ' + err.message, 'err'); }
  };
  $('#sheet-save').onclick = async () => {
    const reel = $('#f-reel').value.trim(), title = $('#f-title').value.trim();
    if (!reel || !title){ toast('Reel URL-ഉം Title-ഉം നിർബന്ധം', 'err'); return; }
    const list = cache.videos.data;
    const obj = Object.assign({}, item, {
      id: reservedId,
      title,
      reel_url: reel,
      shortcode: shortcodeFromUrl(reel) || item.shortcode || '',
      model_tag: $('#f-tag').value.trim(),
      thumbnail_url: $('#f-thumb').value.trim(),
      thumbnail_updated_at: $('#f-thumb').value.trim() !== (item.thumbnail_url || '') ? nowIso() : (item.thumbnail_updated_at || null),
      updated_at: nowIso()
    });
    if (isNew){ obj.created_at = nowIso(); obj.comments = []; obj.reactions = []; list.push(obj); }
    else Object.assign(list.find(x => x.id === reservedId), obj);
    await doSave('videos', list, 'വീഡിയോ സേവ് ചെയ്തു');
  };
}

/* ---------- Tips ---------- */
async function renderTips(el){
  if (needToken()) return;
  el.innerHTML = '<div class="loading">ലോഡ് ചെയ്യുന്നു…</div>';
  const { data } = await loadDataFile('tips');
  const list = Array.isArray(data) ? data : [];
  el.innerHTML = head('ടിപ്സ് & ട്രിക്സ്', list.length, '＋ ചേർക്കുക') +
    (list.length ? '' : '<div class="empty">ടിപ്സില്ല</div>') +
    list.slice().reverse().map(t =>
      '<div class="card glass"><img class="thumb" loading="lazy" src="' + esc(t.thumbnail_url || '') + '" onerror="this.style.opacity=.2">' +
      '<div class="c-body"><div class="c-title">' + esc(t.title) + '</div>' +
      '<div class="c-meta">#' + t.id + ' · ' + esc(t.model_tag || '-') + ' · 👁 ' + (t.view_count || 0) + '</div></div>' +
      '<div class="c-actions"><button class="btn small" data-edit-t="' + t.id + '">എഡിറ്റ്</button>' +
      '<button class="btn small danger" data-del-t="' + t.id + '">✕</button></div></div>'
    ).join('');
  $('#add-btn').onclick = () => openTipEditor(null);
  el.querySelectorAll('[data-edit-t]').forEach(b => b.onclick = () =>
    openTipEditor(list.find(x => String(x.id) === b.dataset.editT)));
  el.querySelectorAll('[data-del-t]').forEach(b => b.onclick = () =>
    deleteItem('tips', list, b.dataset.delT, 'ടിപ്'));
}

let tipGallery = [];
function openTipEditor(t){
  const isNew = !t;
  const item = t || {};
  const reservedId = isNew ? nextId(cache.tips.data || []) : item.id;
  tipGallery = (item.gallery_urls || []).slice();
  const renderChips = () => {
    $('#g-chips').innerHTML = tipGallery.map((u, i) =>
      '<span class="chip"><img src="' + esc(u) + '" onerror="this.remove()"><span>' +
      esc(u.length > 42 ? '…' + u.slice(-40) : u) +
      '</span><button data-gdel="' + i + '">✕</button></span>').join('') ||
      '<span class="muted">ഫോട്ടോകളില്ല</span>';
    $('#g-chips').querySelectorAll('[data-gdel]').forEach(b =>
      b.onclick = () => { tipGallery.splice(Number(b.dataset.gdel), 1); renderChips(); });
  };
  openSheet('ടിപ് ' + (isNew ? 'ചേർക്കുക' : 'എഡിറ്റ് ചെയ്യുക'), `
    <label class="f-lbl">Title</label>
    <input id="f-title" value="${esc(item.title || '')}">
    <label class="f-lbl">Category / Tag</label>
    <input id="f-tag" placeholder="ഉദാ: Camera, Battery" value="${esc(item.model_tag || '')}">
    <label class="f-lbl">വിശദമായ Steps</label>
    <textarea id="f-steps" placeholder="ഓരോ step-ഉം വരിവരിയായി…">${esc(item.steps || '')}</textarea>
    <label class="f-lbl">Thumbnail</label>
    <div class="row-flex">
      <input id="f-thumb" placeholder="image URL" value="${esc(item.thumbnail_url || '')}">
      <label class="btn small" style="flex-shrink:0">📤<input id="f-upload" type="file" accept="image/*" hidden></label>
    </div>
    <img id="f-preview" class="preview" src="${esc(item.thumbnail_url || '')}" ${item.thumbnail_url ? '' : 'hidden'}>
    <h4 class="sec">Gallery Photos (ഒന്നിലധികം)</h4>
    <div class="chips" id="g-chips"></div>
    <div class="row-flex" style="margin-top:8px">
      <input id="g-url" placeholder="photo URL ഒട്ടിക്കുക">
      <button class="btn small" id="g-addurl" style="flex-shrink:0">＋</button>
      <label class="btn small" style="flex-shrink:0">📤<input id="g-upload" type="file" accept="image/*" hidden></label>
    </div>
    <div class="sheet-actions">
      <button class="btn" id="sheet-cancel">റദ്ദാക്കുക</button>
      <button class="btn primary" id="sheet-save">സേവ്</button>
    </div>`);
  renderChips();
  $('#sheet-cancel').onclick = closeSheet;
  $('#f-thumb').oninput = e => { const p = $('#f-preview');
    p.src = e.target.value; p.hidden = !e.target.value; };
  const doUpload = async (file, toThumb) => {
    try {
      toast('അപ്‌ലോഡ് ചെയ്യുന്നു…');
      const n = toThumb ? reservedId + '.' + extOf(file.name)
                        : reservedId + '-g' + Date.now().toString(36) + '.' + extOf(file.name);
      const url = await uploadMedia('tips', n, file);
      if (toThumb){ $('#f-thumb').value = url;
        const p = $('#f-preview'); p.src = url; p.hidden = false; }
      else { tipGallery.push(url); renderChips(); }
      toast('അപ്‌ലോഡ് OK', 'ok');
    } catch(err){ toast('അപ്‌ലോഡ് പരാജയം: ' + err.message, 'err'); }
  };
  $('#f-upload').onchange = e => { if (e.target.files[0]) doUpload(e.target.files[0], true); };
  $('#g-upload').onchange = e => { if (e.target.files[0]) doUpload(e.target.files[0], false); };
  $('#g-addurl').onclick = () => { const u = $('#g-url').value.trim();
    if (u){ tipGallery.push(u); $('#g-url').value = ''; renderChips(); } };
  $('#sheet-save').onclick = async () => {
    const title = $('#f-title').value.trim();
    if (!title){ toast('Title നിർബന്ധം', 'err'); return; }
    const list = cache.tips.data;
    const obj = Object.assign({}, item, {
      id: reservedId,
      title,
      steps: $('#f-steps').value,
      model_tag: $('#f-tag').value.trim(),
      thumbnail_url: $('#f-thumb').value.trim(),
      gallery_urls: tipGallery,
      thumbnail_updated_at: $('#f-thumb').value.trim() !== (item.thumbnail_url || '') ? nowIso() : (item.thumbnail_updated_at || null),
      updated_at: nowIso()
    });
    if (isNew){ obj.view_count = 0; obj.created_at = nowIso(); obj.comments = []; obj.reactions = []; list.push(obj); }
    else Object.assign(list.find(x => x.id === reservedId), obj);
    await doSave('tips', list, 'ടിപ് സേവ് ചെയ്തു');
  };
}

/* ---------- Products ---------- */
async function renderProducts(el){
  if (needToken()) return;
  el.innerHTML = '<div class="loading">ലോഡ് ചെയ്യുന്നു…</div>';
  const { data } = await loadDataFile('products');
  const list = Array.isArray(data) ? data : [];
  el.innerHTML = head('ഫോൺ & ബഡ്സ്', list.length, '＋ ചേർക്കുക') +
    (list.length ? '' : '<div class="empty">ഒന്നുമില്ല</div>') +
    list.map(p =>
      '<div class="card glass"><img class="thumb" loading="lazy" src="' + esc(p.photo_url || '') + '" onerror="this.style.opacity=.2">' +
      '<div class="c-body"><div class="c-title">' + esc(p.name) + '</div>' +
      '<div class="c-meta">#' + p.id + ' · ' + esc(p.type || '') + (p.price ? ' · ₹' + esc(p.price) : '') + '</div></div>' +
      '<div class="c-actions"><button class="btn small" data-edit-p="' + p.id + '">എഡിറ്റ്</button>' +
      '<button class="btn small danger" data-del-p="' + p.id + '">✕</button></div></div>'
    ).join('');
  $('#add-btn').onclick = () => openProductEditor(null);
  el.querySelectorAll('[data-edit-p]').forEach(b => b.onclick = () =>
    openProductEditor(list.find(x => String(x.id) === b.dataset.editP)));
  el.querySelectorAll('[data-del-p]').forEach(b => b.onclick = () =>
    deleteItem('products', list, b.dataset.delP, 'ഉൽപ്പന്നം'));
}

let specRows = [];
function openProductEditor(p){
  const isNew = !p;
  const item = p || {};
  const reservedId = isNew ? nextId(cache.products.data || []) : item.id;
  specRows = (item.specs || []).map(s => ({ label: s.label || '', value: s.value || '' }));
  const renderSpecs = () => {
    $('#spec-list').innerHTML = specRows.map((s, i) =>
      '<div class="spec-row"><input data-sl="' + i + '" placeholder="Label (ഉദാ: Battery · Capacity)" value="' + esc(s.label) + '">' +
      '<input data-sv="' + i + '" placeholder="Value" value="' + esc(s.value) + '">' +
      '<button class="spec-del" data-sdel="' + i + '">✕</button></div>').join('');
    $('#spec-list').querySelectorAll('[data-sl]').forEach(inp =>
      inp.oninput = () => specRows[Number(inp.dataset.sl)].label = inp.value);
    $('#spec-list').querySelectorAll('[data-sv]').forEach(inp =>
      inp.oninput = () => specRows[Number(inp.dataset.sv)].value = inp.value);
    $('#spec-list').querySelectorAll('[data-sdel]').forEach(b =>
      b.onclick = () => { specRows.splice(Number(b.dataset.sdel), 1); renderSpecs(); });
  };
  openSheet('ഉൽപ്പന്നം ' + (isNew ? 'ചേർക്കുക' : 'എഡിറ്റ് ചെയ്യുക'), `
    <label class="f-lbl">പേര്</label>
    <input id="f-name" placeholder="ഉദാ: vivo X300" value="${esc(item.name || '')}">
    <div class="row-flex">
      <div style="flex:1"><label class="f-lbl">Type</label>
        <select id="f-type"><option ${item.type !== 'Buds' ? 'selected' : ''}>Phone</option><option ${item.type === 'Buds' ? 'selected' : ''}>Buds</option></select></div>
      <div style="flex:1"><label class="f-lbl">വില (₹)</label>
        <input id="f-price" inputmode="numeric" placeholder="ഒഴിവാക്കാം" value="${esc(item.price == null ? '' : item.price)}"></div>
    </div>
    <label class="f-lbl">Photo</label>
    <div class="row-flex">
      <input id="f-photo" placeholder="image URL" value="${esc(item.photo_url || '')}">
      <label class="btn small" style="flex-shrink:0">📤<input id="f-upload" type="file" accept="image/*" hidden></label>
    </div>
    <img id="f-preview" class="preview" src="${esc(item.photo_url || '')}" ${item.photo_url ? '' : 'hidden'}>
    <h4 class="sec">Specifications</h4>
    <div id="spec-list"></div>
    <button class="btn small" id="spec-add">＋ Spec വരി ചേർക്കുക</button>
    <div class="sheet-actions">
      <button class="btn" id="sheet-cancel">റദ്ദാക്കുക</button>
      <button class="btn primary" id="sheet-save">സേവ്</button>
    </div>`);
  renderSpecs();
  $('#sheet-cancel').onclick = closeSheet;
  $('#spec-add').onclick = () => { specRows.push({ label: '', value: '' }); renderSpecs(); };
  $('#f-photo').oninput = e => { const p = $('#f-preview');
    p.src = e.target.value; p.hidden = !e.target.value; };
  $('#f-upload').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      toast('അപ്‌ലോഡ് ചെയ്യുന്നു…');
      const url = await uploadMedia('products', reservedId + '.' + extOf(f.name), f);
      $('#f-photo').value = url;
      const p = $('#f-preview'); p.src = url; p.hidden = false;
      toast('അപ്‌ലോഡ് OK', 'ok');
    } catch(err){ toast('അപ്‌ലോഡ് പരാജയം: ' + err.message, 'err'); }
  };
  $('#sheet-save').onclick = async () => {
    const name = $('#f-name').value.trim();
    if (!name){ toast('പേര് നിർബന്ധം', 'err'); return; }
    const priceRaw = $('#f-price').value.trim();
    const list = cache.products.data;
    const obj = Object.assign({}, item, {
      id: reservedId,
      name,
      type: $('#f-type').value,
      price: priceRaw === '' ? null : priceRaw,
      photo_url: $('#f-photo').value.trim(),
      specs: specRows.filter(s => s.label.trim() || s.value.trim()),
      photo_updated_at: $('#f-photo').value.trim() !== (item.photo_url || '') ? nowIso() : (item.photo_updated_at || null),
      updated_at: nowIso()
    });
    if (isNew){ obj.created_at = nowIso(); list.push(obj); }
    else Object.assign(list.find(x => x.id === reservedId), obj);
    await doSave('products', list, 'സേവ് ചെയ്തു');
  };
}

/* ---------- News ---------- */
function newsKey(a){ return a.id || a.source_url || ''; }
function newsEditsMap(data){
  const e = (data && data.edits) || {};
  return (e && typeof e === 'object' && !Array.isArray(e)) ? e : {};
}
function effArticle(a, edits){
  const o = edits[newsKey(a)];
  if (!o) return a;
  return Object.assign({}, a, {
    title: o.title != null ? o.title : a.title,
    summary: o.summary != null ? o.summary : a.summary,
    content: o.content != null ? o.content : a.content,
    thumbnail_url: o.thumbnail_url != null ? o.thumbnail_url : a.thumbnail_url
  });
}
async function renderNews(el){
  if (needToken()) return;
  el.innerHTML = '<div class="loading">ലോഡ് ചെയ്യുന്നു…</div>';
  const [{ data: news }, bl, ed] = await Promise.all([
    loadDataFile('news'), loadDataFile('blocklist'), loadDataFile('newsedits')]);
  const articles = (news && news.articles) || [];
  const blocked = Array.isArray(bl.data) ? bl.data : [];
  const edits = newsEditsMap(ed.data);
  el.innerHTML =
    head('ന്യൂസ്', articles.length, null) +
    articles.map((a, i) => {
      const eff = effArticle(a, edits);
      const isEd = !!edits[newsKey(a)];
      const aUrl = a.source_url || a.id || '';
      const isBl = !!aUrl && blocked.some(u => u && aUrl.includes(u));
      return '<div class="card glass' + (isBl ? ' blocked' : '') + '">' +
      (eff.thumbnail_url ? '<img class="thumb" loading="lazy" src="' + esc(eff.thumbnail_url) + '" onerror="this.style.opacity=.2">' : '') +
      '<div class="c-body"><div class="c-title">' + esc(eff.title) + '</div>' +
      '<div class="c-meta">' + esc(a.source_name || '') + (isEd ? ' · <span class="ed-badge">✏️ Edited</span>' : '') + (isBl ? ' · <span class="bl-badge">🚫 Deleted</span>' : '') + '</div>' +
      (a.source_url ? '<div><span class="src-link">' + esc(a.source_url.slice(0, 60)) + '…</span></div>' : '') +
      '</div>' +
      '<div class="c-actions"><button class="btn small" data-edit-n="' + i + '">എഡിറ്റ്</button>' +
      (isBl
        ? '<button class="btn small" data-undel-n="' + i + '">↩ Restore</button>'
        : '<button class="btn small danger" data-del-n="' + i + '">🗑 Delete</button>') +
      '</div></div>';
    }).join('') +
    '<div class="divider"></div>' +
    '<div class="sec-head"><h2>Blocklist</h2><span class="count-chip">' + blocked.length + '</span></div>' +
    '<p class="muted">ഈ list-ലുള്ള URL ഉള്ള വാർത്തകൾ ഇനി ആപ്പിൽ വരില്ല. (ആപ്പ് server ഈ ഫയൽ വായിക്കും)</p>' +
    '<div class="chips" id="bl-chips">' +
      blocked.map((u, i) =>
        '<span class="chip"><span>' + esc(u.length > 48 ? '…' + u.slice(-46) : u) +
        '</span><button data-bldel="' + i + '">✕</button></span>').join('') +
    '</div>' +
    '<div class="row-flex" style="margin-top:10px">' +
      '<input id="bl-input" placeholder="block ചെയ്യേണ്ട URL / ഭാഗം">' +
      '<button class="btn small primary" id="bl-add" style="flex-shrink:0">＋</button>' +
    '</div>';
  el.querySelectorAll('[data-edit-n]').forEach(b => b.onclick = () =>
    openNewsEditor(articles[Number(b.dataset.editN)], edits));
  const save = async (arr, msg) => { await doSave('blocklist', arr, msg, false); render(); };
  el.querySelectorAll('[data-del-n]').forEach(b => b.onclick = async () => {
    const a = articles[Number(b.dataset.delN)];
    const u = a.source_url || a.id || '';
    if (!u) return;
    if (!confirm('ഈ വാർത്ത delete ചെയ്യണോ?\nആപ്പിൽ നിന്ന് മാഞ്ഞുപോകും. (Restore ചെയ്യാം)')) return;
    if (!blocked.includes(u)) blocked.push(u);
    await save(blocked, 'വാർത്ത delete ചെയ്തു');
  });
  el.querySelectorAll('[data-undel-n]').forEach(b => b.onclick = async () => {
    const a = articles[Number(b.dataset.undelN)];
    const u = a.source_url || a.id || '';
    const idx = blocked.indexOf(u);
    if (idx < 0){ toast('താഴെയുള്ള Blocklist-ൽ നിന്ന് നീക്കൂ', 'err'); return; }
    blocked.splice(idx, 1); await save(blocked, 'വാർത്ത restore ചെയ്തു');
  });
  $('#bl-add').onclick = async () => {
    const u = $('#bl-input').value.trim();
    if (!u) return;
    if (blocked.includes(u)){ toast('ഇത് നേരത്തേ ഉണ്ട്', 'err'); return; }
    blocked.push(u); await save(blocked, 'Blocklist-ൽ ചേർത്തു');
  };
  el.querySelectorAll('[data-bldel]').forEach(b => b.onclick = async () => {
    if (!confirm('ഇത് blocklist-ൽ നിന്ന് നീക്കണോ?')) return;
    blocked.splice(Number(b.dataset.bldel), 1); await save(blocked, 'Blocklist-ൽ നിന്ന് നീക്കി');
  });
}

function openNewsEditor(a, edits){
  const key = newsKey(a);
  const cur = edits[key] || {};
  const val = f => (cur[f] != null ? cur[f] : (a[f] || ''));
  const hasEdit = !!edits[key];
  const hash = (() => { let h = 0; for (let i = 0; i < key.length; i++){ h = (h * 31 + key.charCodeAt(i)) >>> 0; } return h.toString(16); })();
  openSheet('ന്യൂസ് എഡിറ്റ്', `
    <label class="f-lbl">Title</label>
    <input id="f-title" value="${esc(val('title'))}">
    <label class="f-lbl">Summary</label>
    <textarea id="f-summary" rows="3">${esc(val('summary'))}</textarea>
    <label class="f-lbl">Content (മുഴുവൻ വാർത്ത)</label>
    <textarea id="f-content" rows="10">${esc(val('content'))}</textarea>
    <label class="f-lbl">Thumbnail</label>
    <div class="row-flex">
      <input id="f-thumb" placeholder="image URL" value="${esc(val('thumbnail_url'))}">
      <label class="btn small" style="flex-shrink:0">📤<input id="f-upload" type="file" accept="image/*" hidden></label>
    </div>
    <img id="f-preview" class="preview" src="${esc(val('thumbnail_url'))}" ${val('thumbnail_url') ? '' : 'hidden'}>
    <p class="muted">എഡിറ്റ് സേവ് ചെയ്താൽ ആപ്പിൽ ഈ version ആണ് കാണുക. Original വാർത്ത refresh-ൽ മാറിയാലും എഡിറ്റ് നിലനിൽക്കും.</p>
    <div class="sheet-actions">
      <button class="btn" id="sheet-cancel">റദ്ദാക്കുക</button>
      ${hasEdit ? '<button class="btn danger" id="sheet-reset">Original ആക്കുക</button>' : ''}
      <button class="btn primary" id="sheet-save">സേവ്</button>
    </div>`);
  $('#sheet-cancel').onclick = closeSheet;
  $('#f-thumb').oninput = e => { const p = $('#f-preview');
    p.src = e.target.value; p.hidden = !e.target.value; };
  $('#f-upload').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      toast('അപ്‌ലോഡ് ചെയ്യുന്നു…');
      const url = await uploadMedia('news', 'edit-' + hash + '.' + extOf(f.name), f);
      $('#f-thumb').value = url;
      const p = $('#f-preview'); p.src = url; p.hidden = false;
      toast('അപ്‌ലോഡ് OK', 'ok');
    } catch(err){ toast('അപ്‌ലോഡ് പരാജയം: ' + err.message, 'err'); }
  };
  const saveEdits = async (map, msg) => {
    const data = { edits: map, updated_at: nowIso() };
    await doSave('newsedits', data, msg);
  };
  $('#sheet-save').onclick = async () => {
    const title = $('#f-title').value.trim();
    if (!title){ toast('Title നിർബന്ധം', 'err'); return; }
    const map = Object.assign({}, edits);
    map[key] = {
      title,
      summary: $('#f-summary').value,
      content: $('#f-content').value,
      thumbnail_url: $('#f-thumb').value.trim(),
      edited_at: nowIso()
    };
    await saveEdits(map, 'ന്യൂസ് എഡിറ്റ് സേവ് ചെയ്തു');
  };
  const resetBtn = $('#sheet-reset');
  if (resetBtn) resetBtn.onclick = async () => {
    if (!confirm('എഡിറ്റ് നീക്കി original വാർത്തയിലേക്ക് മാറ്റണോ?')) return;
    const map = Object.assign({}, edits);
    delete map[key];
    await saveEdits(map, 'Original ആക്കി');
  };
}

/* ---------- Settings ---------- */
function renderSettings(el){
  el.innerHTML =
    '<div class="sec-head"><h2>സെറ്റിങ്സ്</h2></div>' +
    '<div class="card glass" style="display:block">' +
      '<label class="f-lbl" style="margin-top:0">GitHub Token (PAT)</label>' +
      '<input id="s-token" type="password" placeholder="token ഒട്ടിക്കുക" value="' + esc(token()) + '">' +
      '<p class="muted">Contents read+write ഉള്ള fine-grained token. ഈ ഫോണിൽ മാത്രം സേവ് ചെയ്യും.</p>' +
      '<button class="btn primary block" id="s-save-token">Token സേവ്</button>' +
    '</div>' +
    '<div class="card glass" style="display:block;margin-top:12px">' +
      '<label class="f-lbl" style="margin-top:0">PIN മാറ്റുക</label>' +
      '<input id="s-oldpin" type="password" inputmode="numeric" placeholder="പഴയ PIN">' +
      '<input id="s-newpin" type="password" inputmode="numeric" placeholder="പുതിയ PIN (4+ അക്കം)" style="margin-top:8px">' +
      '<button class="btn block" id="s-save-pin">PIN മാറ്റുക</button>' +
    '</div>' +
    '<div class="card glass" style="display:block;margin-top:12px">' +
      '<p class="muted">Data repo: ' + esc(DATA_REPO) + '<br>Media repo: ' + esc(MEDIA_REPO) + '</p>' +
      '<button class="btn danger block" id="s-logout">ലോക്ക് ചെയ്യുക</button>' +
    '</div>';
  $('#s-save-token').onclick = () => {
    localStorage.setItem(LS_TOKEN, $('#s-token').value.trim());
    toast('Token സേവ് ചെയ്തു', 'ok'); updateTokenBanner();
  };
  $('#s-save-pin').onclick = () => {
    const o = $('#s-oldpin').value, n = $('#s-newpin').value.trim();
    if (o !== localStorage.getItem(LS_PIN)){ toast('പഴയ PIN തെറ്റ്', 'err'); return; }
    if (!/^\d{4,}$/.test(n)){ toast('പുതിയ PIN 4+ അക്കം വേണം', 'err'); return; }
    localStorage.setItem(LS_PIN, n); toast('PIN മാറ്റി', 'ok'); render();
  };
  $('#s-logout').onclick = () => {
    sessionStorage.removeItem(SS_UNLOCK); initGate();
  };
}
function updateTokenBanner(){ $('#token-banner').hidden = !!token(); }

/* ---------- shared save / delete ---------- */
async function doSave(key, data, okMsg, rerender = true){
  const btn = $('#sheet-save');
  if (btn) btn.disabled = true;
  try {
    await saveDataFile(key, data, 'Admin: ' + okMsg);
    toast(okMsg + ' ✓', 'ok');
    closeSheet();
    if (rerender) render();
  } catch(e){
    toast('സേവ് പരാജയം: ' + e.message, 'err');
    if (btn) btn.disabled = false;
  }
}
async function deleteItem(key, list, id, label){
  if (!confirm('ഈ ' + label + ' ഡിലീറ്റ് ചെയ്യണോ? (#' + id + ')')) return;
  const i = list.findIndex(x => String(x.id) === String(id));
  if (i < 0) return;
  list.splice(i, 1);
  try {
    await saveDataFile(key, list, 'Admin: delete ' + label + ' #' + id);
    toast('ഡിലീറ്റ് ചെയ്തു', 'ok'); render();
  } catch(e){ toast('ഡിലീറ്റ് പരാജയം: ' + e.message, 'err'); }
}

/* ---------- bottom sheet ---------- */
function openSheet(title, html){
  $('#sheet').innerHTML = '<div class="sheet-head"><h3>' + esc(title) +
    '</h3><button class="sheet-x" id="sheet-x">✕</button></div>' + html;
  $('#sheet-wrap').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#sheet-x').onclick = closeSheet;
  $('#sheet-backdrop').onclick = closeSheet;
}
function closeSheet(){
  $('#sheet-wrap').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- boot ---------- */
function boot(){
  updateTokenBanner();
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $('#refresh-btn').onclick = () => { Object.keys(cache).forEach(k => delete cache[k]); render(); };
  $('#token-banner-btn').onclick = () => switchTab('settings');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  render();
}

$('#pin-set-btn').onclick = trySetPin;
$('#pin-go-btn').onclick = tryUnlock;
$('#pin-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') trySetPin(); });
$('#pin-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
initGate();
if (sessionStorage.getItem(SS_UNLOCK) === '1') boot();
