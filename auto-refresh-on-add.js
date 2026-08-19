'use strict';

// After a new Google Sheet is added, calculate it immediately.
const nexusSaveDocFromModal = saveDocFromModal;
saveDocFromModal = async function(){
  const previousIds = new Set(docs.map(doc => doc.id));
  await nexusSaveDocFromModal();
  const addedDoc = docs.find(doc => !previousIds.has(doc.id));
  if(!addedDoc) return;
  showNotice('Documento guardado. Actualizando…');
  await refreshDoc(addedDoc.id, true);
};
