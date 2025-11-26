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
    message: 'Noray Scraper API v1.0 (Fixed Parsing)',
    endpoints: {
      prevision: '/api/prevision',
      chapero: '/api/chapero',
      all: '/api/all'
    }
  });
});

// Configuración de Puppeteer OPTIMIZADA para Render Free Tier (512MB RAM)
const getBrowserConfig = () => ({
  executablePath: chromium.path,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled'
  ]
});

// Endpoint: Obtener previsión de demanda
app.get('/api/prevision', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping de Previsión...');
    browser = await puppeteer.launch(getBrowserConfig());
    const page = await browser.newPage();

    // Bloquear recursos para velocidad
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

    const demandas = await page.evaluate(() => {
      const html = document.body.innerHTML;
      const result = {
        '08-14': { gruas: 0, coches: 0 },
        '14-20': { gruas: 0, coches: 0 },
        '20-02': { gruas: 0, coches: 0 }
      };

      // 1. PARSEO DE GRÚAS (Tabla Principal - colspan=8)
      // Cortamos el HTML en trozos basados en los encabezados de la tabla grande
      const mainTableRegex = /class=(TDazul|TDverde|TDrojo)[^>]*colspan=8/gi;
      const splitHtml = html.split(mainTableRegex);
      
      // La función split con regex devuelve [texto_antes, captura_clase, texto_despues...]
      // Buscamos donde empieza cada turno en el array
      
      const findSectionContent = (color) => {
          const index = splitHtml.indexOf(color);
          if (index !== -1 && index + 1 < splitHtml.length) {
              return splitHtml[index + 1]; // Retorna el contenido HTML después de la etiqueta
          }
          return '';
      };

      const extractGruas = (sectionHtml) => {
        // Busca la fila GRUAS y coge el valor dentro del <Th>
        const match = sectionHtml.match(/GRUAS.*?<Th[^>]*>(\d+)/i);
        return match ? parseInt(match[1]) : 0;
      };

      result['08-14'].gruas = extractGruas(findSectionContent('TDazul'));
      result['14-20'].gruas = extractGruas(findSectionContent('TDverde'));
      result['20-02'].gruas = extractGruas(findSectionContent('TDrojo'));

      // 2. PARSEO DE COCHES (Tabla Resumen Inferior - colspan=2)
      // Buscamos la estructura específica de la tabla pequeña: 
      // class=TD[color] colspan=2 ... luego viene el número ... luego &nbsp;C2
      const extractCoches = (color) => {
        const regex = new RegExp(`class=${color}[^>]*colspan=2.*?<TD[^>]*>(\\d*)&nbsp;C2`, 'i');
        const match = html.match(regex);
        // Si hay número lo devuelve, si es vacío (solo &nbsp;C2) devuelve 0
        return match && match[1] ? parseInt(match[1]) : 0;
      };

      result['08-14'].coches = extractCoches('TDazul');
      result['14-20'].coches = extractCoches('TDverde');
      result['20-02'].coches = extractCoches('TDrojo');

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
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint: Obtener chapero (fijos disponibles)
app.get('/api/chapero', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping de Chapero...');
    browser = await puppeteer.launch(getBrowserConfig());
    const page = await browser.newPage();

    // Bloquear imágenes para ir más rápido, pero NO para el html content
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.goto('https://noray.cpevalencia.com/Chapero.asp', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    const fijos = await page.evaluate(() => {
      const html = document.body.innerHTML;
      
      // ESTRATEGIA: Contar elementos con clase "nocontratado"
      // En el HTML fuente: <span class=nocontratado>XXXX</span>
      const matches = html.match(/class=['"]?nocontratado['"]?/gi);
      
      if (matches && matches.length > 0) {
          return matches.length;
      }
      
      // Fallback: Contar imágenes 'chapab.jpg' si la clase falla
      const bgMatches = html.match(/chapab\.jpg/gi);
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint: Obtener todo (previsión + chapero) - SECUENCIAL
app.get('/api/all', async (req, res) => {
  let browser;
  try {
    console.log('🔍 Iniciando scraping completo (Secuencial)...');
    browser = await puppeteer.launch(getBrowserConfig());
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    // --- 1. PREVISIÓN ---
    await page.goto('https://noray.cpevalencia.com/PrevisionDemanda.asp', { waitUntil: 'domcontentloaded' });
    
    // Esperar un instante por si acaso hay renderizado tardío (aunque el HTML suele ser estático)
    // await page.waitForTimeout(1000); 

    const demandasResult = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const result = {
          '08-14': { gruas: 0, coches: 0 },
          '14-20': { gruas: 0, coches: 0 },
          '20-02': { gruas: 0, coches: 0 }
        };
  
        // Lógica Grúas (Tabla principal colspan=8)
        const mainTableRegex = /class=(TDazul|TDverde|TDrojo)[^>]*colspan=8/gi;
        const splitHtml = html.split(mainTableRegex);
        
        const findSectionContent = (color) => {
            const index = splitHtml.indexOf(color);
            return (index !== -1 && index + 1 < splitHtml.length) ? splitHtml[index + 1] : '';
        };
        const extractGruas = (section) => {
          const match = section.match(/GRUAS.*?<Th[^>]*>(\d+)/i);
          return match ? parseInt(match[1]) : 0;
        };
        result['08-14'].gruas = extractGruas(findSectionContent('TDazul'));
        result['14-20'].gruas = extractGruas(findSectionContent('TDverde'));
        result['20-02'].gruas = extractGruas(findSectionContent('TDrojo'));
  
        // Lógica Coches (Tabla resumen colspan=2)
        const extractCoches = (color) => {
          const regex = new RegExp(`class=${color}[^>]*colspan=2.*?<TD[^>]*>(\\d*)&nbsp;C2`, 'i');
          const match = html.match(regex);
          return match && match[1] ? parseInt(match[1]) : 0;
        };
        result['08-14'].coches = extractCoches('TDazul');
        result['14-20'].coches = extractCoches('TDverde');
        result['20-02'].coches = extractCoches('TDrojo');
  
        return result;
    });

    // --- 2. CHAPERO ---
    await page.goto('https://noray.cpevalencia.com/Chapero.asp', { waitUntil: 'domcontentloaded' });
    
    const fijosResult = await page.evaluate(() => {
        const html = document.body.innerHTML;
        // Cuenta ocurrencias de la clase "nocontratado"
        const matches = html.match(/class=['"]?nocontratado['"]?/gi);
        return matches ? matches.length : 0;
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
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Noray Scraper API ejecutándose en puerto ${PORT}`);
});
