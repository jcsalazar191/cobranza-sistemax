// Cache en memoria del ultimo QR de WhatsApp. Evolution v2 entrega el QR por el
// evento webhook QRCODE_UPDATED (no por /instance/connect), asi que el webhook lo
// guarda aca y /leads/qr lo sirve. Valido 2 min (el QR rota).
let _qr = null;
let _ts = 0;

export function setQr(base64) {
  _qr = base64;
  _ts = Date.now();
}

export function getQr() {
  if (_qr && Date.now() - _ts < 120000) return _qr;
  return null;
}
