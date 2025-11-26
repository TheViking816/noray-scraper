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

      const extractGruas = (seccion) => {
        if (!seccion) return 0;
        // Buscar la línea de GRUAS dentro de la sección
        // Patrón: >&nbspGRUAS<TD align=center nowrap>NUMERO<
        const match = seccion.match(/>&nbspGRUAS<TD align=center nowrap>(\d+)</i);
        return match ? parseInt(match[1]) : 0;
      };

      const extractCoches = (seccion) => {
        if (!seccion) return 0;

        // Buscar el patrón específico de coches en las filas de equipos
        // Patrón 1: "3&nbsp;C2" (con número)
        // Patrón 2: "&nbsp;C2" (sin número = 0)

        // Primero buscar si hay número antes de &nbsp;C2
        const cochesConNumero = seccion.match(/(\d+)&nbsp;C2/i);
        if (cochesConNumero) {
          return parseInt(cochesConNumero[1]);
        }

        // Si solo hay &nbsp;C2 sin número delante, son 0 coches
        const cochesSinNumero = seccion.match(/>&nbsp;C2/i);
        if (cochesSinNumero) {
          return 0;
        }

        return 0;
      };

      const html = document.body.innerHTML;

      // Buscar los marcadores de cada turno por su clase CSS
      const idx0814 = html.indexOf('class=TDazul');
      const idx1420 = html.indexOf('class=TDverde');
      const idx2002 = html.indexOf('class=TDrojo');

      // Extraer sección 08-14
      if (idx0814 !== -1 && idx1420 !== -1) {
        const seccion0814 = html.substring(idx0814, idx1420);
        result['08-14'].gruas = extractGruas(seccion0814);
        result['08-14'].coches = extractCoches(seccion0814);
      }

      // Extraer sección 14-20
      if (idx1420 !== -1 && idx2002 !== -1) {
        const seccion1420 = html.substring(idx1420, idx2002);
        result['14-20'].gruas = extractGruas(seccion1420);
        result['14-20'].coches = extractCoches(seccion1420);
      }

      // Extraer sección 20-02
      if (idx2002 !== -1) {
        const equiposPrevistosIdx = html.indexOf('Equipos Previstos', idx2002);
        const endIdx = equiposPrevistosIdx !== -1 ? equiposPrevistosIdx : html.length;
        const seccion2002 = html.substring(idx2002, endIdx);
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
      const match = html.match(/No\s+contratado\s+\((\d+)\)/i);
      if (match) {
        return parseInt(match[1]) || 0;
      }
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

          const extractGruas = (seccion) => {
            if (!seccion) return 0;
            // Buscar la línea de GRUAS dentro de la sección
            // Patrón: >&nbspGRUAS<TD align=center nowrap>NUMERO<
            const match = seccion.match(/>&nbspGRUAS<TD align=center nowrap>(\d+)</i);
            return match ? parseInt(match[1]) : 0;
          };

          const extractCoches = (seccion) => {
            if (!seccion) return 0;

            // Buscar el patrón específico de coches en las filas de equipos
            // Patrón 1: "3&nbsp;C2" (con número)
            // Patrón 2: "&nbsp;C2" (sin número = 0)

            // Primero buscar si hay número antes de &nbsp;C2
            const cochesConNumero = seccion.match(/(\d+)&nbsp;C2/i);
            if (cochesConNumero) {
              console.log('DEBUG extractCoches: Encontrado coches con número:', cochesConNumero[1]);
              return parseInt(cochesConNumero[1]);
            }

            // Si solo hay &nbsp;C2 sin número delante, son 0 coches
            const cochesSinNumero = seccion.match(/>&nbsp;C2/i);
            if (cochesSinNumero) {
              console.log('DEBUG extractCoches: Encontrado &nbsp;C2 sin número = 0 coches');
              return 0;
            }

            console.log('DEBUG extractCoches: No se encontró patrón C2');
            return 0;
          };

          // Usar document.body.innerHTML
          const html = document.body.innerHTML;

          // Buscar los marcadores de cada turno por su clase CSS
          // class=TDazul = 08-14 H, class=TDverde = 14-20 H, class=TDrojo = 20-02 H
          const idx0814 = html.indexOf('class=TDazul');
          const idx1420 = html.indexOf('class=TDverde');
          const idx2002 = html.indexOf('class=TDrojo');

          console.log('DEBUG indices:', { idx0814, idx1420, idx2002 });

          // Extraer sección 08-14
          if (idx0814 !== -1 && idx1420 !== -1) {
            const seccion0814 = html.substring(idx0814, idx1420);
            result['08-14'].gruas = extractGruas(seccion0814);
            result['08-14'].coches = extractCoches(seccion0814);
            console.log('DEBUG 08-14:', result['08-14']);
          }

          // Extraer sección 14-20
          if (idx1420 !== -1 && idx2002 !== -1) {
            const seccion1420 = html.substring(idx1420, idx2002);
            result['14-20'].gruas = extractGruas(seccion1420);
            result['14-20'].coches = extractCoches(seccion1420);
            console.log('DEBUG 14-20:', result['14-20']);
          }

          // Extraer sección 20-02
          if (idx2002 !== -1) {
            // Buscar el final de la tabla de equipos para esta sección
            const equiposPrevistosIdx = html.indexOf('Equipos Previstos', idx2002);
            const endIdx = equiposPrevistosIdx !== -1 ? equiposPrevistosIdx : html.length;
            const seccion2002 = html.substring(idx2002, endIdx);
            result['20-02'].gruas = extractGruas(seccion2002);
            result['20-02'].coches = extractCoches(seccion2002);
            console.log('DEBUG 20-02:', result['20-02']);
          }

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

        // Método 1: Buscar "No contratado (número)" - Este es el más confiable
        // El patrón en el HTML es: "No contratado (87)&nbsp"
        const match = html.match(/No\s*contratado\s*\((\d+)\)/i);
        if (match) {
          console.log('DEBUG Chapero: Método 1 - No contratado:', match[1]);
          return parseInt(match[1]) || 0;
        }

        // Método 2: Contar elementos con background='imagenes/chapab.jpg'
        // Esto cuenta los elementos con clase nocontratado
        const bgMatches = html.match(/background='imagenes\/chapab\.jpg'/gi);
        if (bgMatches) {
          console.log('DEBUG Chapero: Método 2 - Contando chapab.jpg:', bgMatches.length);
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
