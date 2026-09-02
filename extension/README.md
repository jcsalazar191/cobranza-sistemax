# SysFarma Copiloto WhatsApp (extensión Chrome)

Panel copiloto sobre WhatsApp Web + tablero de posibles, conectado al backend
de cobranza. TÚ envías los mensajes (la extensión nunca manda sola).

## Instalar

1. Chrome → `chrome://extensions` → activar **Modo de desarrollador**.
2. **Cargar extensión sin empaquetar** → carpeta `extension/`.
3. Abrir https://web.whatsapp.com → botón flotante **✨ Copiloto** (abajo a la derecha).
4. Primer uso: iniciar sesión con el correo/clave de cobranza (misma cuenta de la webapp).

## Uso

- **Panel**: abre cualquier chat → muestra la ficha del lead (etapa, TE ESPERA,
  score, resumen IA). "✨ Sugerir respuesta" manda la conversación EN VIVO al
  backend (`/api/leads/sugerir-directo`) — funciona aunque Evolution esté caído.
  "Insertar en el chat" escribe la sugerencia en el cuadro de WhatsApp; tú la
  revisas y envías. Plantillas = un clic para insertarlas.
- **Tablero**: botón 📋 del panel (o icono de la extensión) → overlay DENTRO de
  WhatsApp Web. Dos modos: **Etiquetas WA** (default; columnas = tus etiquetas
  reales de WhatsApp Business, siempre sincronizadas, con su color) y
  **Etapas IA** (columnas por etapa del backend, como el PosiblesView). Clic en
  una tarjeta = abre ese chat ahí mismo y cierra el tablero.
- **API base**: por defecto `https://cobranza.sysfarma.pe/api`; para desarrollo
  guardar otra con `chrome.storage.sync.set({apiBase:'http://localhost:3100/api'})`
  desde la consola del service worker.

## Cómo funciona

- `wa-js/wppconnect-wa.js` (wppconnect-team/wa-js, MIT): expone los módulos
  internos de WhatsApp Web — chat activo y mensajes sin scrapear CSS.
  Actualizar: bajar el release nuevo a esa misma ruta.
- `inject.js` (MAIN world) lee el chat y lo pasa por `postMessage`.
- `content.js` (ISOLATED) pinta el panel; `background.js` habla con el backend
  usando la cookie de sesión normal.
- Único selector DOM usado: `footer [contenteditable]` para insertar texto
  (si Meta lo cambia, cae a copiar al portapapeles).

## Probar sin WhatsApp

`test-integrado.html` = harness con `chrome.*` stubeado y datos fake. Servir la
carpeta (`npx http-server extension -p 8123` o similar) y abrir
`http://localhost:8123/test-integrado.html`: prueba panel, sugerencia IA,
inserción en composer y tablero, sin extensión ni backend.

## Aviso

Automatizar WhatsApp con herramientas no oficiales va contra los ToS de Meta.
Aquí el riesgo es bajo (solo lectura + el humano envía), pero existe.
