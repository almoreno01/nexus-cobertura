'use strict';

// Nexus Cobertura: UI requested changes + shared state across devices.
const NEXUS_SB_URL='https://xvsxwypcqyfdiwmthpjv.supabase.co';
const NEXUS_SB_KEY='sb_publishable_466U-x5n2aO8EY-KKv3loQ_5hFO4Lv4';
const originalLocalSaveDocs=saveDocs;
const originalLocalSaveSettings=saveSettings;
const originalRefreshAll=refreshAll;
let sharedReady=false;
let settingsSyncTimer=null;

function validUUID(value){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
}
function sharedUid(){
  if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for(let i=0;i<16;i++) bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&0x0f)|0x40; bytes[8]=(bytes[8]&0x3f)|0x80;
  const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
async function sbRequest(path,options={}){
  const headers={apikey:NEXUS_SB_KEY,...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  const response=await fetch(`${NEXUS_SB_URL}/rest/v1/${path}`,{cache:'no-store',credentials:'omit',...options,headers});
  if(!response.ok){
    let detail='';
    try{detail=await response.text();}catch{}
    throw new Error(`No se pudo sincronizar la información compartida${detail?` (${response.status})`:''}.`);
  }
  if(response.status===204) return null;
  const text=await response.text();
  return text?JSON.parse(text):null;
}
function sharedDocRow(doc){
  return {id:validUUID(doc.id)?doc.id:sharedUid(),name:String(doc.name||'').trim(),url:String(doc.url||'').trim(),sheet:String(doc.sheet||'').trim(),updated_at:new Date().toISOString()};
}
function applySharedSettings(row){
  if(!row) return;
  const avg=Math.round(Number(row.avg_days));
  const cov=Number(row.coverage_days);
  if(Number.isFinite(avg)&&avg>=1&&avg<=3650) settings.avgDays=avg;
  if(Number.isFinite(cov)&&cov>0&&cov<=3650) settings.coverageDays=cov;
  settings.selectedCurrency=row.selected_currency==='USD'?'USD':'CUP';
}
async function pushSettingsNow(){
  const body={avg_days:Math.round(Number(settings.avgDays)||30),coverage_days:Number(settings.coverageDays)||1,selected_currency:settings.selectedCurrency==='USD'?'USD':'CUP',updated_at:new Date().toISOString()};
  await sbRequest('nexus_cobertura_settings?id=eq.1',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
}
function queueSharedSettings(){
  clearTimeout(settingsSyncTimer);
  settingsSyncTimer=setTimeout(()=>pushSettingsNow().catch(()=>{}),180);
}

saveDocs=function(){ originalLocalSaveDocs(); };
saveSettings=function(){
  originalLocalSaveSettings();
  if(sharedReady) queueSharedSettings();
};

async function pullSharedState({allowMigration=false}={}){
  const localDocs=Array.isArray(docs)?docs.map(d=>({...d})):[];
  const hadLocalSettings=localStorage.getItem(SETTINGS_KEY)!==null;
  const localSettings={...settings};
  let [remoteDocs,settingsRows]=await Promise.all([
    sbRequest('nexus_cobertura_docs?select=id,name,url,sheet,created_at,updated_at&order=created_at.asc'),
    sbRequest('nexus_cobertura_settings?id=eq.1&select=id,avg_days,coverage_days,selected_currency,updated_at')
  ]);
  remoteDocs=Array.isArray(remoteDocs)?remoteDocs:[];
  let remoteSettings=Array.isArray(settingsRows)?settingsRows[0]:null;

  if(allowMigration && remoteDocs.length===0 && localDocs.length){
    const migrated=localDocs.filter(d=>d?.name&&d?.url&&d?.sheet).map(sharedDocRow);
    if(migrated.length){
      const inserted=await sbRequest('nexus_cobertura_docs',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(migrated)});
      remoteDocs=Array.isArray(inserted)&&inserted.length?inserted:migrated;
    }
  }

  if(allowMigration && hadLocalSettings && remoteSettings){
    const remoteIsDefault=Number(remoteSettings.avg_days)===30&&Number(remoteSettings.coverage_days)===1&&remoteSettings.selected_currency==='CUP';
    const localIsDifferent=Number(localSettings.avgDays)!==30||Number(localSettings.coverageDays)!==1||localSettings.selectedCurrency!=='CUP';
    if(remoteIsDefault&&localIsDifferent){
      settings={...settings,...localSettings};
      await pushSettingsNow();
      remoteSettings={...remoteSettings,avg_days:settings.avgDays,coverage_days:settings.coverageDays,selected_currency:settings.selectedCurrency};
    }
  }

  docs=remoteDocs.map(row=>({id:row.id,name:row.name,url:row.url,sheet:row.sheet}));
  applySharedSettings(remoteSettings);
  originalLocalSaveDocs();
  originalLocalSaveSettings();
  sharedReady=true;
  render();
}

ensureSelectedCurrency=function(){
  if(!['CUP','USD'].includes(settings.selectedCurrency)){
    settings.selectedCurrency='CUP';
    saveSettings();
  }
};

batteryHTML=function(metric){
  if(!metric) return `<div class="point-side"><div class="tank mid"><div class="tank-fill" style="--battery-level:0"></div><div class="tank-grid"></div><div class="tank-content">—</div></div><div class="coverage-label">Sin datos</div></div>`;
  const cls=batteryClass(metric.pct);
  const coverage=Number.isFinite(metric.coverage)?`${fmtDecimal(metric.coverage,1)} días`:'Sin consumo';
  const level=clamp(metric.pct,0,100)/100;
  return `<div class="point-side"><div class="tank ${cls}"><div class="tank-fill" style="--battery-level:${level}"></div><div class="tank-grid"></div><div class="tank-content">${metric.pct}%</div></div><div class="coverage-label">Cobertura: ${coverage}</div></div>`;
};

pointCardHTML=function(doc){
  if(state.loading.has(doc.id)) return `<article class="point-card loading-card"><div class="point-main"><div class="skeleton sk-title"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div></div><div class="skeleton sk-battery"></div></article>`;
  const error=state.errors.get(doc.id);
  if(error) return `<article class="point-card error-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="error-title">No se pudo leer</div><div class="error-text">${esc(error)}</div><div class="metric">Usa el botón general ↻ para volver a actualizar.</div></div></article>`;
  const result=state.results.get(doc.id);
  const metric=result?.currencies?.[settings.selectedCurrency];
  if(!metric) return `<article class="point-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="balance">Sin ${esc(settings.selectedCurrency)}</div><div class="metric">Hoja: ${esc(result?.sheetName||doc.sheet||'—')}</div><div class="metric">Monedas detectadas: ${esc(Object.keys(result?.currencies||{}).join(', ')||'ninguna')}</div></div>${batteryHTML(null)}</article>`;
  const rechargeNeeded=metric.recharge>0.005;
  const rechargeText=rechargeNeeded?`Recargar ${fmtMoney(metric.recharge)} ${esc(settings.selectedCurrency)}`:'Cobertura objetivo completa';
  return `<article class="point-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="balance">${fmtMoney(metric.balance)} ${esc(settings.selectedCurrency)}</div><div class="metric">Promedio: ${fmtMoney(metric.avgDaily)} ${esc(settings.selectedCurrency)}/día</div><div class="metric">Salidas últimos ${esc(settings.avgDays)} días: ${fmtMoney(metric.exitSum)} ${esc(settings.selectedCurrency)}</div><div class="recharge ${rechargeNeeded?'needed':''}">${rechargeText}</div><div class="metric">Datos hasta: ${formatDay(metric.lastDataDay)}</div></div>${batteryHTML(metric)}</article>`;
};

function nexusCurrencySwitchHTML(){
  if(state.view!=='home') return '';
  const selected=settings.selectedCurrency==='USD'?'USD':'CUP';
  return `<div class="currency-switch" role="group" aria-label="Moneda"><button class="currency-switch-option ${selected==='CUP'?'active':''}" data-action="currency" data-currency="CUP">CUP</button><button class="currency-switch-option ${selected==='USD'?'active':''}" data-action="currency" data-currency="USD">USD</button></div>`;
}

topHTML=function(){
  return `<header class="top"><div class="toprow"><div class="brand"><img class="brand-logo" src="https://raw.githubusercontent.com/almoreno01/nexus-control/main/assets/simple-logo.png" alt="Nexus"><div class="brand-copy"><div class="brand-title">Nexus Cobertura</div><div class="brand-subtitle">Control de puntos de efectivo</div></div></div><div class="top-actions">${nexusCurrencySwitchHTML()}${state.view==='home'?`<button class="icon-btn" data-action="refresh-all" title="Actualizar todo" aria-label="Actualizar todo">↻</button>`:''}<button class="icon-btn" data-action="go-settings" title="Ajustes" aria-label="Ajustes">⚙</button></div></div></header>`;
};

homeHTML=function(){
  let content='';
  if(!docs.length){
    content=`<div class="empty"><div class="empty-icon">+</div><h2>Añade una hoja de cálculo de Google</h2><button class="add-btn" data-action="open-add"><span class="plus">+</span><span>Agregar documento</span></button></div>`;
  }else content=`<div class="points">${docs.map(pointCardHTML).join('')}</div>`;
  return `<main class="main"><div class="toolbar"><div class="toolbar-title"><h2>Puntos de efectivo</h2><p>${docs.length} documento${docs.length===1?'':'s'} · promedio ${settings.avgDays} días · cobertura objetivo ${settings.coverageDays} día${Number(settings.coverageDays)===1?'':'s'}</p></div><button class="add-btn" data-action="open-add"><span class="plus">+</span><span class="label">Agregar</span></button></div>${content}</main>`;
};

docMenuHTML=function(){
  if(!state.menuId) return '';
  const doc=docs.find(d=>d.id===state.menuId); if(!doc) return '';
  return `<div class="doc-menu" data-action="close-menu-bg"><div class="sheet-menu" data-menu-sheet><div class="handle"></div><h3>${esc(doc.name)}</h3><button class="menu-option" data-action="edit-doc" data-id="${esc(doc.id)}">✎ Editar nombre, enlace u hoja</button><button class="menu-option danger" data-action="delete-doc" data-id="${esc(doc.id)}">⌫ Eliminar punto</button></div></div>`;
};

settingsHTML=function(){
  return `<main class="main"><div class="toolbar"><div class="toolbar-title"><h2>Ajustes</h2><p>Parámetros globales de cálculo</p></div></div><section class="settings-card"><h3>Cálculo del promedio</h3><p>La app suma las salidas ocurridas dentro de este período y divide entre la cantidad completa de días. Los días sin salidas cuentan como cero.</p><div class="field"><label>Días para calcular promedio</label><input id="avgDays" type="number" min="1" max="3650" step="1" value="${esc(settings.avgDays)}"></div></section><section class="settings-card"><h3>Cobertura del nivel</h3><p>Define cuántos días de salidas promedio deben equivaler al 100% de batería.</p><div class="field"><label>Días de cobertura objetivo</label><input id="coverageDays" type="number" min="0.01" max="3650" step="0.1" value="${esc(settings.coverageDays)}"></div></section><div class="settings-save-wrap"><button class="save-settings" data-action="save-settings">Guardar cambios</button></div></main>`;
};

saveDocFromModal=async function(){
  const name=(document.getElementById('docName')?.value||state._draft?.name||'').trim();
  const url=(document.getElementById('docUrl')?.value||state._draft?.url||'').trim();
  const sheet=document.getElementById('docSheet')?.value||state.detectedSheets[0]||'';
  if(!name||!isGoogleSheetUrl(url)||!sheet){showNotice('Completa el nombre, enlace y hoja.');return;}
  try{
    let id=state.editId;
    if(id){
      const body={name,url,sheet,updated_at:new Date().toISOString()};
      await sbRequest(`nexus_cobertura_docs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      const idx=docs.findIndex(d=>d.id===id); if(idx>=0) docs[idx]={...docs[idx],name,url,sheet};
    }else{
      id=sharedUid();
      const row={id,name,url,sheet,updated_at:new Date().toISOString()};
      await sbRequest('nexus_cobertura_docs',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
      docs.push({id,name,url,sheet});
    }
    originalLocalSaveDocs();
    state.results.delete(id);state.errors.delete(id);state.loading.delete(id);
    state.addOpen=false;state.editId=null;state.detectedSheets=[];state._draft=null;render();
    showNotice('Documento guardado. Toca ↻ para actualizar.');
  }catch(e){showNotice(e?.message||'No se pudo guardar el documento.');}
};

deleteDoc=async function(id){
  const doc=docs.find(d=>d.id===id); if(!doc) return;
  if(!confirm(`¿Eliminar “${doc.name}” de esta app? El Google Sheet no se modifica.`)) return;
  try{
    await sbRequest(`nexus_cobertura_docs?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
    docs=docs.filter(d=>d.id!==id); originalLocalSaveDocs();
    state.results.delete(id);state.errors.delete(id);state.loading.delete(id);state.menuId=null;render();
  }catch(e){showNotice(e?.message||'No se pudo eliminar el documento.');}
};

saveSettingsFromUI=async function(){
  const avg=Math.round(Number(document.getElementById('avgDays')?.value||0));
  const cov=Number(document.getElementById('coverageDays')?.value||0);
  if(!Number.isFinite(avg)||avg<1||avg>3650){showNotice('El promedio debe estar entre 1 y 3650 días.');return;}
  if(!Number.isFinite(cov)||cov<=0||cov>3650){showNotice('La cobertura debe ser mayor que 0 y máximo 3650 días.');return;}
  settings.avgDays=avg; settings.coverageDays=Math.round(cov*100)/100; originalLocalSaveSettings();
  try{
    await pushSettingsNow();
    state.view='home'; render();
    showNotice('Ajustes guardados. Actualizando…');
    await originalRefreshAll(true);
  }catch(e){showNotice(e?.message||'No se pudieron guardar los ajustes.');}
};

refreshAll=async function(force=true){
  try{await pullSharedState({allowMigration:!sharedReady});}
  catch(e){showNotice('No se pudo sincronizar la lista compartida. Se usará la copia disponible en este dispositivo.');}
  return originalRefreshAll(force);
};

// Re-render immediately so patched header/settings/home replace the initial UI.
render();

// Boot from shared state. This also migrates the first device's existing local list once.
refreshAll(true);

// A PWA can remain suspended instead of reloading. Returning to foreground counts as opening it.
let nexusWasHidden=false;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){nexusWasHidden=true;return;}
  if(nexusWasHidden){nexusWasHidden=false;refreshAll(true);}
});
window.addEventListener('pageshow',event=>{if(event.persisted)refreshAll(true);});
