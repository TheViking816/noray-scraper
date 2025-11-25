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
// Usar Chromium preinstalado en Render en lugar de descargarlo
const getBrowserConfig = () => {
  const config = {
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
  };

  // Si estamos en Render, usar su Chromium
  if (process.env.RENDER) {
    config.executablePath = '/usr/bin/chromium-browser';
  }

  return config;
};

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

      // Función para extraer grúas de una sección
      const extractGruas = (seccion) => {
        if (!seccion) return 0;
        // Buscar "GRUAS" seguido de <Th> con el número
        const match = seccion.match(/GRUAS.*?<Th[^>]*>(\d+)/is);
        return match ? parseInt(match[1]) : 0;
      };

      // Función para extraer coches (ROLON de GRUPO III)
      const extractCoches = (seccion) => {
        if (!seccion) return 0;
        // Buscar GRUPO III y extraer números de las celdas TD
        const grupoMatch = seccion.match(/GRUPO III.*?(?=<TR|<\/TABLE)/is);
        if (!grupoMatch) return 0;

        const numeros = [];
        const regex = /<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)/gi;
        let m;
        while ((m = regex.exec(grupoMatch[0])) !== null && numeros.length < 5) {
          numeros.push(parseInt(m[1]) || 0);
        }
        // ROLON es el 4to número (índice 3)
        return numeros.length >= 4 ? numeros[3] : 0;
      };

      const html = document.body.innerHTML;

      // Extraer secciones por jornada
      const idx0814Start = html.indexOf('TDazul');
      const idx1420Start = html.indexOf('TDverde');
      const idx2002Start = html.indexOf('TDrojo');

      if (idx0814Start !== -1 && idx1420Start !== -1) {
        const seccion0814 = html.substring(idx0814Start, idx1420Start);
        result['08-14'].gruas = extractGruas(seccion0814);
        result['08-14'].coches = extractCoches(seccion0814);
      }

      if (idx1420Start !== -1 && idx2002Start !== -1) {
        const seccion1420 = html.substring(idx1420Start, idx2002Start);
        result['14-20'].gruas = extractGruas(seccion1420);
        result['14-20'].coches = extractCoches(seccion1420);
      }

      if (idx2002Start !== -1) {
        const idxEnd = html.indexOf('</TABLE>', idx2002Start);
        const seccion2002 = html.substring(idx2002Start, idxEnd !== -1 ? idxEnd : html.length);
        result['20-02'].gruas = extractGruas(seccion2002);
        result['20-02'].coches = extractCoches(seccion2002);
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

          const extractGruas = (seccion) => {
            if (!seccion) return 0;
            const match = seccion.match(/GRUAS.*?<Th[^>]*>(\d+)/is);
            return match ? parseInt(match[1]) : 0;
          };

          const extractCoches = (seccion) => {
            if (!seccion) return 0;
            const grupoMatch = seccion.match(/GRUPO III.*?(?=<TR|<\/TABLE)/is);
            if (!grupoMatch) return 0;

            const numeros = [];
            const regex = /<TD[^>]*align=center[^>]*nowrap[^>]*>(\d*)/gi;
            let m;
            while ((m = regex.exec(grupoMatch[0])) !== null && numeros.length < 5) {
              numeros.push(parseInt(m[1]) || 0);
            }
            return numeros.length >= 4 ? numeros[3] : 0;
          };

          const html = document.body.innerHTML;
          const idx0814Start = html.indexOf('TDazul');
          const idx1420Start = html.indexOf('TDverde');
          const idx2002Start = html.indexOf('TDrojo');

          if (idx0814Start !== -1 && idx1420Start !== -1) {
            const seccion0814 = html.substring(idx0814Start, idx1420Start);
            result['08-14'].gruas = extractGruas(seccion0814);
            result['08-14'].coches = extractCoches(seccion0814);
          }

          if (idx1420Start !== -1 && idx2002Start !== -1) {
            const seccion1420 = html.substring(idx1420Start, idx2002Start);
            result['14-20'].gruas = extractGruas(seccion1420);
            result['14-20'].coches = extractCoches(seccion1420);
          }

          if (idx2002Start !== -1) {
            const idxEnd = html.indexOf('</TABLE>', idx2002Start);
            const seccion2002 = html.substring(idx2002Start, idxEnd !== -1 ? idxEnd : html.length);
            result['20-02'].gruas = extractGruas(seccion2002);
            result['20-02'].coches = extractCoches(seccion2002);
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
