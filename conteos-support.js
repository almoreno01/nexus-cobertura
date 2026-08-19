'use strict';

// Support for CONTEOS-style sheets such as PALMIRA / ELISABET.
// Structure: FECHA | ENTRADA | CONTADO | RESULTADO | SALIDA | DESCRIPCION | TOTAL S/C | TOTAL C | ...
const nexusBaseFindBlocks = findBlocks;
findBlocks = function(matrix){
  const blocks = nexusBaseFindBlocks(matrix);
  const maxHeaderRows = Math.min(matrix.length, 20);

  for(let r=0;r<maxHeaderRows;r++){
    const row = matrix[r] || [];
    const dateCol = findHeaderCell(row,'FECHA',0,row.length-1);
    const entryCol = findHeaderCell(row,'ENTRADA',0,row.length-1);
    const countedCol = findHeaderCell(row,'CONTADO',0,row.length-1);
    const resultCol = findHeaderCell(row,'RESULTADO',0,row.length-1);
    const exitCol = findHeaderCell(row,'SALIDA',0,row.length-1);
    const descCol = findHeaderCell(row,'DESCRIPCION',0,row.length-1);

    let totalCCol = -1;
    for(let c=0;c<row.length;c++){
      if(normalizeText(row[c])==='TOTAL C'){ totalCCol=c; break; }
    }

    const isConteosLayout = dateCol===0 && entryCol===1 && countedCol===2 && resultCol===3 && exitCol===4 && descCol===5 && totalCCol>=0;
    if(!isConteosLayout) continue;
    if(blocks.some(b=>b.headerRow===r && b.exitCol===exitCol)) continue;

    blocks.push({
      headerRow:r,
      dateCol,
      entryCol,
      exitCol,
      descCol,
      totalCol:totalCCol,
      currency:inferCurrency(matrix,r,dateCol,totalCCol,blocks.length)
    });
  }

  return blocks;
};

// Recalculate after installing the detector so already-added CONTEOS sheets are recognized immediately.
if(Array.isArray(docs) && docs.length) refreshAll(true);
