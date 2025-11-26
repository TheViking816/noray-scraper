# 🚀 Noray Scraper API

Servidor Node.js con Puppeteer para hacer scraping de Noray y bypass de Cloudflare.

## 📦 Despliegue en Render.com (GRATIS)

### Paso 1: Crear cuenta en Render
1. Ve a https://render.com
2. Regístrate con GitHub (recomendado) o email
3. Verifica tu email

### Paso 2: Subir el código a GitHub

```bash
cd noray-scraper

# Inicializar git (si no lo hiciste)
git init
git add .
git commit -m "Initial commit - Noray Scraper"

# Crear repositorio en GitHub y subir
gh repo create noray-scraper --public --source=. --remote=origin --push
# O manualmente: crea un repo en github.com y luego:
git remote add origin https://github.com/TU_USUARIO/noray-scraper.git
git branch -M main
git push -u origin main
```

### Paso 3: Desplegar en Render

1. **En Render Dashboard**, haz clic en "New +" → "Web Service"

2. **Conecta tu repositorio GitHub**:
   - Autoriza Render a acceder a GitHub
   - Selecciona el repositorio `noray-scraper`

3. **Configuración del servicio**:
   ```
   Name: noray-scraper
   Region: Frankfurt (Europe) o el más cercano
   Branch: main
   Root Directory: (dejar vacío)
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free
   ```

4. **Variables de entorno** (opcional):
   - No necesitas añadir ninguna por ahora

5. **Haz clic en "Create Web Service"**

6. **Espera 5-10 minutos** mientras Render:
   - Instala dependencias
   - Descarga Chromium para Puppeteer (~300MB)
   - Inicia el servidor

7. **Copia la URL** que te da Render (ejemplo: `https://noray-scraper.onrender.com`)

### Paso 4: Probar el servidor

Abre en tu navegador o usa curl:

```bash
# Health check
https://noray-scraper.onrender.com/

# Obtener previsión
https://noray-scraper.onrender.com/api/prevision

# Obtener chapero
https://noray-scraper.onrender.com/api/chapero

# Obtener todo
https://noray-scraper.onrender.com/api/all
```

### Paso 5: Actualizar app.js en tu PWA

Reemplaza la URL del Apps Script en `app.js` línea 5924:

```javascript
// ANTES (Apps Script bloqueado por Cloudflare):
var url = 'https://script.google.com/macros/s/AKfycbyv6swXpt80WOfTyRhm0n4IBGqcxqeBZCxR1x8bwrhGBRz34I7zZjBzlaJ8lXgHcbDS/exec?action=all';

// DESPUÉS (Tu servidor en Render):
var url = 'https://noray-scraper.onrender.com/api/all';
```

---

## ⚠️ Limitaciones del plan gratuito de Render

- **750 horas/mes** de ejecución (suficiente para tu caso)
- **El servidor duerme después de 15 minutos** de inactividad
  - Primera petición después de dormir tarda ~30 segundos (despierta el servidor)
  - Peticiones siguientes son rápidas (~3-5 segundos)
- **Solución**: Añadir un cron job que haga ping cada 10 minutos (opcional)

---

## 🔧 Desarrollo local

```bash
# Instalar dependencias
npm install

# Ejecutar servidor
npm start

# Probar en navegador
http://localhost:3000/api/all
```

---

## 📊 Respuesta de ejemplo

```json
{
  "success": true,
  "timestamp": "2025-11-25T21:30:00.000Z",
  "demandas": {
    "08-14": { "gruas": 13, "coches": 0 },
    "14-20": { "gruas": 17, "coches": 18 },
    "20-02": { "gruas": 18, "coches": 3 }
  },
  "fijos": 103
}
```

---

## 🐛 Troubleshooting

**Problema**: Render no termina de desplegar (stuck en "Build")
- **Solución**: Puppeteer necesita tiempo para descargar Chromium. Espera 10 minutos.

**Problema**: Error "Timeout waiting for page"
- **Solución**: Aumenta timeout en server.js o verifica que Noray esté accesible.

**Problema**: CORS error en tu PWA
- **Solución**: Ya está configurado `cors: '*'` en server.js. Si persiste, añade tu dominio específico.

---

## 🚀 Mejoras futuras (opcional)

1. **Caching**: Añadir Redis/cache en memoria para no hacer scraping en cada petición
2. **Keep-alive**: Crear un cron job en cron-job.org que haga ping cada 10 min
3. **Monitoring**: Añadir logs y alertas con Sentry o LogRocket

---

**¡Listo! Ahora tienes scraping automático de Noray sin Cloudflare bloqueándote** 🎉
