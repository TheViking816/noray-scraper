// server.js

const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());

// Función para extraer datos del HTML de Prevision Demanda
function parseHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Inicializar el objeto de resultados
  const result = {
    success: true,
    timestamp: new Date().toISOString(),
    demandas: {
      "08-14": { gruas: 0, coches: 0 },
      "14-20": { gruas: 0, coches: 0 },
      "20-02": { gruas: 0, coches: 0 }
    },
    fijos: 0 // Inicializamos fijos
  };

  // 1. Extraer las grúas por turno
  // Buscamos filas que contengan "GRUAS" y el número en la siguiente celda <TD>
  const filasGruas = doc.querySelectorAll('TR');
  for (let fila of filasGruas) {
    const celdas = fila.querySelectorAll('TD');
    // Verificar si la primera celda contiene "GRUAS"
    if (celdas.length > 0 && celdas[0].textContent.trim() === '&nbspGRUAS') {
      // La estructura es: [0]=Nombre, [1]=Gruas, [2]=Coches, ..., [6]=Asignados
      // Extraemos el número de la celda 1 (índice 0-based)
      const numeroGruasText = celdas[1]?.textContent?.trim();
      const numeroGruas = numeroGruasText && !isNaN(numeroGruasText) ? parseInt(numeroGruasText, 10) : 0;

      // Determinar a qué turno pertenece según el color de la celda anterior
      // Buscamos la celda que contiene la hora (TDazul, TDverde, TDrojo)
      let turno = null;
      // Iteramos hacia atrás en las filas anteriores a ver si encontramos el turno
      let filaAnterior = fila.previousElementSibling;
      while (filaAnterior && !turno) {
        const celdasTurno = filaAnterior.querySelectorAll('TD');
        for (let c of celdasTurno) {
          if (c.classList.contains('TDazul')) turno = '08-14';
          else if (c.classList.contains('TDverde')) turno = '14-20';
          else if (c.classList.contains('TDrojo')) turno = '20-02';
          if (turno) break;
        }
        filaAnterior = filaAnterior.previousElementSibling;
      }

      if (turno && result.demandas[turno]) {
        result.demandas[turno].gruas = numeroGruas;
      }
    }
  }

  // 2. Extraer los coches por turno
  // La información de los coches está en una tabla diferente
  // Buscamos filas en la segunda tabla que contiene los coches
  const tablas = doc.querySelectorAll('TABLE');
  // La tabla de coches es la que tiene una estructura específica con las horas coloreadas
  for (let tabla of tablas) {
    const filas = tabla.querySelectorAll('TR');
    for (let fila of filas) {
      const celdas = fila.querySelectorAll('TD');
      // Buscamos una fila que contenga información de coches (la que tiene "C2?" y "tc")
      if (celdas.length >= 5 && celdas[3]?.textContent?.includes('C2')) {
        // Esta fila contiene la info de coches por turno
        // Estructura: [0]=hora azul, [1]=hora verde, [2]=texto, [3]=coches turno 14-20, [4]=texto, [5]=coches turno 20-02, [6]=texto
        // Buscamos el patrón "X C2?" en la celda de la derecha de la hora
        // Turno 14-20: celda [3] debería tener "18 C2?"
        // Turno 20-02: celda [5] debería tener "3 C2?"
        const texto14_20 = celdas[3]?.textContent?.trim();
        const texto20_02 = celdas[5]?.textContent?.trim();

        // Extraer número antes de "C2?"
        const match14_20 = texto14_20.match(/(\d+)\s*C2/);
        const match20_02 = texto20_02.match(/(\d+)\s*C2/);

        if (match14_20) {
            result.demandas["14-20"].coches = parseInt(match14_20[1], 10);
        }
        if (match20_02) {
            result.demandas["20-02"].coches = parseInt(match20_02[1], 10);
        }
        // El turno 08-14 no tiene coches en este ejemplo, pero la lógica general asume 0 si no se encuentra.
        // No es necesario hacer nada más aquí para 08-14, ya está inicializado a 0.
      }
    }
  }


  // 3. Extraer el número de fijos (chaparos contratados)
  // Buscamos en el HTML de la página Chapero
  // La lógica es contar cuántos elementos span tienen la clase 'contratado'
  // Si parseHTML se llama con el HTML de Chapero, usamos esta lógica:
  // Para esta función, asumimos que recibe el HTML de Prevision Demanda.
  // El número de fijos parece provenir de otra fuente o se calcula de otra manera.
  // Sin embargo, en el ejemplo de salida esperada, fijos = 103.
  // Mirando el HTML de Chapero, parece que los 'contratado' son los fijos.
  // La lógica de scraping para fijos debe estar en la función scrapeChaparoData.
  // Si parseHTML recibe el HTML de Chapero, entonces:
  const contratados = doc.querySelectorAll('span.contratado');
  // Este cálculo solo es válido si parseHTML recibe el HTML de Chapero
  // Si recibe el de Prevision Demanda, fijos debe calcularse o pasarse de otra manera.
  // Dado el contexto, parseHTML recibe Prevision Demanda, y fijos se obtiene de scrapeChaparoData.
  // Por lo tanto, dejamos fijos en 0 aquí y lo actualizamos en la función principal.

  return result;
}

// Función para extraer datos del HTML de Chaparo
function parseChaparoHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const contratados = doc.querySelectorAll('span.contratado');
    return contratados.length;
}

// Función para hacer scraping de la página de demanda
async function scrapeDemandData(page) {
  await page.goto('https://portal.cpevalencia.com/noray/previsionDemanda.jsp', { waitUntil: 'networkidle2' });
  const html = await page.content();
  return parseHTML(html);
}

// Función para hacer scraping de la página de chaparos
async function scrapeChaparoData(page) {
  await page.goto('https://portal.cpevalencia.com/noray/chapero.jsp', { waitUntil: 'networkidle2' });
  const html = await page.content();
  return parseChaparoHTML(html); // Esta función devuelve solo el número de fijos
}


app.get('/api/demandas', async (req, res) => {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true }); // Asegúrate de usar headless: true en producción
    const page = await browser.newPage();

    // Realiza ambas solicitudes de scraping
    const [demandasData, chaparoData] = await Promise.all([
      scrapeDemandData(page),
      scrapeChaparoData(page)
    ]);

    // Combina los resultados
    demandasData.fijos = chaparoData; // Asigna el número de fijos obtenido de la otra página

    res.json(demandasData);

  } catch (error) {
    console.error('Error scraping data:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
