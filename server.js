import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Habilitar CORS para tu PWA
app.use(cors({
  origin: '*', // En producción, reemplaza con tu dominio específico
  methods: ['GET', 'POST']
}));

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Noray Scraper API v1.0',
    endpoints: {
      prevision: '/api/prevision',
      chapero: '/api/chapero',
      all: '/api/all'
    }
  });
});

// Configuración de Puppeteer para Render.com
const getBrowserConfig = () => ({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
  // Puppeteer descargará y usará su propio Chromium
});

// Endpoint: Obtener previsión de demanda
app.get('/api/prevision', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping de Previsión...');
    browser = await puppeteer.launch(getBrowserConfig());
    const page = await browser.newPage();

    await page.goto('https://noray.cpevalencia.com/PrevisionDemanda.asp', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Extraer datos usando el mismo HTML que analizamos
    const demandas = await page.evaluate(() => {
      const result = {
        '08-14': { gruas: 0, coches: 0 },
        '14-20': { gruas: 0, coches: 0 },
        '20-02': { gruas: 0, coches: 0 }
      };

      // Función para extraer grúas de una sección específica del HTML
      const extractGruas = (seccionHTML) => {
        // Buscar la fila que contiene "&nbspGRUAS" y obtener el número de la celda siguiente
        // Patrón: <TD align=left nowrap>&nbspGRUAS<TD align=center nowrap>(número)<TD align=center nowrap>
        const match = seccionHTML.match(/&nbspGRUAS<TD[^>]*align=center[^>]*nowrap[^>]*>(\d+)<TD/);
        return match ? parseInt(match[1], 10) : 0;
      };

      // Función para extraer coches (ROLON de GRUPO III) de una sección específica del HTML
      const extractCoches = (seccionHTML) => {
        // Buscar la fila que contiene "&nbspGRUPO III"
        // La estructura es: [0]Nombre [1]CONT [2]LO-LO [3]GRANEL [4]ROLON [5]R/E [6]ASIGNADOS
        // Patrón: <TD align=left nowrap>&nbspGRUPO III<TD ...>(n1)<TD ...>(n2)<TD ...>(n3)<TD ...>(n4)<TD ...>(n5)<Th ...>(n6)
        const grupoIIIStartIndex = seccionHTML.indexOf('&nbspGRUPO III');
        if (grupoIIIStartIndex === -1) return 0; // No encontramos la fila

        const substring = seccionHTML.substring(grupoIIIStartIndex);
        // Extraer los números de las celdas <TD> o <Th> siguientes
        // Usamos una expresión regular global para encontrar todas las coincidencias de números en celdas
        const numbers = [];
        const regex = /<T[DH][^>]*>(\d+)<\/T[DH]>/g;
        let match;
        let searchStartIndex = 0;

        // Saltamos las primeras 4 coincidencias (Nombre, CONT, LO-LO, GRANEL)
        for (let i = 0; i < 4; i++) {
          match = regex.exec(substring);
          if (!match) break;
        }

        // La quinta coincidencia es ROLON (índice 4 en la fila GRUPO III, índice 0 después de saltar 4)
        match = regex.exec(substring);
        if (match) {
            numbers.push(parseInt(match[1], 10));
        }

        // La sexta coincidencia es R/E
        match = regex.exec(substring);
        if (match) {
            numbers.push(parseInt(match[1], 10));
        }

        // La séptima coincidencia es ASIGNADOS (Th)
        match = regex.exec(substring);
        if (match) {
            numbers.push(parseInt(match[1], 10));
        }

        // El valor de ROLON es el primer número encontrado (después de saltar nombre y 3 categorías)
        return numbers.length > 0 ? numbers[0] : 0;
      };

      // Extraer secciones por jornada basándonos en las clases de color
      const html = document.body.innerHTML;

      // Encontrar índices de las líneas de hora (TDazul, TDverde, TDrojo)
      const idx0814Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDazul>');
      const idx1420Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDverde>');
      const idx2002Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDrojo>');

      // Encontrar el final de la sección de 08-14 (inicio de 14-20 o inicio de 14-20 H)
      let idx0814End = idx1420Start;
      if (idx0814End === -1) {
          // Si no hay 14-20, buscar el siguiente TDazul o TDrojo o el final de la tabla
          idx0814End = html.indexOf('<TD align=left nowrap colspan=8 class=TDrojo>');
          if (idx0814End === -1) {
              const tableEnd = html.indexOf('</TABLE>', idx0814Start);
              idx0814End = tableEnd !== -1 ? tableEnd : html.length;
          }
      }

      // Encontrar el final de la sección de 14-20 (inicio de 20-02 o inicio de 20-02 H)
      let idx1420End = idx2002Start;
      if (idx1420End === -1) {
          const tableEnd = html.indexOf('</TABLE>', idx1420Start);
          idx1420End = tableEnd !== -1 ? tableEnd : html.length;
      }

      // Encontrar el final de la sección de 20-02
      let idx2002End = html.indexOf('</TABLE>', idx2002Start);
      if (idx2002End === -1) {
          idx2002End = html.length;
      }


      if (idx0814Start !== -1 && idx0814End !== -1) {
        const seccion0814 = html.substring(idx0814Start, idx0814End);
        result['08-14'].gruas = extractGruas(seccion0814);
        result['08-14'].coches = extractCoches(seccion0814); // Debería ser 0
      }

      if (idx1420Start !== -1 && idx1420End !== -1) {
        const seccion1420 = html.substring(idx1420Start, idx1420End);
        result['14-20'].gruas = extractGruas(seccion1420);
        result['14-20'].coches = extractCoches(seccion1420); // Debería ser 3 (R/E)
      }

      if (idx2002Start !== -1 && idx2002End !== -1) {
        const seccion2002 = html.substring(idx2002Start, idx2002End);
        result['20-02'].gruas = extractGruas(seccion2002);
        result['20-02'].coches = extractCoches(seccion2002); // Debería ser 8 (ROLON)
      }

      return result;
    });

    await browser.close();
    console.log('✅ Previsión obtenida:', demandas);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      demandas
    });

  } catch (error) {
    console.error('❌ Error en scraping de previsión:', error);
    if (browser) await browser.close();
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint: Obtener chapero (fijos disponibles)
app.get('/api/chapero', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping de Chapero...');
    browser = await puppeteer.launch(getBrowserConfig());
    const page = await browser.newPage();

    await page.goto('https://noray.cpevalencia.com/Chapero.asp', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Extraer fijos no contratados
    const fijos = await page.evaluate(() => {
      const html = document.body.innerHTML;

      // Método 1: Buscar "No contratado (XXX)"
      const match = html.match(/No\s+contratado\s+\((\d+)\)/i);
      if (match) {
        return parseInt(match[1]) || 0;
      }

      // Método 2: Contar elementos con background='imagenes/chapab.jpg'
      const bgMatches = html.match(/background='imagenes\/chapab\.jpg'/gi);
      return bgMatches ? bgMatches.length : 0;
    });

    await browser.close();
    console.log('✅ Chapero obtenido:', fijos);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      fijos
    });

  } catch (error) {
    console.error('❌ Error en scraping de chapero:', error);
    if (browser) await browser.close();
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint: Obtener todo (previsión + chapero)
app.get('/api/all', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping completo...');
    browser = await puppeteer.launch(getBrowserConfig());

    // Crear dos páginas en paralelo para ir más rápido
    const [page1, page2] = await Promise.all([
      browser.newPage(),
      browser.newPage()
    ]);

    // Scraping en paralelo
    const [demandasResult, fijosResult] = await Promise.all([
      // Previsión
      (async () => {
        await page1.goto('https://noray.cpevalencia.com/PrevisionDemanda.asp', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        return await page1.evaluate(() => {
          const result = {
            '08-14': { gruas: 0, coches: 0 },
            '14-20': { gruas: 0, coches: 0 },
            '20-02': { gruas: 0, coches: 0 }
          };

          const extractGruas = (seccionHTML) => {
            const match = seccionHTML.match(/&nbspGRUAS<TD[^>]*align=center[^>]*nowrap[^>]*>(\d+)<TD/);
            return match ? parseInt(match[1], 10) : 0;
          };

          const extractCoches = (seccionHTML) => {
            const grupoIIIStartIndex = seccionHTML.indexOf('&nbspGRUPO III');
            if (grupoIIIStartIndex === -1) return 0;

            const substring = seccionHTML.substring(grupoIIIStartIndex);
            const numbers = [];
            const regex = /<T[DH][^>]*>(\d+)<\/T[DH]>/g;
            let match;
            let searchStartIndex = 0;

            for (let i = 0; i < 4; i++) {
              match = regex.exec(substring);
              if (!match) break;
            }

            match = regex.exec(substring);
            if (match) { numbers.push(parseInt(match[1], 10)); } // ROLON o R/E
            match = regex.exec(substring);
            if (match) { numbers.push(parseInt(match[1], 10)); } // R/E o ASIGNADOS
            match = regex.exec(substring);
            if (match) { numbers.push(parseInt(match[1], 10)); } // ASIGNADOS

            // Para 14-20, es R/E (índice 1 después de saltar 4), para 20-02 es ROLON (índice 0)
            // La lógica original buscaba ROLON (índice 0). Revisamos:
            // 14-20: GRUPO III <TD>17</TD><TD></TD><TD></TD><TD>3</TD><TD>1</TD> -> ROLON=3, R/E=1
            // 20-02: GRUPO III <TD>18</TD><TD></TD><TD></TD><TD>8</TD><TD></TD> -> ROLON=8, R/E=0
            // La columna 4 (índice 3) es ROLON, la 5 (índice 4) es R/E.
            // Nuestra lógica de salto de 4 y tomar el siguiente debería coger ROLON.
            // Si la lógica de salto de 4 no es robusta, usamos una regex más específica.
            // Busquemos específicamente GRUPO III y luego el 4to y 5to número.
            const numsRegex = /<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)/;

            const grupoMatch = seccionHTML.match(/&nbspGRUPO III<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)<Th/);
            if (grupoMatch) {
                // grupoMatch[1] = CONT, [2] = LO-LO, [3] = GRANEL, [4] = ROLON, [5] = R/E
                // Devolvemos ROLON ([4])
                return parseInt(grupoMatch[4]) || 0;
            }
            return 0; // Si no encuentra la fila o la estructura no coincide
          };


          const html = document.body.innerHTML;
          const idx0814Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDazul>');
          const idx1420Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDverde>');
          const idx2002Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDrojo>');

          let idx0814End = idx1420Start;
          if (idx0814End === -1) {
              idx0814End = html.indexOf('<TD align=left nowrap colspan=8 class=TDrojo>');
              if (idx0814End === -1) {
                  const tableEnd = html.indexOf('</TABLE>', idx0814Start);
                  idx0814End = tableEnd !== -1 ? tableEnd : html.length;
              }
          }

          let idx1420End = idx2002Start;
          if (idx1420End === -1) {
              const tableEnd = html.indexOf('</TABLE>', idx1420Start);
              idx1420End = tableEnd !== -1 ? tableEnd : html.length;
          }

          let idx2002End = html.indexOf('</TABLE>', idx2002Start);
          if (idx2002End === -1) {
              idx2002End = html.length;
          }

          if (idx0814Start !== -1 && idx0814End !== -1) {
            const seccion0814 = html.substring(idx0814Start, idx0814End);
            result['08-14'].gruas = extractGruas(seccion0814);
            result['08-14'].coches = extractCoches(seccion0814); // 0
          }

          if (idx1420Start !== -1 && idx1420End !== -1) {
            const seccion1420 = html.substring(idx1420Start, idx1420End);
            result['14-20'].gruas = extractGruas(seccion1420);
            result['14-20'].coches = extractCoches(seccion1420); // 3 (R/E)
          }

          if (idx2002Start !== -1 && idx2002End !== -1) {
            const seccion2002 = html.substring(idx2002Start, idx2002End);
            result['20-02'].gruas = extractGruas(seccion2002);
            result['20-02'].coches = extractCoches(seccion2002); // 8 (ROLON)
          }

          return result;
        });
      })(),

      // Chapero
      (async () => {
        await page2.goto('https://noray.cpevalencia.com/Chapero.asp', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        return await page2.evaluate(() => {
          const html = document.body.innerHTML;
          const match = html.match(/No\s+contratado\s+\((\d+)\)/i);
          if (match) return parseInt(match[1]) || 0;

          const bgMatches = html.match(/background='imagenes\/chapab\.jpg'/gi);
          return bgMatches ? bgMatches.length : 0;
        });
      })()
    ]);

    await browser.close();

    console.log('✅ Scraping completo:', { demandas: demandasResult, fijos: fijosResult });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      demandas: demandasResult,
      fijos: fijosResult
    });

  } catch (error) {
    console.error('❌ Error en scraping completo:', error);
    if (browser) await browser.close();
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Noray Scraper API ejecutándose en puerto ${PORT}`);
  console.log(`📍 Endpoints disponibles:`);
  console.log(`   GET /api/prevision - Obtener previsión de demanda`);
  console.log(`   GET /api/chapero - Obtener fijos disponibles`);
  console.log(`   GET /api/all - Obtener todo`);
});
