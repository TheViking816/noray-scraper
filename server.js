import express from 'express';
import puppeteer from 'puppeteer-core'; // Usamos Core (más ligero)
import chromium from 'chromium'; // Usamos el binario de Chromium gestionado
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Cache en memoria para respuestas rápidas
let cachedData = {
  demandas: null,
  fijos: 0,
  timestamp: null,
  isUpdating: false
};

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

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
    message: 'Noray Scraper API v2.0 (With caching)',
    endpoints: {
      prevision: '/api/prevision',
      chapero: '/api/chapero',
      all: '/api/all (cached)',
      refresh: '/api/refresh (force update)'
    },
    cache: {
      hasData: cachedData.demandas !== null,
      lastUpdate: cachedData.timestamp,
      isUpdating: cachedData.isUpdating
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

    // Esperar bypass de Cloudflare con verificación más robusta
    console.log('⏳ Esperando bypass de Cloudflare (Chapero)...');
    try {
      await page.waitForFunction(
        () => {
          const bodyText = document.body.innerText.toLowerCase();
          const html = document.body.innerHTML.toLowerCase();

          // Verificar que NO hay challenges activos
          const hasCloudflareChallenge =
            document.title.includes('Just a moment') ||
            document.title.includes('Un momento') ||
            bodyText.includes('verificar que usted es un ser humano') ||
            bodyText.includes('checking your browser') ||
            bodyText.includes('please wait') ||
            html.includes('challenges.cloudflare.com');

          // Verificar que SÍ hay contenido de la página real
          const hasRealContent =
            html.includes('contratado') ||
            html.includes('chapero') ||
            html.includes('noray');

          // Solo continuar si no hay challenge Y hay contenido real
          return !hasCloudflareChallenge && hasRealContent;
        },
        { timeout: 45000, polling: 500 }
      );
      console.log('✅ Cloudflare bypass completado y contenido verificado (Chapero)');
    } catch (e) {
      console.log('⚠️ Timeout esperando Cloudflare en Chapero, intentando continuar...');
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(2000);

    const fijos = await page.evaluate(() => {
      const html = document.body.innerHTML;

      // Método 1: Buscar "No contratado (121)" con variaciones flexibles
      let matches = [...html.matchAll(/No[\s\u00A0]+contratado[\s\u00A0]*\((\d+)\)/gi)];
      if (matches.length > 0) {
        return parseInt(matches[0][1]);
      }

      // Método 2: Buscar variación con &nbsp; literal
      matches = [...html.matchAll(/No(?:&nbsp;|\s)+contratado(?:&nbsp;|\s)*\((\d+)\)/gi)];
      if (matches.length > 0) {
        return parseInt(matches[0][1]);
      }

      // Método 3: Buscar en contexto de tabla
      matches = [...html.matchAll(/nocontratado[^>]*>[^<]*<\/span>[^>]*>[\s\S]{0,100}?No[^(]*\((\d+)\)/gi)];
      if (matches.length > 0) {
        return parseInt(matches[0][1]);
      }

      // Método 4: Contar elementos con background='imagenes/chapab.jpg'
      const bgMatches = [...html.matchAll(/background\s*=\s*['"']?imagenes\/chapab\.jpg['"']?/gi)];
      if (bgMatches.length > 0) {
        return bgMatches.length;
      }

      // Método 5: Contar "chapab" como último recurso
      const chapabMatches = [...html.matchAll(/chapab/gi)];
      return chapabMatches.length > 0 ? chapabMatches.length : 0;
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

// Función para ejecutar el scraping (usada por /api/refresh y en startup)
async function performScraping() {
  let browser;
  try {
    console.log('🔍 Iniciando scraping completo (Secuencial)...');
    cachedData.isUpdating = true;
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

    // 2. OBTENER CHAPERO
    // ESTRATEGIA: Ya tenemos las cookies de Cloudflare de PrevisionDemanda.asp
    // que está en el mismo dominio, así que deberían funcionar también para Chapero.asp

    console.log('🔄 Navegando a Chapero.asp con cookies existentes de Cloudflare...');

    await page.goto('https://noray.cpevalencia.com/Chapero.asp', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Esperar bypass de Cloudflare con verificación más robusta
    console.log('⏳ Esperando bypass de Cloudflare (Chapero)...');
    try {
      // Esperar a que desaparezcan los indicadores de Cloudflare challenge
      await page.waitForFunction(
        () => {
          const bodyText = document.body.innerText.toLowerCase();
          const html = document.body.innerHTML.toLowerCase();

          // Verificar que NO hay challenges activos
          const hasCloudflareChallenge =
            document.title.includes('Just a moment') ||
            document.title.includes('Un momento') ||
            bodyText.includes('verificar que usted es un ser humano') ||
            bodyText.includes('checking your browser') ||
            bodyText.includes('please wait') ||
            html.includes('challenges.cloudflare.com');

          // Verificar que SÍ hay contenido de la página real
          const hasRealContent =
            html.includes('contratado') ||
            html.includes('chapero') ||
            html.includes('noray');

          // Solo continuar si no hay challenge Y hay contenido real
          return !hasCloudflareChallenge && hasRealContent;
        },
        { timeout: 45000, polling: 500 }
      );
      console.log('✅ Cloudflare bypass completado y contenido verificado (Chapero)');
    } catch (e) {
      console.log('⚠️ Timeout esperando Cloudflare en Chapero, intentando continuar...');
      // Dar tiempo extra por si acaso
      await page.waitForTimeout(5000);
    }

    // Esperar adicional para asegurar renderizado completo
    await page.waitForTimeout(2000);

    // Obtener el HTML completo para analizar (usando body.innerHTML es más confiable)
    const chaperoHTML = await page.evaluate(() => document.body.innerHTML);

    // Debug: buscar cualquier mención de "contratado"
    const contratadoIdx = chaperoHTML.toLowerCase().indexOf('contratado');
    if (contratadoIdx !== -1) {
      const fragment = chaperoHTML.substring(Math.max(0, contratadoIdx - 100), Math.min(chaperoHTML.length, contratadoIdx + 300));
      console.log('📄 Fragmento con "contratado":', fragment);
    } else {
      console.log('⚠️ No se encontró la palabra "contratado" en el HTML');
      console.log('📄 Primeros 1000 chars del HTML:', chaperoHTML.substring(0, 1000));
    }

    // Intentar extraer fijos con múltiples métodos (mejorados)
    let fijosResult = 0;

    // Método 1: Buscar "No contratado (121)" con variaciones flexibles
    // Manejando espacios normales, &nbsp;, y múltiples espacios
    const pattern1Match = chaperoHTML.match(/No[\s\u00A0]+contratado[\s\u00A0]*\((\d+)\)/i);
    if (pattern1Match) {
      fijosResult = parseInt(pattern1Match[1]);
      console.log('✅ Método 1 - No contratado (regex flexible):', fijosResult);
    }

    // Método 2: Buscar variación con &nbsp; literal
    if (fijosResult === 0) {
      const pattern2Match = chaperoHTML.match(/No(?:&nbsp;|\s)+contratado(?:&nbsp;|\s)*\((\d+)\)/i);
      if (pattern2Match) {
        fijosResult = parseInt(pattern2Match[1]);
        console.log('✅ Método 2 - No contratado (con &nbsp;):', fijosResult);
      }
    }

    // Método 3: Buscar en contexto de tabla (más específico)
    if (fijosResult === 0) {
      const pattern3Match = chaperoHTML.match(/nocontratado[^>]*>[^<]*<\/span>[^>]*>[\s\S]{0,100}?No[^(]*\((\d+)\)/i);
      if (pattern3Match) {
        fijosResult = parseInt(pattern3Match[1]);
        console.log('✅ Método 3 - No contratado (contexto tabla):', fijosResult);
      }
    }

    // Método 4: Contar backgrounds chapab.jpg directamente en el HTML
    if (fijosResult === 0) {
      const pattern4Matches = [...chaperoHTML.matchAll(/background\s*=\s*['"']?imagenes\/chapab\.jpg['"']?/gi)];
      if (pattern4Matches.length > 0) {
        fijosResult = pattern4Matches.length;
        console.log('✅ Método 4 - Contar backgrounds chapab.jpg:', fijosResult);
      }
    }

    // Método 5: Contar cualquier "chapab" como último recurso
    if (fijosResult === 0) {
      const pattern5Matches = [...chaperoHTML.matchAll(/chapab/gi)];
      if (pattern5Matches.length > 0) {
        fijosResult = pattern5Matches.length;
        console.log('✅ Método 5 - Contar "chapab":', fijosResult);
      }
    }

    console.log('📊 Fijos extraídos:', fijosResult);

    await browser.close();

    console.log('✅ Scraping completo:', { demandas: demandasResult, fijos: fijosResult });

    // Actualizar caché
    cachedData.demandas = demandasResult;
    cachedData.fijos = fijosResult;
    cachedData.timestamp = new Date().toISOString();
    cachedData.isUpdating = false;

    return {
      success: true,
      timestamp: cachedData.timestamp,
      demandas: demandasResult,
      fijos: fijosResult
    };

  } catch (error) {
    console.error('❌ Error en scraping completo:', error);
    if (browser) await browser.close();
    cachedData.isUpdating = false;
    throw error;
  }
}

// Endpoint: Obtener todo (previsión + chapero) - CON CACHÉ
app.get('/api/all', async (req, res) => {
  try {
    // Si hay datos en caché y no han expirado, devolverlos inmediatamente
    const now = Date.now();
    const cacheAge = cachedData.timestamp ? now - new Date(cachedData.timestamp).getTime() : Infinity;

    if (cachedData.demandas && cacheAge < CACHE_DURATION) {
      console.log(`✅ Devolviendo datos del caché (edad: ${Math.round(cacheAge / 1000)}s)`);
      return res.json({
        success: true,
        timestamp: cachedData.timestamp,
        demandas: cachedData.demandas,
        fijos: cachedData.fijos,
        cached: true,
        cacheAge: Math.round(cacheAge / 1000)
      });
    }

    // Si no hay caché o expiró, pero ya hay un scraping en progreso, esperar un poco
    if (cachedData.isUpdating) {
      console.log('⏳ Scraping en progreso, esperando...');
      // Esperar hasta 3 segundos a que termine
      for (let i = 0; i < 6; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!cachedData.isUpdating && cachedData.demandas) {
          console.log('✅ Scraping completado, devolviendo datos actualizados');
          return res.json({
            success: true,
            timestamp: cachedData.timestamp,
            demandas: cachedData.demandas,
            fijos: cachedData.fijos,
            cached: true,
            fresh: true
          });
        }
      }
    }

    // Si llegamos aquí, necesitamos hacer scraping
    console.log('🔄 Caché expirado o inexistente, ejecutando scraping...');
    const result = await performScraping();
    res.json(result);

  } catch (error) {
    console.error('❌ Error en /api/all:', error);
    // Si hay error pero tenemos caché viejo, devolverlo con advertencia
    if (cachedData.demandas) {
      return res.json({
        success: true,
        timestamp: cachedData.timestamp,
        demandas: cachedData.demandas,
        fijos: cachedData.fijos,
        cached: true,
        stale: true,
        warning: 'Usando datos en caché debido a error en scraping'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint: Forzar actualización del caché
app.get('/api/refresh', async (req, res) => {
  try {
    console.log('🔄 Forzando actualización del caché...');
    const result = await performScraping();
    res.json({
      ...result,
      refreshed: true
    });
  } catch (error) {
    console.error('❌ Error en /api/refresh:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Actualizar datos en startup
console.log('🚀 Iniciando actualización inicial del caché...');
performScraping()
  .then(() => console.log('✅ Caché inicial cargado'))
  .catch(err => console.error('❌ Error cargando caché inicial:', err));

app.listen(PORT, () => {
  console.log(`🚀 Noray Scraper API ejecutándose en puerto ${PORT}`);
  console.log(`📊 Caché configurado para ${CACHE_DURATION / 60000} minutos`);
});
