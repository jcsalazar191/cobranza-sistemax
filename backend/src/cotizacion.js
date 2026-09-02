// Genera una cotizacion de SysFarma en PDF con los datos del lead, para
// mandarla por WhatsApp de una sola vez (hoy Jean lo hace armando un PDF a
// mano cada vez; esto reusa lo mismo que ya escribe siempre).
import PDFDocument from 'pdfkit';

const VERDE = '#0f9d58';
const GRIS = '#555555';

function num(v) { return typeof v === 'string' ? v.replace(/[^\d]/g, '') || null : v; }

// sucursales: 1 (incluida) por defecto; cada adicional S/ 20.
function calcularPrecio(sucursales = 1) {
  const s = Math.max(1, Number(sucursales) || 1);
  return 69 + (s - 1) * 20;
}

// Arma el PDF y devuelve el base64. `datos` viene de la ficha del lead
// (memoria.datos): nombre, negocio, ciudad, plan.
export async function generarCotizacion({ nombre, negocio, ciudad, sucursales = 1 } = {}) {
  const precio = calcularPrecio(sucursales);
  const fecha = new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Lima' });

  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    doc.fillColor(VERDE).fontSize(24).font('Helvetica-Bold').text('SysFarma', { continued: false });
    doc.fillColor(GRIS).fontSize(10).font('Helvetica').text('Caja, inventario, SUNAT y DIGEMID en una sola pantalla.');
    doc.moveDown(1.2);
    doc.fillColor('#000').fontSize(16).font('Helvetica-Bold').text('Cotizacion');
    doc.fillColor(GRIS).fontSize(10).font('Helvetica').text(fecha);
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('Cliente');
    doc.font('Helvetica').fontSize(10);
    if (nombre) doc.text(`Nombre: ${nombre}`);
    if (negocio) doc.text(`Negocio: ${negocio}`);
    if (ciudad) doc.text(`Ciudad: ${ciudad}`);
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('Plan Total');
    doc.font('Helvetica').fontSize(10).fillColor(GRIS);
    doc.text('Suscripcion mensual, IGV incluido, sin permanencia.');
    doc.moveDown(0.5);

    const filas = [
      ['Sucursales incluidas', `${sucursales} ${sucursales === 1 ? 'sucursal' : 'sucursales'}`],
      ['Facturacion electronica SUNAT', 'Ilimitada'],
      ['Inventario FEFO (lotes/vencimientos)', 'Incluido'],
      ['Catalogo DIGEMID + trazabilidad', 'Incluido'],
      ['Dashboard y reportes en tiempo real', 'Incluido'],
      ['APK movil', 'Incluido'],
      ['Soporte por WhatsApp', '24/7'],
    ];
    for (const [k, v] of filas) {
      doc.fillColor('#000').font('Helvetica').text(k, { continued: true, width: 320 });
      doc.fillColor(GRIS).text(`  ${v}`);
    }
    doc.moveDown(1);

    doc.rect(50, doc.y, 495, 50).fillAndStroke('#f0f9f4', VERDE);
    doc.fillColor(VERDE).fontSize(18).font('Helvetica-Bold')
      .text(`S/ ${precio} / mes`, 60, doc.y - 38);
    doc.fillColor(GRIS).fontSize(9).font('Helvetica')
      .text('Sucursal adicional: S/ 20/mes. Sin costos ocultos.', 60, doc.y + 2);
    doc.moveDown(2.5);

    doc.fillColor('#000').fontSize(10).font('Helvetica-Bold').text('Implementacion');
    doc.font('Helvetica').fillColor(GRIS)
      .text('Funcionando en 2-5 dias habiles. Importamos su catalogo/inventario (incluso desde Excel) y damos capacitacion por videollamada.');
    doc.moveDown(1);

    doc.font('Helvetica').fillColor(GRIS)
      .text('Demo en vivo: https://demo.sysfarma.pe/', { link: 'https://demo.sysfarma.pe/' });
    doc.text('Contacto: +51 916 050 559  |  ventas@sysfarma.pe');

    doc.end();
  });
}

export { calcularPrecio };
