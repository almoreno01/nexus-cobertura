'use strict';

const DOCS_KEY = 'nexus_cobertura_docs_v1';
const SETTINGS_KEY = 'nexus_cobertura_settings_v1';
const DEFAULT_SETTINGS = { avgDays: 30, coverageDays: 1, selectedCurrency: 'CUP' };
const KNOWN_CURRENCIES = ['CUP','USD','EUR','MXN','CAD','REAL','ZELLE','BRL'];
const CURRENCY_ALIASES = { USA:'USD',US:'USD',DOLAR:'USD','DÓLAR':'USD',MXC:'MXN',MEX:'MXN',BRL:'REAL',REAIS:'REAL' };

let docs = loadJSON(DOCS_KEY, []);
let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON(SETTINGS_KEY, {}));
let workbookCache = new Map();
let noticeTimer = null;

const state = {
  view: 'home',
  results: new Map(),
  loading: new Set(),
  errors: new Map(),
  addOpen: false,
  editId: null,
  detectedSheets: [],
  detecting: false,
  menuId: null
};

const $app = document.getElementById('app');

function loadJSON(key, fallback){
  try{
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value == null ? fallback : value;
  }catch{return fallback;}
}
function saveDocs(){ localStorage.setItem(DOCS_KEY, JSON.stringify(docs)); }
function saveSettings(){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function uid(){ return crypto?.randomUUID?.() || `point-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function esc(value){ return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function normalizeText(value){ return String(value ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function normalizeCurrency(value){
  const raw = normalizeText(value).replace(/[^A-Z0-9]/g,'');
  return CURRENCY_ALIASES[raw] || raw;
}
function fmtMoney(value){
  const n = Number(value || 0);
  return n.toLocaleString('es-MX', {maximumFractionDigits:2, minimumFractionDigits:0});
}
function fmtDecimal(value, digits=1){
  return Number(value || 0).toLocaleString('es-MX',{maximumFractionDigits:digits,minimumFractionDigits:0});
}
function clamp(n,min,max){ return Math.min(max,Math.max(min,n)); }
function extractId(url){ return String(url||'').match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] || ''; }
function isGoogleSheetUrl(url){ return !!extractId(url); }
function currentDayNumber(){ const d=new Date(); return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000; }
function dayNumber(y,m,d){ return Date.UTC(y,m-1,d)/86400000; }

function parseAmount(value){
  if(typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if(value == null || value === '') return 0;
  let s = String(value).trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if(!s) return 0;
  if(s.includes(',') && s.includes('.')){
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
  }else if(s.includes(',')){
    const p=s.split(',');
    s = p.length===2 && p[1].length<=2 ? p[0].replace(/\./g,'')+'.'+p[1] : s.replace(/,/g,'');
  }
  const n=Number(s);
  return Number.isFinite(n) ? n : 0;
}
function hasNumericValue(value){
  if(typeof value==='number') return Number.isFinite(value);
  if(value == null || String(value).trim()==='') return false;
  return /\d/.test(String(value));
}
function parseDay(value){
  if(value instanceof Date && !Number.isNaN(value.getTime())) return dayNumber(value.getFullYear(),value.getMonth()+1,value.getDate());
  if(typeof value === 'number' && Number.isFinite(value)){
    if(window.XLSX?.SSF?.parse_date_code){
      const x=window.XLSX.SSF.parse_date_code(value);
      if(x && x.y && x.m && x.d) return dayNumber(x.y,x.m,x.d);
    }
    if(value > 25000 && value < 90000){
      const dt=new Date(Math.round((value-25569)*86400000));
      return dayNumber(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate());
    }
    return null;
  }
  const s=String(value??'').trim();
  if(!s) return null;
  let m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s|$)/);
  if(m){
    let y=Number(m[3]); if(y<100)y+=2000;
    const mo=Number(m[2]),d=Number(m[1]);
    if(mo>=1&&mo<=12&&d>=1&&d<=31) return dayNumber(y,mo,d);
  }
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T|\s|$)/);
  if(m){
    const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
    if(mo>=1&&mo<=12&&d>=1&&d<=31) return dayNumber(y,mo,d);
  }
  return null;
}
function formatDay(day){
  if(day == null) return '—';
  const d=new Date(day*86400000);
  return d.toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});
}

async function fetchWorkbook(docOrUrl, force=false){
  const url=typeof docOrUrl==='string'?docOrUrl:docOrUrl.url;
  const id=extractId(url);
  if(!id) throw new Error('El enlace no corresponde a Google Sheets.');
  if(!window.XLSX) throw new Error('No se pudo cargar el lector de hojas. Comprueba la conexión a Internet.');
  if(!force && workbookCache.has(id)) return workbookCache.get(id);
  const promise=(async()=>{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),60000);
    try{
      const endpoint=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=xlsx&_=${Date.now()}`;
      const response=await fetch(endpoint,{cache:'no-store',credentials:'omit',signal:ctrl.signal});
      if(!response.ok) throw new Error(`Google respondió ${response.status}.`);
      const type=(response.headers.get('content-type')||'').toLowerCase();
      if(type.includes('text/html')) throw new Error('El documento no está disponible mediante vínculo.');
      const buffer=await response.arrayBuffer();
      if(buffer.byteLength<200) throw new Error('La descarga del documento está vacía.');
      return window.XLSX.read(buffer,{type:'array',cellDates:true,cellFormula:false});
    }catch(err){
      if(err?.name==='AbortError') throw new Error('Google Sheets tardó demasiado en responder.');
      if(err instanceof TypeError) throw new Error('No se pudo acceder al documento. Compártelo como “Cualquier persona con el vínculo · Lector”.');
      throw err;
    }finally{clearTimeout(timer);}
  })();
  workbookCache.set(id,promise);
  try{return await promise;}catch(e){workbookCache.delete(id);throw e;}
}

function rowCell(row,col){ return Array.isArray(row) && col>=0 ? row[col] : ''; }
function findHeaderCell(row,label,start=0,end=Infinity){
  const max=Math.min(Array.isArray(row)?row.length:0,end+1);
  for(let c=Math.max(0,start);c<max;c++) if(normalizeText(row[c])===label) return c;
  return -1;
}
function inferCurrency(matrix,headerRow,dateCol,totalCol,index){
  for(let r=headerRow-1;r>=Math.max(0,headerRow-4);r--){
    for(let c=Math.max(0,dateCol-1);c<=Math.min(totalCol+1,(matrix[r]?.length||0)-1);c++){
      const cur=normalizeCurrency(rowCell(matrix[r],c));
      if(KNOWN_CURRENCIES.includes(cur)) return cur==='BRL'?'REAL':cur;
    }
  }
  for(let r=headerRow-1;r>=Math.max(0,headerRow-3);r--){
    const candidates=[];
    for(let c=Math.max(0,dateCol-1);c<=Math.min(totalCol,(matrix[r]?.length||0)-1);c++){
      const text=normalizeCurrency(rowCell(matrix[r],c));
      if(/^[A-Z]{2,6}$/.test(text) && !['TOTAL','SALIDA','ENTRADA','BALANCE','FECHA'].includes(text)) candidates.push(text);
    }
    if(candidates.length) return candidates[0];
  }
  return `MONEDA${index+1}`;
}
function findBlocks(matrix){
  const blocks=[];
  const maxHeaderRows=Math.min(matrix.length,20);
  for(let r=0;r<maxHeaderRows;r++){
    const row=matrix[r]||[];
    for(let c=0;c<row.length;c++){
      if(normalizeText(row[c])!=='SALIDA') continue;
      let entryCol=-1;
      for(let x=c-1;x>=Math.max(0,c-4);x--){ if(normalizeText(row[x])==='ENTRADA'){entryCol=x;break;} }
      if(entryCol<0) continue;
      let descCol=findHeaderCell(row,'DESCRIPCION',c+1,c+4);
      let totalCol=findHeaderCell(row,'TOTAL',c+1,c+5);
      if(totalCol<0) continue;
      if(descCol<0) descCol=c+1;
      let dateCol=findHeaderCell(row,'FECHA',Math.max(0,entryCol-3),entryCol-1);
      if(dateCol<0) dateCol=Math.max(0,entryCol-1);
      if(blocks.some(b=>b.headerRow===r&&b.exitCol===c)) continue;
      blocks.push({headerRow:r,dateCol,entryCol,exitCol:c,descCol,totalCol,currency:inferCurrency(matrix,r,dateCol,totalCol,blocks.length)});
    }
  }
  return blocks;
}
function analyzeBlock(matrix,block,avgDays,coverageDays){
  const today=currentDayNumber();
  const start=today-(avgDays-1);
  let inheritedDay=null, exitSum=0, balance=null, lastDataDay=null, datedExitRows=0;
  for(let r=block.headerRow+1;r<matrix.length;r++){
    const row=matrix[r]||[];
    const parsed=parseDay(rowCell(row,block.dateCol));
    if(parsed!=null) inheritedDay=parsed;
    const exitRaw=rowCell(row,block.exitCol);
    const totalRaw=rowCell(row,block.totalCol);
    if(hasNumericValue(totalRaw)) balance=parseAmount(totalRaw);
    if(inheritedDay!=null && inheritedDay<=today) lastDataDay=lastDataDay==null?inheritedDay:Math.max(lastDataDay,inheritedDay);
    if(inheritedDay!=null && inheritedDay>=start && inheritedDay<=today && hasNumericValue(exitRaw)){
      const amount=Math.max(0,parseAmount(exitRaw));
      exitSum+=amount;
      if(amount>0) datedExitRows++;
    }
  }
  const avgDaily=exitSum/avgDays;
  const currentBalance=Number(balance||0);
  const target=Math.max(0,avgDaily*coverageDays);
  const pct=target===0?100:clamp(Math.round((Math.max(0,currentBalance)/target)*100),0,100);
  const coverage=avgDaily>0?Math.max(0,currentBalance)/avgDaily:Infinity;
  const recharge=Math.max(0,target-currentBalance);
  return {currency:block.currency,balance:currentBalance,exitSum,avgDaily,target,pct,coverage,recharge,lastDataDay,datedExitRows};
}
function analyzeWorksheet(ws){
  const matrix=window.XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  const blocks=findBlocks(matrix);
  if(!blocks.length) throw new Error('No encontré columnas con la estructura ENTRADA / SALIDA / TOTAL.');
  const avgDays=Math.max(1,Number(settings.avgDays)||30);
  const coverageDays=Math.max(0.01,Number(settings.coverageDays)||1);
  const currencies={};
  for(const block of blocks){
    const result=analyzeBlock(matrix,block,avgDays,coverageDays);
    let key=result.currency;
    if(currencies[key]) key=`${key}_${Object.keys(currencies).filter(x=>x.startsWith(key)).length+1}`;
    currencies[key]=result;
  }
  return {currencies,blocks:blocks.length};
}
async function analyzeDoc(doc,force=false){
  const wb=await fetchWorkbook(doc,force);
  const sheetName=doc.sheet || wb.SheetNames?.[0];
  if(!sheetName || !wb.Sheets[sheetName]) throw new Error(`No existe la hoja “${sheetName||'sin nombre'}”.`);
  const analysis=analyzeWorksheet(wb.Sheets[sheetName]);
  return Object.assign(analysis,{sheetName,spreadsheetId:extractId(doc.url),updatedAt:Date.now()});
}

function allCurrencies(){
  const set=new Set();
  for(const result of state.results.values()) for(const key of Object.keys(result?.currencies||{})) set.add(key);
  const list=[...KNOWN_CURRENCIES.filter(c=>set.has(c)),...[...set].filter(c=>!KNOWN_CURRENCIES.includes(c)).sort()];
  return list;
}
function ensureSelectedCurrency(){
  const list=allCurrencies();
  if(list.length && !list.includes(settings.selectedCurrency)){
    settings.selectedCurrency=list[0];
    saveSettings();
  }
}
function batteryClass(pct){ return pct>=75?'ok':pct>=25?'mid':'low'; }
function batteryHTML(metric){
  if(!metric) return `<div class="point-side"><div class="tank mid"><div class="tank-fill" style="width:0"></div><div class="tank-grid"></div><div class="tank-content">—</div></div><div class="coverage-label">Sin datos</div></div>`;
  const cls=batteryClass(metric.pct);
  const coverage=Number.isFinite(metric.coverage)?`${fmtDecimal(metric.coverage,1)} días`:'Sin consumo';
  return `<div class="point-side"><div class="tank ${cls}"><div class="tank-fill" style="width:${metric.pct}%"></div><div class="tank-grid"></div><div class="tank-content">${metric.pct}%</div></div><div class="coverage-label">Cobertura: ${coverage}</div></div>`;
}
function pointCardHTML(doc){
  if(state.loading.has(doc.id)){
    return `<article class="point-card loading-card"><div class="point-main"><div class="skeleton sk-title"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div></div><div class="skeleton sk-battery"></div></article>`;
  }
  const error=state.errors.get(doc.id);
  if(error){
    return `<article class="point-card error-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="error-title">No se pudo leer</div><div class="error-text">${esc(error)}</div><button class="small-action" data-action="refresh-one" data-id="${esc(doc.id)}">Reintentar</button></div></article>`;
  }
  const result=state.results.get(doc.id);
  const metric=result?.currencies?.[settings.selectedCurrency];
  if(!metric){
    return `<article class="point-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="balance">Sin ${esc(settings.selectedCurrency)}</div><div class="metric">Hoja: ${esc(result?.sheetName||doc.sheet||'—')}</div><div class="metric">Monedas detectadas: ${esc(Object.keys(result?.currencies||{}).join(', ')||'ninguna')}</div></div>${batteryHTML(null)}</article>`;
  }
  const rechargeNeeded=metric.recharge>0.005;
  const rechargeText=rechargeNeeded?`Recargar ${fmtMoney(metric.recharge)} ${esc(settings.selectedCurrency)}`:`Cobertura objetivo completa`;
  return `<article class="point-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="balance">${fmtMoney(metric.balance)} ${esc(settings.selectedCurrency)}</div><div class="metric">Promedio: ${fmtMoney(metric.avgDaily)} ${esc(settings.selectedCurrency)}/día</div><div class="metric">Salidas últimos ${esc(settings.avgDays)} días: ${fmtMoney(metric.exitSum)} ${esc(settings.selectedCurrency)}</div><div class="recharge ${rechargeNeeded?'needed':''}">${rechargeText}</div><div class="metric">Datos hasta: ${formatDay(metric.lastDataDay)}</div></div>${batteryHTML(metric)}</article>`;
}
function currencyStripHTML(){
  const list=allCurrencies();
  if(!list.length) return '';
  return `<div class="currency-strip">${list.map(c=>`<button class="currency-chip ${c===settings.selectedCurrency?'active':''}" data-action="currency" data-currency="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
}
function topHTML(){
  return `<header class="top"><div class="toprow"><div class="brand"><img class="brand-logo" src="./assets/app-icon.svg" alt=""><div class="brand-copy"><div class="brand-title">Nexus Cobertura</div><div class="brand-subtitle">Control de puntos de efectivo</div></div></div><div class="top-actions">${state.view==='home'?`<button class="icon-btn" data-action="refresh-all" title="Actualizar">↻</button>`:''}<button class="icon-btn" data-action="go-settings" title="Ajustes">⚙</button></div></div></header>`;
}
function homeHTML(){
  let content='';
  if(!docs.length){
    content=`<div class="empty"><div class="empty-icon">+</div><h2>Aún no hay puntos</h2><p>Agrega un Google Spreadsheet. La app leerá sus salidas, calculará el promedio diario y convertirá el saldo actual en días de cobertura y porcentaje de batería.</p><button class="add-btn" data-action="open-add"><span class="plus">+</span><span>Agregar documento</span></button></div>`;
  }else{
    content=`<div class="points">${docs.map(pointCardHTML).join('')}</div>`;
  }
  return `<main class="main"><div class="toolbar"><div class="toolbar-title"><h2>Puntos de efectivo</h2><p>${docs.length} documento${docs.length===1?'':'s'} · promedio ${settings.avgDays} días · cobertura objetivo ${settings.coverageDays} día${Number(settings.coverageDays)===1?'':'s'}</p></div><button class="add-btn" data-action="open-add"><span class="plus">+</span><span class="label">Agregar</span></button></div>${currencyStripHTML()}<div class="info-banner ${navigator.onLine?'':'warn'}"><span>${navigator.onLine?'●':'!'}</span><span>${navigator.onLine?'Los valores se leen directamente desde Google Sheets al actualizar.':'Sin conexión: no se pueden recalcular los puntos hasta recuperar Internet.'}</span></div>${content}</main>`;
}
function settingsHTML(){
  return `<main class="main"><div class="toolbar"><div class="toolbar-title"><h2>Ajustes</h2><p>Parámetros globales de cálculo</p></div></div><section class="settings-card"><h3>Cálculo del promedio</h3><p>La app suma las salidas ocurridas dentro de este período y divide entre la cantidad completa de días. Los días sin salidas cuentan como cero.</p><div class="field"><label>Días para calcular promedio</label><input id="avgDays" type="number" min="1" max="3650" step="1" value="${esc(settings.avgDays)}"></div></section><section class="settings-card"><h3>Cobertura del nivel</h3><p>Define cuántos días de salidas promedio deben equivaler al 100% de batería.</p><div class="field"><label>Días de cobertura objetivo</label><input id="coverageDays" type="number" min="0.01" max="3650" step="0.1" value="${esc(settings.coverageDays)}"></div><div class="formula"><div class="formula-title">Fórmula</div><code>Reserva objetivo = promedio diario × días de cobertura<br>Batería = saldo actual ÷ reserva objetivo × 100<br>Recarga = max(0, reserva objetivo − saldo actual)</code></div><button class="save-settings" data-action="save-settings">Guardar y recalcular</button></section><section class="settings-card"><h3>Origen de datos</h3><p>No hay usuarios ni base de datos interna. Cada Google Spreadsheet es la fuente de verdad. Para poder leerlo sin inicio de sesión, debe estar compartido como “Cualquier persona con el vínculo · Lector”.</p></section></main>`;
}
function bottomNavHTML(){
  return `<nav class="bottom-nav"><button class="nav-item ${state.view==='home'?'active':''}" data-action="go-home"><span class="nav-icon">⌂</span><span>Puntos</span></button><button class="nav-item ${state.view==='settings'?'active':''}" data-action="go-settings"><span class="nav-icon">⚙</span><span>Ajustes</span></button></nav>`;
}
function modalHTML(){
  if(!state.addOpen) return '';
  const editing=state.editId?docs.find(d=>d.id===state.editId):null;
  const selected=editing?.sheet || state.detectedSheets[0] || '';
  return `<div class="modal-bg" data-action="close-modal-bg"><div class="modal" data-modal><div class="modal-head"><h2>${editing?'Editar':'Agregar'} punto</h2><button class="close-btn" data-action="close-add">×</button></div><div class="field"><label>Nombre del punto</label><input id="docName" value="${esc(editing?.name||'')}" placeholder="Ej. Efectivo Eliecer"></div><div class="field"><label>Enlace de Google Sheets</label><input id="docUrl" value="${esc(editing?.url||'')}" placeholder="https://docs.google.com/spreadsheets/d/..."><div class="help">Debe tener acceso mediante vínculo como lector. No se usa cuenta de Google dentro de la app.</div></div><button class="btn soft" style="margin-top:12px;width:100%" data-action="detect-sheets" ${state.detecting?'disabled':''}>${state.detecting?'Leyendo documento…':'Detectar hojas'}</button>${state.detectedSheets.length?`<div class="sheet-detect"><div class="sheet-detect-title">Hojas encontradas</div><div class="sheet-list">${state.detectedSheets.map(s=>`<span class="sheet-pill">${esc(s)}</span>`).join('')}</div><div class="field" style="margin-top:10px"><label>Hoja que representa este punto</label><select id="docSheet">${state.detectedSheets.map(s=>`<option value="${esc(s)}" ${s===selected?'selected':''}>${esc(s)}</option>`).join('')}</select></div></div>`:''}<div class="modal-actions"><button class="btn soft" data-action="close-add">Cancelar</button><button class="btn primary" data-action="save-doc" ${state.detectedSheets.length?'':'disabled'}>${editing?'Guardar':'Agregar'}</button></div></div></div>`;
}
function docMenuHTML(){
  if(!state.menuId) return '';
  const doc=docs.find(d=>d.id===state.menuId); if(!doc) return '';
  return `<div class="doc-menu" data-action="close-menu-bg"><div class="sheet-menu" data-menu-sheet><div class="handle"></div><h3>${esc(doc.name)}</h3><button class="menu-option" data-action="refresh-one" data-id="${esc(doc.id)}">↻ Actualizar ahora</button><button class="menu-option" data-action="edit-doc" data-id="${esc(doc.id)}">✎ Editar nombre, enlace u hoja</button><button class="menu-option danger" data-action="delete-doc" data-id="${esc(doc.id)}">⌫ Eliminar punto</button></div></div>`;
}
function render(){
  ensureSelectedCurrency();
  $app.innerHTML=`<div class="app">${topHTML()}${state.view==='settings'?settingsHTML():homeHTML()}${bottomNavHTML()}${modalHTML()}${docMenuHTML()}</div>`;
}
function showNotice(text){
  let n=document.querySelector('.notice'); if(n)n.remove();
  n=document.createElement('div');n.className='notice';n.textContent=text;document.body.appendChild(n);
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.remove(),3200);
}

async function refreshDoc(id,force=true){
  const doc=docs.find(d=>d.id===id); if(!doc)return;
  state.menuId=null; state.loading.add(id); state.errors.delete(id); state.results.delete(id); render();
  try{
    const result=await analyzeDoc(doc,force); state.results.set(id,result);
  }catch(e){ state.errors.set(id,e?.message||String(e)); }
  finally{ state.loading.delete(id); render(); }
}
async function refreshAll(force=true){
  workbookCache=new Map();
  const ids=docs.map(d=>d.id);
  for(const id of ids){state.loading.add(id);state.errors.delete(id);state.results.delete(id);}
  render();
  await Promise.all(ids.map(async id=>{
    const doc=docs.find(d=>d.id===id); if(!doc)return;
    try{state.results.set(id,await analyzeDoc(doc,force));}
    catch(e){state.errors.set(id,e?.message||String(e));}
    finally{state.loading.delete(id);render();}
  }));
  render();
}
async function detectSheets(){
  const name=document.getElementById('docName')?.value.trim();
  const url=document.getElementById('docUrl')?.value.trim();
  if(!name){showNotice('Escribe un nombre para el punto.');return;}
  if(!isGoogleSheetUrl(url)){showNotice('Pega un enlace válido de Google Sheets.');return;}
  state.detecting=true; state.detectedSheets=[]; render();
  document.getElementById('docName').value=name; document.getElementById('docUrl').value=url;
  try{
    const wb=await fetchWorkbook(url,true);
    const names=Array.isArray(wb.SheetNames)?wb.SheetNames:[];
    if(!names.length)throw new Error('El documento no contiene hojas.');
    state.detectedSheets=names;
    state._draft={name,url};
  }catch(e){showNotice(e?.message||String(e));}
  finally{
    state.detecting=false;render();
    if(state._draft){
      const a=document.getElementById('docName'),b=document.getElementById('docUrl');
      if(a)a.value=state._draft.name;if(b)b.value=state._draft.url;
    }
  }
}
async function saveDocFromModal(){
  const name=(document.getElementById('docName')?.value||state._draft?.name||'').trim();
  const url=(document.getElementById('docUrl')?.value||state._draft?.url||'').trim();
  const sheet=document.getElementById('docSheet')?.value||state.detectedSheets[0]||'';
  if(!name||!isGoogleSheetUrl(url)||!sheet){showNotice('Completa el nombre, enlace y hoja.');return;}
  if(state.editId){
    const idx=docs.findIndex(d=>d.id===state.editId); if(idx>=0)docs[idx]={...docs[idx],name,url,sheet};
  }else docs.push({id:uid(),name,url,sheet});
  saveDocs();
  const id=state.editId || docs[docs.length-1].id;
  state.addOpen=false;state.editId=null;state.detectedSheets=[];state._draft=null;render();
  await refreshDoc(id,true);
}
function openAdd(){state.addOpen=true;state.editId=null;state.detectedSheets=[];state._draft=null;render();}
async function openEdit(id){
  const doc=docs.find(d=>d.id===id);if(!doc)return;
  state.menuId=null;state.addOpen=true;state.editId=id;state.detecting=true;state.detectedSheets=[];state._draft={name:doc.name,url:doc.url};render();
  try{
    const wb=await fetchWorkbook(doc.url,true);state.detectedSheets=wb.SheetNames||[];
  }catch(e){state.detectedSheets=[doc.sheet].filter(Boolean);showNotice(e?.message||String(e));}
  finally{state.detecting=false;render();}
}
function deleteDoc(id){
  const doc=docs.find(d=>d.id===id);if(!doc)return;
  if(!confirm(`¿Eliminar “${doc.name}” de esta app? El Google Sheet no se modifica.`))return;
  docs=docs.filter(d=>d.id!==id);saveDocs();state.results.delete(id);state.errors.delete(id);state.loading.delete(id);state.menuId=null;render();
}
function saveSettingsFromUI(){
  const avg=Math.round(Number(document.getElementById('avgDays')?.value||0));
  const cov=Number(document.getElementById('coverageDays')?.value||0);
  if(!Number.isFinite(avg)||avg<1||avg>3650){showNotice('El promedio debe estar entre 1 y 3650 días.');return;}
  if(!Number.isFinite(cov)||cov<=0||cov>3650){showNotice('La cobertura debe ser mayor que 0 y máximo 3650 días.');return;}
  settings.avgDays=avg;settings.coverageDays=Math.round(cov*100)/100;saveSettings();state.view='home';showNotice('Ajustes guardados. Recalculando…');refreshAll(true);
}

$app.addEventListener('click',async event=>{
  const actionEl=event.target.closest('[data-action]');if(!actionEl)return;
  const action=actionEl.dataset.action;
  if(action==='open-add')return openAdd();
  if(action==='close-add'){state.addOpen=false;state.editId=null;state.detectedSheets=[];state._draft=null;return render();}
  if(action==='close-modal-bg' && !event.target.closest('[data-modal]')){state.addOpen=false;state.editId=null;state.detectedSheets=[];return render();}
  if(action==='detect-sheets')return detectSheets();
  if(action==='save-doc')return saveDocFromModal();
  if(action==='refresh-all')return refreshAll(true);
  if(action==='refresh-one')return refreshDoc(actionEl.dataset.id,true);
  if(action==='menu'){state.menuId=actionEl.dataset.id;return render();}
  if(action==='close-menu-bg' && !event.target.closest('[data-menu-sheet]')){state.menuId=null;return render();}
  if(action==='edit-doc')return openEdit(actionEl.dataset.id);
  if(action==='delete-doc')return deleteDoc(actionEl.dataset.id);
  if(action==='currency'){settings.selectedCurrency=actionEl.dataset.currency;saveSettings();return render();}
  if(action==='go-settings'){state.view='settings';state.addOpen=false;state.menuId=null;return render();}
  if(action==='go-home'){state.view='home';state.addOpen=false;state.menuId=null;return render();}
  if(action==='save-settings')return saveSettingsFromUI();
});

window.addEventListener('online',()=>{render();showNotice('Conexión recuperada.');});
window.addEventListener('offline',()=>render());

if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
render();
if(docs.length) refreshAll(true);
