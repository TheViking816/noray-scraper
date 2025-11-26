import express from 'express';
import puppeteer from 'puppeteer-core'; // Usamos Core (más ligero)
import chromium from 'chromium'; // Usamos el binario de Chromium gestionado
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Habilitar CORS para tu PWA
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST']
}));

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Noray Scraper API v1.0 (Optimized for Render)',
    endpoints: {
      prevision: '/api/prevision',
      chapero: '/api/chapero',
      all: '/api/all'
    }
  });
});

// Configuración de Puppeteer OPTIMIZADA para Render Free Tier (512MB RAM)
// + Evasión de detección de Cloudflare
const getBrowserConfig = () => ({
  executablePath: chromium.path, // Usamos la ruta del paquete 'chromium'
  headless: true, // 'new' está deprecado en versiones recientes
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', // Vital para Docker/Render
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process', // Ayuda en entornos con muy poca RAM
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled', // Ocultar que es bot
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]
});

// Endpoint: Obtener previsión de demanda
app.get('/api/prevision', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping de Previsión...');
    browser = await puppeteer.launch(getBrowserConfig());
    const page = await browser.newPage();

    // Configurar headers anti-detección
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es'] });
    });

    // Bloquear recursos innecesarios para ahorrar RAM y ancho de banda
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.goto('https://noray.cpevalencia.com/PrevisionDemanda.asp', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Esperar bypass de Cloudflare
    console.log('⏳ Esperando bypass de Cloudflare...');
    try {
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 30000 }
      );
      console.log('✅ Cloudflare bypass completado');
    } catch (e) {
      console.log('⚠️ Timeout esperando Cloudflare, continuando...');
    }
    await page.waitForTimeout(3000);

    const demandas = await page.evaluate(() => {
      const result = {
        '08-14': { gruas: 0, coches: 0 },
        '14-20': { gruas: 0, coches: 0 },
        '20-02': { gruas: 0, coches: 0 }
      };

      const html = document.body.innerHTML;

      // Extraer TODAS las grúas usando el MISMO regex que funciona fuera
      const gruasMatches = [...html.matchAll(/GRUAS.*?<Th[^>]*>(\d+)/gis)];

      // Asignar grúas directamente por orden
      if (gruasMatches.length >= 3) {
        result['08-14'].gruas = parseInt(gruasMatches[0][1]);
        result['14-20'].gruas = parseInt(gruasMatches[1][1]);
        result['20-02'].gruas = parseInt(gruasMatches[2][1]);
      }

      // Extraer TODOS los coches (patrón C2)
      const cochesMatches = [];
      const cochesRegex = /(?:(\d+)|>)&nbsp;C2/gi;
      let match;
      while ((match = cochesRegex.exec(html)) !== null) {
        cochesMatches.push({
          valor: match[1] ? parseInt(match[1]) : 0,
          posicion: match.index
        });
      }

      // Buscar las posiciones de los marcadores de turno
      const tdazulIdx = html.search(/class[^>]*TDazul/i);
      const tdverdeIdx = html.search(/class[^>]*TDverde/i);
      const tdrojoIdx = html.search(/class[^>]*TDrojo/i);

      // Asignar coches según el orden de aparición
      if (cochesMatches.length > 0) {
        cochesMatches.sort((a, b) => a.posicion - b.posicion);

        for (const coche of cochesMatches) {
          if (tdazulIdx !== -1 && coche.posicion > tdazulIdx &&
              (tdverdeIdx === -1 || coche.posicion < tdverdeIdx)) {
            if (result['08-14'].coches === 0) {
              result['08-14'].coches = coche.valor;
            }
          } else if (tdverdeIdx !== -1 && coche.posicion > tdverdeIdx &&
                     (tdrojoIdx === -1 || coche.posicion < tdrojoIdx)) {
            if (result['14-20'].coches === 0) {
              result['14-20'].coches = coche.valor;
            }
          } else if (tdrojoIdx !== -1 && coche.posicion > tdrojoIdx) {
            if (result['20-02'].coches === 0) {
              result['20-02'].coches = coche.valor;
            }
          }
        }
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

    // Configurar headers anti-detección
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es'] });
    });

    // Bloquear imágenes para ir más rápido
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (req.resourceType() === 'image') req.abort();
        else req.continue();
    });

    await page.goto('https://noray.cpevalencia.com/Chapero.asp', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Esperar bypass de Cloudflare
    console.log('⏳ Esperando bypass de Cloudflare (Chapero)...');
    try {
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 30000 }
      );
      console.log('✅ Cloudflare bypass completado (Chapero)');
    } catch (e) {
      console.log('⚠️ Timeout esperando Cloudflare, continuando...');
    }
    await page.waitForTimeout(2000);

    const fijos = await page.evaluate(() => {
      const html = document.body.innerHTML;

      // Usar matchAll para buscar "No contratado (número)"
      const matches = [...html.matchAll(/No\s+contratado\s+\((\d+)\)/gi)];

      if (matches.length > 0) {
        return parseInt(matches[0][1]);
      }

      // Método 2: Contar elementos con background='imagenes/chapab.jpg'
      const bgMatches = [...html.matchAll(/background='imagenes\/chapab\.jpg'/gi)];
      return bgMatches.length > 0 ? bgMatches.length : 0;
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
// MODIFICADO: Ejecución secuencial para no reventar la RAM de Render (512MB)
app.get('/api/all', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping completo (Secuencial)...');
    browser = await puppeteer.launch(getBrowserConfig());
    const page = await browser.newPage();

    // Configurar headers para parecer navegador real
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none'
    });

    // Ocultar que es automatización
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es'] });
    });

    // Optimización de recursos
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    // 1. OBTENER PREVISIÓN
    await page.goto('https://noray.cpevalencia.com/PrevisionDemanda.asp', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Esperar a que Cloudflare complete su verificación
    console.log('⏳ Esperando bypass de Cloudflare...');
    try {
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 30000 }
      );
      console.log('✅ Cloudflare bypass completado');
    } catch (e) {
      console.log('⚠️ Timeout esperando Cloudflare, continuando de todas formas...');
    }

    // Esperar un poco más para asegurar que el contenido cargó
    await page.waitForTimeout(3000);

    // Obtener el HTML completo para debug
    const htmlContent = await page.content();
    console.log('📄 HTML recibido (primeros 500 chars):', htmlContent.substring(0, 500));
    console.log('🔍 Buscando marcadores: TDazul=', htmlContent.includes('TDazul'),
                'TDverde=', htmlContent.includes('TDverde'),
                'TDrojo=', htmlContent.includes('TDrojo'),
                'GRUAS=', htmlContent.includes('GRUAS'));

    // Debug: extraer posiciones de los marcadores
    const idx0814 = htmlContent.indexOf('TDazul');
    const idx1420 = htmlContent.indexOf('TDverde');
    const idx2002 = htmlContent.indexOf('TDrojo');
    console.log('📍 Posiciones:', { TDazul: idx0814, TDverde: idx1420, TDrojo: idx2002 });

    // Debug: extraer contenido alrededor de GRUAS
    const gruasMatches = [...htmlContent.matchAll(/GRUAS.*?<Th[^>]*>(\d+)/gis)];
    console.log('🔢 GRUAS encontradas:', gruasMatches.map((m, i) => ({ index: i, valor: m[1], posicion: m.index })));

    const demandasResult = await page.evaluate(() => {
        const result = {
            '08-14': { gruas: 0, coches: 0 },
            '14-20': { gruas: 0, coches: 0 },
            '20-02': { gruas: 0, coches: 0 }
          };

          // Usar document.body.innerHTML
          const html = document.body.innerHTML;

          // Extraer TODAS las grúas usando el MISMO regex que funciona fuera
          const gruasMatches = [...html.matchAll(/GRUAS.*?<Th[^>]*>(\d+)/gis)];

          console.log('DEBUG: Grúas encontradas:', gruasMatches.length);

          // Asignar grúas directamente por orden
          if (gruasMatches.length >= 3) {
            result['08-14'].gruas = parseInt(gruasMatches[0][1]);
            result['14-20'].gruas = parseInt(gruasMatches[1][1]);
            result['20-02'].gruas = parseInt(gruasMatches[2][1]);
          }

          // Extraer TODOS los coches (patrón C2)
          const cochesMatches = [];
          const cochesRegex = /(?:(\d+)|>)&nbsp;C2/gi;
          let match;
          while ((match = cochesRegex.exec(html)) !== null) {
            cochesMatches.push({
              valor: match[1] ? parseInt(match[1]) : 0,
              posicion: match.index
            });
          }

          console.log('DEBUG: Coches encontrados:', cochesMatches.length);

          // Buscar las posiciones de los marcadores de turno
          const tdazulIdx = html.search(/class[^>]*TDazul/i);
          const tdverdeIdx = html.search(/class[^>]*TDverde/i);
          const tdrojoIdx = html.search(/class[^>]*TDrojo/i);

          // Asignar coches según el orden de aparición
          if (cochesMatches.length > 0) {
            cochesMatches.sort((a, b) => a.posicion - b.posicion);

            // Encontrar qué coches están después de cada turno
            for (const coche of cochesMatches) {
              if (tdazulIdx !== -1 && coche.posicion > tdazulIdx &&
                  (tdverdeIdx === -1 || coche.posicion < tdverdeIdx)) {
                if (result['08-14'].coches === 0) {
                  result['08-14'].coches = coche.valor;
                }
              } else if (tdverdeIdx !== -1 && coche.posicion > tdverdeIdx &&
                         (tdrojoIdx === -1 || coche.posicion < tdrojoIdx)) {
                if (result['14-20'].coches === 0) {
                  result['14-20'].coches = coche.valor;
                }
              } else if (tdrojoIdx !== -1 && coche.posicion > tdrojoIdx) {
                if (result['20-02'].coches === 0) {
                  result['20-02'].coches = coche.valor;
                }
              }
            }
          }

          console.log('DEBUG: Resultado final:', result);
          return result;
    });

    // 2. OBTENER CHAPERO (Reusando la misma página para ahorrar memoria)
    await page.goto('https://noray.cpevalencia.com/Chapero.asp', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Esperar bypass de Cloudflare también en Chapero
    console.log('⏳ Esperando bypass de Cloudflare (Chapero)...');
    try {
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 30000 }
      );
      console.log('✅ Cloudflare bypass completado (Chapero)');
    } catch (e) {
      console.log('⚠️ Timeout esperando Cloudflare en Chapero, continuando...');
    }

    await page.waitForTimeout(2000);

    const fijosResult = await page.evaluate(() => {
        const html = document.body.innerHTML;

        // Debug: buscar si existe el texto "No contratado"
        const containsNoContratado = html.includes('No contratado');
        console.log('DEBUG: ¿Contiene "No contratado"?', containsNoContratado);

        // Buscar el fragmento de HTML alrededor de "No contratado"
        const idx = html.indexOf('No contratado');
        if (idx !== -1) {
          const fragment = html.substring(idx, idx + 100);
          console.log('DEBUG: Fragmento encontrado:', fragment);
        }

        // Usar matchAll con regex más flexible
        const matches = [...html.matchAll(/No\s+contratado\s+\((\d+)\)/gi)];
        console.log('DEBUG: Matches encontrados:', matches.length);

        if (matches.length > 0) {
          const fijos = parseInt(matches[0][1]);
          console.log('DEBUG Chapero: Encontrado "No contratado":', fijos);
          return fijos;
        }

        // Método 2: Contar elementos con background='imagenes/chapab.jpg'
        const bgMatches = [...html.matchAll(/background='imagenes\/chapab\.jpg'/gi)];
        console.log('DEBUG: chapab.jpg encontrados:', bgMatches.length);

        if (bgMatches.length > 0) {
          console.log('DEBUG Chapero: Usando método 2 - chapab.jpg:', bgMatches.length);
          return bgMatches.length;
        }

        console.log('DEBUG Chapero: No se encontraron fijos no contratados');
        return 0;
    });

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
});
