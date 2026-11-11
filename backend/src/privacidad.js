// Oculta credenciales (clave SOL de SUNAT, contrasenas, PIN) antes de mandar texto a un modelo de IA.
// Los mensajes en la BD no se tocan (Jean los necesita para instalar); solo cambia lo que ve la IA.
const OCULTO = '[dato oculto]';
const PALABRA = String.raw`(?:contrase[nñ][ao]|clave|password|pass(?:word)?|pin)`;
const RELLENO = String.raw`(?:\s+(?:de|del|la|mi|sol|sunat|usuario|acceso|nueva)){0,3}`;
// Con separador (":" o "="): se oculta el valor aunque sea una palabra normal.
const CON_SEPARADOR = new RegExp(String.raw`(${PALABRA}${RELLENO})\s*[:=]\s*(\S+)`, 'gi');
// Sin separador: solo si el valor parece una clave (tiene digito y 4+ caracteres), para no tocar prosa.
const SIN_SEPARADOR = new RegExp(String.raw`(${PALABRA}${RELLENO})\s+(?=\S*\d)(\S{4,})`, 'gi');
const USUARIO = /(usuario(?:\s+sol)?)\s*[:=]\s*(\S+)/gi;

export function enmascarar(texto) {
  if (!texto) return texto;
  return String(texto)
    .replace(CON_SEPARADOR, `$1: ${OCULTO}`)
    .replace(SIN_SEPARADOR, `$1 ${OCULTO}`)
    .replace(USUARIO, `$1: ${OCULTO}`);
}
