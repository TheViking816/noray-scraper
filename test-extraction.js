// Script de prueba para verificar la extracción de fijos sin Puppeteer

const sampleHTML = `
<div align='center'><table width='80%' border=0><tr><td align='center' nowrap><span class=contratado>Con</span><td align='center' nowrap> Contratado (236)&nbsp;&nbsp;<td align='center' nowrap><span class=doble>Dob</span><td align='center' nowrap> Doble (0)&nbsp;&nbsp;<td background='imagenes/chapab.jpg' align='center' halign='center' valign='center' WIDTH=21 HEIGHT=24 nowrap><span class=nocontratado>nCo</span><td align='center' nowrap> No contratado (121)&nbsp;&nbsp;<td align='center' nowrap><span class=anticipado>Ant</span><td align='center' nowrap> Anticipado (562)&nbsp;&nbsp;<td align='center' nowrap><span class=falta>N.D</span><td align='center' nowrap> No Disponible (554)&nbsp;&nbsp;<td align='center' halign='center' valign='center' WIDTH=21 HEIGHT=24 nowrap><span class=excepcion>exc</span><td align='center' nowrap> Con Excepcion (44)&nbsp;&nbsp;</table></div>
`;

console.log('🧪 Probando extracción de fijos...\n');

let fijosResult = 0;

// Método 1: Buscar "No contratado (121)" con variaciones flexibles
console.log('Método 1: Regex flexible con espacios Unicode');
const pattern1Match = sampleHTML.match(/No[\s\u00A0]+contratado[\s\u00A0]*\((\d+)\)/i);
if (pattern1Match) {
  fijosResult = parseInt(pattern1Match[1]);
  console.log('✅ Método 1 exitoso - No contratado:', fijosResult);
} else {
  console.log('❌ Método 1 falló');
}

// Método 2: Buscar variación con &nbsp; literal
if (fijosResult === 0) {
  console.log('\nMétodo 2: Regex con &nbsp; literal');
  const pattern2Match = sampleHTML.match(/No(?:&nbsp;|\s)+contratado(?:&nbsp;|\s)*\((\d+)\)/i);
  if (pattern2Match) {
    fijosResult = parseInt(pattern2Match[1]);
    console.log('✅ Método 2 exitoso - No contratado:', fijosResult);
  } else {
    console.log('❌ Método 2 falló');
  }
}

// Método 3: Buscar en contexto de tabla
if (fijosResult === 0) {
  console.log('\nMétodo 3: Regex con contexto de tabla');
  const pattern3Match = sampleHTML.match(/nocontratado[^>]*>[^<]*<\/span>[^>]*>[\s\S]{0,100}?No[^(]*\((\d+)\)/i);
  if (pattern3Match) {
    fijosResult = parseInt(pattern3Match[1]);
    console.log('✅ Método 3 exitoso - No contratado:', fijosResult);
  } else {
    console.log('❌ Método 3 falló');
  }
}

// Método 4: Contar backgrounds chapab.jpg
if (fijosResult === 0) {
  console.log('\nMétodo 4: Contar backgrounds chapab.jpg');
  const pattern4Matches = [...sampleHTML.matchAll(/background\s*=\s*['"']?imagenes\/chapab\.jpg['"']?/gi)];
  if (pattern4Matches.length > 0) {
    fijosResult = pattern4Matches.length;
    console.log('✅ Método 4 exitoso - Backgrounds encontrados:', fijosResult);
  } else {
    console.log('❌ Método 4 falló');
  }
}

// Método 5: Contar "chapab"
if (fijosResult === 0) {
  console.log('\nMétodo 5: Contar "chapab"');
  const pattern5Matches = [...sampleHTML.matchAll(/chapab/gi)];
  if (pattern5Matches.length > 0) {
    fijosResult = pattern5Matches.length;
    console.log('✅ Método 5 exitoso - "chapab" encontrado:', fijosResult);
  } else {
    console.log('❌ Método 5 falló');
  }
}

console.log('\n📊 Resultado final: fijos =', fijosResult);
console.log(fijosResult === 121 ? '✅ TEST PASADO - Valor correcto extraído (121)' : '❌ TEST FALLIDO - Valor esperado: 121, obtenido: ' + fijosResult);
