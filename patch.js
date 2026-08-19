'use strict';

// Nexus Cobertura UI/refresh policy patch.
ensureSelectedCurrency = function(){
  if(!['CUP','USD'].includes(settings.selectedCurrency)){
    settings.selectedCurrency='CUP';
    saveSettings();
  }
};

batteryHTML = function(metric){
  if(!metric) return `<div class="point-side"><div class="tank mid"><div class="tank-fill" style="--battery-level:0"></div><div class="tank-grid"></div><div class="tank-content">—</div></div><div class="coverage-label">Sin datos</div></div>`;
  const cls=batteryClass(metric.pct);
  const coverage=Number.isFinite(metric.coverage)?`${fmtDecimal(metric.coverage,1)} días`:'Sin consumo';
  const level=clamp(metric.pct,0,100)/100;
  return `<div class="point-side"><div class="tank ${cls}"><div class="tank-fill" style="--battery-level:${level}"></div><div class="tank-grid"></div><div class="tank-content">${metric.pct}%</div></div><div class="coverage-label">Cobertura: ${coverage}</div></div>`;
};

pointCardHTML = function(doc){
  if(state.loading.has(doc.id)){
    return `<article class="point-card loading-card"><div class="point-main"><div class="skeleton sk-title"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div></div><div class="skeleton sk-battery"></div></article>`;
  }
  const error=state.errors.get(doc.id);
  if(error){
    return `<article class="point-card error-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="error-title">No se pudo leer</div><div class="error-text">${esc(error)}</div><div class="metric">Usa el botón general ↻ para volver a actualizar.</div></div></article>`;
  }
  const result=state.results.get(doc.id);
  const metric=result?.currencies?.[settings.selectedCurrency];
  if(!metric){
    return `<article class="point-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="balance">Sin ${esc(settings.selectedCurrency)}</div><div class="metric">Hoja: ${esc(result?.sheetName||doc.sheet||'—')}</div><div class="metric">Monedas detectadas: ${esc(Object.keys(result?.currencies||{}).join(', ')||'ninguna')}</div></div>${batteryHTML(null)}</article>`;
  }
  const rechargeNeeded=metric.recharge>0.005;
  const rechargeText=rechargeNeeded?`Recargar ${fmtMoney(metric.recharge)} ${esc(settings.selectedCurrency)}`:'Cobertura objetivo completa';
  return `<article class="point-card"><div class="point-main"><div class="point-heading"><div class="point-name">${esc(doc.name)}</div><button class="menu-dots" data-action="menu" data-id="${esc(doc.id)}">•••</button></div><div class="balance">${fmtMoney(metric.balance)} ${esc(settings.selectedCurrency)}</div><div class="metric">Promedio: ${fmtMoney(metric.avgDaily)} ${esc(settings.selectedCurrency)}/día</div><div class="metric">Salidas últimos ${esc(settings.avgDays)} días: ${fmtMoney(metric.exitSum)} ${esc(settings.selectedCurrency)}</div><div class="recharge ${rechargeNeeded?'needed':''}">${rechargeText}</div><div class="metric">Datos hasta: ${formatDay(metric.lastDataDay)}</div></div>${batteryHTML(metric)}</article>`;
};

function nexusCurrencySwitchHTML(){
  if(state.view!=='home') return '';
  const selected=settings.selectedCurrency==='USD'?'USD':'CUP';
  return `<div class="currency-switch" role="group" aria-label="Moneda"><button class="currency-switch-option ${selected==='CUP'?'active':''}" data-action="currency" data-currency="CUP">CUP</button><button class="currency-switch-option ${selected==='USD'?'active':''}" data-action="currency" data-currency="USD">USD</button></div>`;
}

topHTML = function(){
  return `<header class="top"><div class="toprow"><div class="brand"><img class="brand-logo" src="https://raw.githubusercontent.com/almoreno01/nexus-control/main/assets/simple-logo.png" alt="Nexus"><div class="brand-copy"><div class="brand-title">Nexus Cobertura</div><div class="brand-subtitle">Control de puntos de efectivo</div></div></div><div class="top-actions">${nexusCurrencySwitchHTML()}${state.view==='home'?`<button class="icon-btn" data-action="refresh-all" title="Actualizar todo" aria-label="Actualizar todo">↻</button>`:''}<button class="icon-btn" data-action="go-settings" title="Ajustes" aria-label="Ajustes">⚙</button></div></div></header>`;
};

homeHTML = function(){
  let content='';
  if(!docs.length){
    content=`<div class="empty"><div class="empty-icon">+</div><h2>Aún no hay puntos</h2><p>Agrega un Google Spreadsheet. La app leerá sus salidas, calculará el promedio diario y convertirá el saldo actual en días de cobertura y porcentaje de batería.</p><button class="add-btn" data-action="open-add"><span class="plus">+</span><span>Agregar documento</span></button></div>`;
  }else{
    content=`<div class="points">${docs.map(pointCardHTML).join('')}</div>`;
  }
  return `<main class="main"><div class="toolbar"><div class="toolbar-title"><h2>Puntos de efectivo</h2><p>${docs.length} documento${docs.length===1?'':'s'} · promedio ${settings.avgDays} días · cobertura objetivo ${settings.coverageDays} día${Number(settings.coverageDays)===1?'':'s'}</p></div><button class="add-btn" data-action="open-add"><span class="plus">+</span><span class="label">Agregar</span></button></div><div class="info-banner ${navigator.onLine?'':'warn'}"><span>${navigator.onLine?'●':'!'}</span><span>${navigator.onLine?'Los valores se leen directamente desde Google Sheets al abrir la app o al tocar ↻.':'Sin conexión: no se pueden recalcular los puntos hasta recuperar Internet.'}</span></div>${content}</main>`;
};

docMenuHTML = function(){
  if(!state.menuId) return '';
  const doc=docs.find(d=>d.id===state.menuId); if(!doc) return '';
  return `<div class="doc-menu" data-action="close-menu-bg"><div class="sheet-menu" data-menu-sheet><div class="handle"></div><h3>${esc(doc.name)}</h3><button class="menu-option" data-action="edit-doc" data-id="${esc(doc.id)}">✎ Editar nombre, enlace u hoja</button><button class="menu-option danger" data-action="delete-doc" data-id="${esc(doc.id)}">⌫ Eliminar punto</button></div></div>`;
};

settingsHTML = function(){
  return `<main class="main"><div class="toolbar"><div class="toolbar-title"><h2>Ajustes</h2><p>Parámetros globales de cálculo</p></div></div><section class="settings-card"><h3>Cálculo del promedio</h3><p>La app suma las salidas ocurridas dentro de este período y divide entre la cantidad completa de días. Los días sin salidas cuentan como cero.</p><div class="field"><label>Días para calcular promedio</label><input id="avgDays" type="number" min="1" max="3650" step="1" value="${esc(settings.avgDays)}"></div></section><section class="settings-card"><h3>Cobertura del nivel</h3><p>Define cuántos días de salidas promedio deben equivaler al 100% de batería.</p><div class="field"><label>Días de cobertura objetivo</label><input id="coverageDays" type="number" min="0.01" max="3650" step="0.1" value="${esc(settings.coverageDays)}"></div><div class="formula"><div class="formula-title">Fórmula</div><code>Reserva objetivo = promedio diario × días de cobertura<br>Batería = saldo actual ÷ reserva objetivo × 100<br>Recarga = max(0, reserva objetivo − saldo actual)</code></div><button class="save-settings" data-action="save-settings">Guardar ajustes</button></section><section class="settings-card"><h3>Origen de datos</h3><p>No hay usuarios ni base de datos interna. Cada Google Spreadsheet es la fuente de verdad. Para poder leerlo sin inicio de sesión, debe estar compartido como “Cualquier persona con el vínculo · Lector”.</p></section></main>`;
};

saveDocFromModal = async function(){
  const name=(document.getElementById('docName')?.value||state._draft?.name||'').trim();
  const url=(document.getElementById('docUrl')?.value||state._draft?.url||'').trim();
  const sheet=document.getElementById('docSheet')?.value||state.detectedSheets[0]||'';
  if(!name||!isGoogleSheetUrl(url)||!sheet){showNotice('Completa el nombre, enlace y hoja.');return;}
  if(state.editId){
    const idx=docs.findIndex(d=>d.id===state.editId); if(idx>=0)docs[idx]={...docs[idx],name,url,sheet};
  }else docs.push({id:uid(),name,url,sheet});
  saveDocs();
  const id=state.editId || docs[docs.length-1].id;
  state.results.delete(id);state.errors.delete(id);state.loading.delete(id);
  state.addOpen=false;state.editId=null;state.detectedSheets=[];state._draft=null;render();
  showNotice('Punto guardado. Usa ↻ para actualizar los datos.');
};

saveSettingsFromUI = function(){
  const avg=Math.round(Number(document.getElementById('avgDays')?.value||0));
  const cov=Number(document.getElementById('coverageDays')?.value||0);
  if(!Number.isFinite(avg)||avg<1||avg>3650){showNotice('El promedio debe estar entre 1 y 3650 días.');return;}
  if(!Number.isFinite(cov)||cov<=0||cov>3650){showNotice('La cobertura debe ser mayor que 0 y máximo 3650 días.');return;}
  settings.avgDays=avg;settings.coverageDays=Math.round(cov*100)/100;saveSettings();
  state.results.clear();state.errors.clear();state.loading.clear();state.view='home';render();
  showNotice('Ajustes guardados. Usa ↻ para recalcular.');
};

// Re-render immediately so the patched header/menu replaces the initial UI.
render();

// A PWA can remain suspended instead of reloading. Treat returning to the foreground as opening it again.
let nexusWasHidden=false;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){nexusWasHidden=true;return;}
  if(nexusWasHidden && docs.length){nexusWasHidden=false;refreshAll(true);}
});
window.addEventListener('pageshow',event=>{ if(event.persisted && docs.length) refreshAll(true); });
