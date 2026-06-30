// Convierte un Blob de audio (p.ej. webm/opus que graba Android Chrome) a WAV
// mono 16 kHz en base64. Gemini acepta WAV pero NO webm, asi que convertimos en
// el navegador (Web Audio API) antes de enviar. La burbuja del chat reproduce el
// webm original; esto es solo para la transcripcion.

const TARGET_RATE = 16000;

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const wr = (off, s) => { for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i)); };

  wr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  wr(8, 'WAVE');
  wr(12, 'fmt ');
  view.setUint32(16, 16, true);      // PCM chunk size
  view.setUint16(20, 1, true);       // formato PCM
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);       // block align
  view.setUint16(34, 16, true);      // bits por muestra
  wr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let off = 44;
  for (let i = 0; i < samples.length; i += 1, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Devuelve { mime: 'audio/wav', data: base64 } listo para Gemini.
export async function blobToWavBase64(blob) {
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    ctx.close?.();
  }

  // Re-muestrea a 16 kHz mono con un OfflineAudioContext.
  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const off = new OfflineAudioContext(1, length, TARGET_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const wav = encodeWav(rendered.getChannelData(0), TARGET_RATE);
  return { mime: 'audio/wav', data: arrayBufferToBase64(wav) };
}
