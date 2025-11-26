import express from 'express';
import puppeteer from 'puppeteer'; // Aunque es puppeteer-core, lo importamos como puppeteer
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

// Configuración de Puppeteer para Render.com con puppeteer-core
const getBrowserConfig = () => ({
  headless: 'new', // Usa 'new' para el modo headless moderno
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
    // No es necesario --disable-features=VizDisplayCompositor aquí, a menos que sea necesario específicamente
  ],
  // Especificar la ruta al ejecutable de Chromium instalado en Render
  executablePath: '/usr/bin/google-chrome' // Ruta típica en Render para Chromium del sistema
  // Si esta ruta falla, puedes intentar otras como '/usr/bin/chromium-browser' o dejarlo comentado si puppeteer la detecta
});

// Endpoint: Obtener previsión de demanda
app.get('/api/prevision', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping de Previsión...');
    browser = await puppeteer.launch(getBrowserConfig()); // Usa la función de configuración
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

      // Función para extraer grúas de una sección
      const extractGruas = (seccion) => {
        if (!seccion) return 0;
        // Buscar la fila específica que contiene "&nbspGRUAS" y el número en la celda siguiente
        // Patrón: <TD align=left nowrap>&nbspGRUAS<TD align=center nowrap>(número)<TD align=center nowrap>
        const match = seccion.match(/&nbspGRUAS<TD[^>]*align=center[^>]*nowrap[^>]*>(\d+)<TD/);
        return match ? parseInt(match[1], 10) : 0;
      };

      // Función para extraer coches (C2?) de la *otra* tabla
      const extractCochesFromOtherTable = (html) => {
        const coches = { '14-20': 0, '20-02': 0 }; // Solo estos turnos tienen coches en la tabla de C2?

        // Buscar fila con class=TDverde (14-20 H) y número antes de C2?
        // Patrón: class=TDverde[^>]*>14\/20 H<TD[^>]*>(\d+)\s*C2\?
        const match1420 = html.match(/class=TDverde[^>]*>14\/20 H<TD[^>]*>(\d+)\s*C2\?/);
        if (match1420) {
            coches['14-20'] = parseInt(match1420[1], 10);
        }

        // Buscar fila con class=TDrojo (20-02 H) y número antes de C2?
        // Patrón: class=TDrojo[^>]*>20\/02 H<TD[^>]*>(\d+)\s*C2\?
        const match2002 = html.match(/class=TDrojo[^>]*>20\/02 H<TD[^>]*>(\d+)\s*C2\?/);
        if (match2002) {
            coches['20-02'] = parseInt(match2002[1], 10);
        }

        return coches;
      };

      const html = document.body.innerHTML;

      // Extraer secciones por jornada basándonos en las clases de color TDazul, TDverde, TDrojo
      // Encontrar índices de las líneas de hora (TDazul, TDverde, TDrojo)
      const idx0814Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDazul>');
      const idx1420Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDverde>');
      const idx2002Start = html.indexOf('<TD align=left nowrap colspan=8 class=TDrojo>');

      // Calcular límites de secciones
      let idx0814End = idx1420Start;
      if (idx0814End === -1) {
          // Si no hay 14-20, buscar el siguiente TDrojo o el final de la tabla
          idx0814End = html.indexOf('<TD align=left nowrap colspan=8 class=TDrojo>');
          if (idx0814End === -1) {
              const tableEnd = html.indexOf('</TABLE>', idx0814Start);
              idx0814End = tableEnd !== -1 ? tableEnd : html.length;
          }
      }

      let idx1420End = idx2002Start;
      if (idx1420End === -1) {
          // Si no hay 20-02, buscar el final de la tabla
          const tableEnd = html.indexOf('</TABLE>', idx1420Start);
          idx1420End = tableEnd !== -1 ? tableEnd : html.length;
      }

      let idx2002End = html.indexOf('</TABLE>', idx2002Start);
      if (idx2002End === -1) {
          idx2002End = html.length;
      }

      // Extraer grúas de cada sección
      if (idx0814Start !== -1 && idx0814End !== -1) {
        const seccion0814 = html.substring(idx0814Start, idx0814End);
        result['08-14'].gruas = extractGruas(seccion0814);
        // Coches para 08-14 es 0, no aparece en la tabla de C2?
      }

      if (idx1420Start !== -1 && idx1420End !== -1) {
        const seccion1420 = html.substring(idx1420Start, idx1420End);
        result['14-20'].gruas = extractGruas(seccion1420);
        // Coches para 14-20 se extrae de la otra tabla
      }

      if (idx2002Start !== -1 && idx2002End !== -1) {
        const seccion2002 = html.substring(idx2002Start, idx2002End);
        result['20-02'].gruas = extractGruas(seccion2002);
        // Coches para 20-02 se extrae de la otra tabla
      }

      // Extraer coches de la *otra* tabla que no depende de secciones de turno
      const cochesOtraTabla = extractCochesFromOtherTable(html);
      result['14-20'].coches = cochesOtraTabla['14-20'];
      result['20-02'].coches = cochesOtraTabla['20-02'];
      // result['08-14'].coches ya es 0

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
    if (browser) {
        try {
            await browser.close();
        } catch (closeError) {
            console.error('Error cerrando el navegador en prevision:', closeError);
        }
    }
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
    browser = await puppeteer.launch(getBrowserConfig()); // Usa la función de configuración
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
        return parseInt(match[1], 10) || 0;
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
    if (browser) {
        try {
            await browser.close();
        } catch (closeError) {
            console.error('Error cerrando el navegador en chapero:', closeError);
        }
    }
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
    browser = await puppeteer.launch(getBrowserConfig()); // Usa la función de configuración

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

          const extractGruas = (seccion) => {
            if (!seccion) return 0;
            const match = seccion.match(/&nbspGRUAS<TD[^>]*align=center[^>]*nowrap[^>]*>(\d+)<TD/);
            return match ? parseInt(match[1], 10) : 0;
          };

          const extractCochesFromOtherTable = (html) => {
            const coches = { '14-20': 0, '20-02': 0 };

            const match1420 = html.match(/class=TDverde[^>]*>14\/20 H<TD[^>]*>(\d+)\s*C2\?/);
            if (match1420) {
                coches['14-20'] = parseInt(match1420[1], 10);
            }

            const match2002 = html.match(/class=TDrojo[^>]*>20\/02 H<TD[^>]*>(\d+)\s*C2\?/);
            if (match2002) {
                coches['20-02'] = parseInt(match2002[1], 10);
            }

            return coches;
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
          }

          if (idx1420Start !== -1 && idx1420End !== -1) {
            const seccion1420 = html.substring(idx1420Start, idx1420End);
            result['14-20'].gruas = extractGruas(seccion1420);
          }

          if (idx2002Start !== -1 && idx2002End !== -1) {
            const seccion2002 = html.substring(idx2002Start, idx2002End);
            result['20-02'].gruas = extractGruas(seccion2002);
          }

          const cochesOtraTabla = extractCochesFromOtherTable(html);
          result['14-20'].coches = cochesOtraTabla['14-20'];
          result['20-02'].coches = cochesOtraTabla['20-02'];

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
          if (match) return parseInt(match[1], 10) || 0;

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
    if (browser) {
        try {
            await browser.close();
        } catch (closeError) {
            console.error('Error cerrando el navegador en all:', closeError);
        }
    }
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
