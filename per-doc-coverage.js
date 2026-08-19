'use strict';

// Per-document coverage targets. Average window stays global; battery target is specific to each spreadsheet.
function nexusCoverageValue(value,fallback=1){
  const n=Number(value);
  if(Number.isFinite(n)&&n>0&&n<=3650) return Math.round(n*100)/100;
  const f=Number(fallback);
  return Number.isFinite(f)&&f>0?Math.round(f*100)/100:1;
}
function nexusDocCoverage(doc){
  return nexusCoverageValue(doc?.coverageDays,settings.coverageDays||1);
}

// Use each document's coverage target when calculating target reserve, battery and recharge.
analyzeDoc=async function(doc,force=false){
  const wb=await fetchWorkbook(doc,force);
  const sheetName=doc.sheet || wb.SheetNames?.[0];
  if(!sheetName || !wb.Sheets[sheetName]) throw new Error(`No existe la hoja “${sheetName||'sin nombre'}”.`);
  const matrix=window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,raw:true,defval:''});
  const blocks=findBlocks(matrix);
  if(!blocks.length) throw new Error('No encontré columnas con la estructura ENTRADA / SALIDA / TOTAL.');
  const avgDays=Math.max(1,Number(settings.avgDays)||30);
  const coverageDays=nexusDocCoverage(doc);
  const currencies={};
  for(const block of blocks){
    const result=analyzeBlock(matrix,block,avgDays,coverageDays);
    let key=result.currency;
    if(currencies[key]) key=`${key}_${Object.keys(currencies).filter(x=>x.startsWith(key)).length+1}`;
    currencies[key]=result;
  }
  return {currencies,blocks:blocks.length,sheetName,spreadsheetId:extractId(doc.url),updatedAt:Date.now(),coverageDays};
};

// Shared state now also carries coverage_days on each document.
pullSharedState=async function({allowMigration=false}={}){
  const localDocs=Array.isArray(docs)?docs.map(d=>({...d})):[];
  const hadLocalSettings=localStorage.getItem(SETTINGS_KEY)!==null;
  const localSettings={...settings};
  let [remoteDocs,settingsRows]=await Promise.all([
    sbRequest('nexus_cobertura_docs?select=id,name,url,sheet,coverage_days,created_at,updated_at&order=created_at.asc'),
    sbRequest('nexus_cobertura_settings?id=eq.1&select=id,avg_days,coverage_days,selected_currency,updated_at')
  ]);
  remoteDocs=Array.isArray(remoteDocs)?remoteDocs:[];
  let remoteSettings=Array.isArray(settingsRows)?settingsRows[0]:null;

  if(allowMigration && remoteDocs.length===0 && localDocs.length){
    const migrated=localDocs.filter(d=>d?.name&&d?.url&&d?.sheet).map(d=>({
      id:validUUID(d.id)?d.id:sharedUid(),
      name:String(d.name||'').trim(),
      url:String(d.url||'').trim(),
      sheet:String(d.sheet||'').trim(),
      coverage_days:nexusCoverageValue(d.coverageDays,localSettings.coverageDays||1),
      updated_at:new Date().toISOString()
    }));
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

  applySharedSettings(remoteSettings);
  docs=remoteDocs.map(row=>({
    id:row.id,
    name:row.name,
    url:row.url,
    sheet:row.sheet,
    coverageDays:nexusCoverageValue(row.coverage_days,settings.coverageDays||1)
  }));
  originalLocalSaveDocs();
  originalLocalSaveSettings();
  sharedReady=true;
  render();
};

function nexusCoverageSettingsRows(){
  if(!docs.length) return '<p class="coverage-settings-empty">No hay documentos añadidos.</p>';
  return `<div class="coverage-doc-list">${docs.map(doc=>`<div class="coverage-doc-row"><label for="coverage-${esc(doc.id)}">${esc(doc.name)}</label><div class="coverage-doc-control"><input id="coverage-${esc(doc.id)}" class="doc-coverage-input" data-doc-id="${esc(doc.id)}" type="number" min="0.01" max="3650" step="0.1" inputmode="decimal" value="${esc(nexusDocCoverage(doc))}"><span>días</span></div></div>`).join('')}</div>`;
}

settingsHTML=function(){
  return `<main class="main"><div class="toolbar"><div class="toolbar-title"><h2>Ajustes</h2><p>Parámetros de cálculo</p></div></div><section class="settings-card"><h3>Cálculo del promedio</h3><p>La app suma las salidas ocurridas dentro de este período y divide entre la cantidad completa de días. Los días sin salidas cuentan como cero.</p><div class="field"><label>Días para calcular promedio</label><input id="avgDays" type="number" min="1" max="3650" step="1" value="${esc(settings.avgDays)}"></div></section><section class="settings-card"><h3>Cobertura por documento</h3><p>Define cuántos días de salidas promedio deben equivaler al 100% de batería para cada hoja de cálculo.</p>${nexusCoverageSettingsRows()}</section><div class="settings-save-wrap"><button class="save-settings" data-action="save-settings">Guardar cambios</button></div></main>`;
};

homeHTML=function(){
  let content='';
  if(!docs.length){
    content=`<div class="empty"><div class="empty-icon">+</div><h2>Añade una hoja de cálculo de Google</h2><button class="add-btn" data-action="open-add"><span class="plus">+</span><span>Agregar documento</span></button></div>`;
  }else content=`<div class="points">${docs.map(pointCardHTML).join('')}</div>`;
  return `<main class="main"><div class="toolbar"><div class="toolbar-title"><h2>Puntos de efectivo</h2><p>${docs.length} documento${docs.length===1?'':'s'} · promedio ${settings.avgDays} días · cobertura individual</p></div><button class="add-btn" data-action="open-add"><span class="plus">+</span><span class="label">Agregar</span></button></div>${content}</main>`;
};

saveSettingsFromUI=async function(){
  const avg=Math.round(Number(document.getElementById('avgDays')?.value||0));
  if(!Number.isFinite(avg)||avg<1||avg>3650){showNotice('El promedio debe estar entre 1 y 3650 días.');return;}

  const coverageUpdates=[];
  for(const doc of docs){
    const input=document.getElementById(`coverage-${doc.id}`);
    const value=Number(input?.value);
    if(!Number.isFinite(value)||value<=0||value>3650){showNotice(`Revisa los días de cobertura de ${doc.name}.`);return;}
    coverageUpdates.push({id:doc.id,value:nexusCoverageValue(value,1)});
  }

  settings.avgDays=avg;
  originalLocalSaveSettings();
  try{
    await pushSettingsNow();
    await Promise.all(coverageUpdates.map(item=>sbRequest(`nexus_cobertura_docs?id=eq.${encodeURIComponent(item.id)}`,{
      method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({coverage_days:item.value,updated_at:new Date().toISOString()})
    })));
    const coverageMap=new Map(coverageUpdates.map(item=>[item.id,item.value]));
    docs=docs.map(doc=>coverageMap.has(doc.id)?{...doc,coverageDays:coverageMap.get(doc.id)}:doc);
    originalLocalSaveDocs();
    state.view='home';
    render();
    showNotice('Ajustes guardados. Actualizando…');
    await originalRefreshAll(true);
  }catch(e){showNotice(e?.message||'No se pudieron guardar los ajustes.');}
};

// Preserve per-document coverage when editing; give new documents the current default and refresh them immediately.
saveDocFromModal=async function(){
  const name=(document.getElementById('docName')?.value||state._draft?.name||'').trim();
  const url=(document.getElementById('docUrl')?.value||state._draft?.url||'').trim();
  const sheet=document.getElementById('docSheet')?.value||state.detectedSheets[0]||'';
  if(!name||!isGoogleSheetUrl(url)||!sheet){showNotice('Completa el nombre, enlace y hoja.');return;}
  try{
    const editingId=state.editId;
    let id=editingId;
    if(id){
      const existing=docs.find(d=>d.id===id);
      await sbRequest(`nexus_cobertura_docs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({name,url,sheet,updated_at:new Date().toISOString()})});
      const idx=docs.findIndex(d=>d.id===id);
      if(idx>=0) docs[idx]={...docs[idx],name,url,sheet,coverageDays:nexusDocCoverage(existing)};
    }else{
      id=sharedUid();
      const coverageDays=nexusCoverageValue(settings.coverageDays,1);
      const row={id,name,url,sheet,coverage_days:coverageDays,updated_at:new Date().toISOString()};
      await sbRequest('nexus_cobertura_docs',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
      docs.push({id,name,url,sheet,coverageDays});
    }
    originalLocalSaveDocs();
    state.results.delete(id);state.errors.delete(id);state.loading.delete(id);
    state.addOpen=false;state.editId=null;state.detectedSheets=[];state._draft=null;render();
    if(!editingId){
      showNotice('Documento guardado. Actualizando…');
      await refreshDoc(id,true);
    }else showNotice('Documento guardado.');
  }catch(e){showNotice(e?.message||'No se pudo guardar el documento.');}
};

// Match prior settings behavior: wheel scrolling must not change numeric values.
document.addEventListener('wheel',event=>{
  const input=event.target.closest?.('.doc-coverage-input');
  if(input&&document.activeElement===input) input.blur();
},{capture:true,passive:true});

// Small layout addition for the per-document coverage list.
const nexusCoverageStyle=document.createElement('style');
nexusCoverageStyle.textContent=`
.coverage-doc-list{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.coverage-doc-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:#fff}
.coverage-doc-row label{font-size:14px;font-weight:900;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.coverage-doc-control{display:flex;align-items:center;gap:7px;flex:0 0 auto;color:var(--muted);font-size:12px;font-weight:800}
.coverage-doc-control input{width:82px;text-align:center;border:1px solid var(--line);border-radius:10px;padding:9px 8px;background:#fff;color:var(--text);font-weight:900;outline:none;-moz-appearance:textfield;appearance:textfield}
.coverage-doc-control input::-webkit-outer-spin-button,.coverage-doc-control input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.coverage-settings-empty{margin:12px 0 0;color:var(--muted);font-weight:800}
`;
document.head.appendChild(nexusCoverageStyle);

render();
