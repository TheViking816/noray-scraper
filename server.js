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
            // Buscar GRUAS seguido de un número en una celda TH
            const match = seccion.match(/GRUAS.*?<Th[^>]*>(\d+)/is);
            return match ? parseInt(match[1]) : 0;
          };

          const extractCoches = (seccion) => {
            if (!seccion) return 0;

            // Buscar el patrón: [número]&nbsp;C2
            // Ejemplo: "18&nbsp;C2" o ">3&nbsp;C2"
            const cochesMatch = seccion.match(/>(\d+)&nbsp;C2/i);

            if (cochesMatch) {
              console.log('DEBUG extractCoches: Encontrado patrón C2:', cochesMatch[0], 'Número:', cochesMatch[1]);
              return parseInt(cochesMatch[1]);
            }

            console.log('DEBUG extractCoches: No se encontró patrón [número]&nbsp;C2');
            return 0;
          };

          // Usar document.body.innerHTML
          const html = document.body.innerHTML;

          // NUEVA ESTRATEGIA: Buscar cada turno en su propia fila
          // Según tu ejemplo: <TD class=TDazul>&nbsp08/14 H<TD>NÚMERO&nbsp;C2

          // Buscar fila completa de 08-14 (TDazul)
          const row0814Match = html.match(/<TR[^>]*>.*?TDazul.*?08\/14.*?<\/TR>/is);
          console.log('DEBUG: row0814Match encontrado?', !!row0814Match);
          if (row0814Match) {
            const row0814 = row0814Match[0];
            console.log('DEBUG 08-14 row content:', row0814.substring(0, 200));
            result['08-14'].gruas = extractGruas(row0814);
            result['08-14'].coches = extractCoches(row0814);
            console.log('DEBUG 08-14 row:', { gruas: result['08-14'].gruas, coches: result['08-14'].coches });
          }

          // Buscar fila completa de 14-20 (TDverde)
          const row1420Match = html.match(/<TR[^>]*>.*?TDverde.*?14\/20.*?<\/TR>/is);
          console.log('DEBUG: row1420Match encontrado?', !!row1420Match);
          if (row1420Match) {
            const row1420 = row1420Match[0];
            console.log('DEBUG 14-20 row content:', row1420.substring(0, 200));
            result['14-20'].gruas = extractGruas(row1420);
            result['14-20'].coches = extractCoches(row1420);
            console.log('DEBUG 14-20 row:', { gruas: result['14-20'].gruas, coches: result['14-20'].coches });
          }

          // Buscar fila completa de 20-02 (TDrojo)
          const row2002Match = html.match(/<TR[^>]*>.*?TDrojo.*?20\/02.*?<\/TR>/is);
          console.log('DEBUG: row2002Match encontrado?', !!row2002Match);
          if (row2002Match) {
            const row2002 = row2002Match[0];
            console.log('DEBUG 20-02 row content:', row2002.substring(0, 200));
            result['20-02'].gruas = extractGruas(row2002);
            result['20-02'].coches = extractCoches(row2002);
            console.log('DEBUG 20-02 row:', { gruas: result['20-02'].gruas, coches: result['20-02'].coches });
          }

          // FALLBACK: Si las filas no funcionaron, buscar por secciones
          // Pero primero verificar que realmente necesitamos el fallback
          const needsFallback = result['08-14'].gruas === 0 && result['14-20'].gruas === 0 && result['20-02'].gruas === 0;

          if (needsFallback) {
            console.log('DEBUG: Usando fallback de secciones');
            const idx0814Start = html.indexOf('class="TDazul"') > -1 ? html.indexOf('class="TDazul"') : html.indexOf('TDazul');
            const idx1420Start = html.indexOf('class="TDverde"') > -1 ? html.indexOf('class="TDverde"') : html.indexOf('TDverde');
            const idx2002Start = html.indexOf('class="TDrojo"') > -1 ? html.indexOf('class="TDrojo"') : html.indexOf('TDrojo');

            console.log('DEBUG indices:', { idx0814Start, idx1420Start, idx2002Start });

            if (idx0814Start !== -1) {
              const endIdx = idx1420Start !== -1 ? idx1420Start : (idx2002Start !== -1 ? idx2002Start : html.length);
              const seccion0814 = html.substring(idx0814Start, endIdx);
              result['08-14'].gruas = extractGruas(seccion0814);
            }

            if (idx1420Start !== -1) {
              const endIdx = idx2002Start !== -1 ? idx2002Start : html.length;
              const seccion1420 = html.substring(idx1420Start, endIdx);
              result['14-20'].gruas = extractGruas(seccion1420);
            }

            if (idx2002Start !== -1) {
              const endTableIdx = html.indexOf('</TABLE>', idx2002Start);
              const endIdx = endTableIdx !== -1 ? endTableIdx : html.length;
              const seccion2002 = html.substring(idx2002Start, endIdx);
              result['20-02'].gruas = extractGruas(seccion2002);
            }
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

        // Buscar "No contratado (número)" con diferentes variaciones
        // Patrón exacto del HTML: No contratado (103)
        const patterns = [
          /No\s+contratado\s+\((\d+)\)/i,
          /No contratado\s*\((\d+)\)/i,
          />No\s+contratado\s+\((\d+)\)</i
        ];

        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match) {
            console.log('DEBUG Chapero: Encontrado con patrón', pattern, '- Valor:', match[1]);
            return parseInt(match[1]);
          }
        }

        // Fallback: Contar imágenes chapab.jpg
        const bgMatches = html.match(/background='imagenes\/chapab\.jpg'/gi);
        if (bgMatches) {
          console.log('DEBUG Chapero: Fallback - Contando chapab.jpg:', bgMatches.length);
          return bgMatches.length;
        }

        console.log('DEBUG Chapero: No se encontraron fijos. HTML snippet:', html.substring(0, 500));
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
