import { Router } from 'express';
import { pool } from '../db.js';
import { aISODia1 } from '../logic.js';

export const importRouter = Router();

const PERIODOS = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];

// POST /api/import  -> RESTAURA todo desde un respaldo JSON (reemplaza la base).
// body: { clientes:[], pagos:[], config:[], recordatorios:[] }
importRouter.post('/', async (req, res, next) => {
  const { clientes, pagos = [], config = [], recordatorios = [] } = req.body || {};
  if (!Array.isArray(clientes)) {
    return res.status(400).json({ error: 'Respaldo invalido: falta el arreglo "clientes".' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE recordatorios, pagos, clientes RESTART IDENTITY CASCADE');
    await client.query('DELETE FROM config');

    for (const c of clientes) {
      await client.query(
        `INSERT INTO clientes (id, nombre, whatsapp, monto, dia_cobro, pagado_hasta, activo, periodo, notas, creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now()))`,
        [c.id, c.nombre, c.whatsapp, c.monto, c.dia_cobro, c.pagado_hasta,
          c.activo ?? true, c.periodo ?? 'MENSUAL', c.notas ?? null, c.creado_en ?? null],
      );
    }
    for (const p of pagos) {
      await client.query(
        `INSERT INTO pagos (id, cliente_id, fecha, meses, monto_total, medio, comprobante, creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now()))`,
        [p.id, p.cliente_id, p.fecha, p.meses, p.monto_total, p.medio, p.comprobante ?? null, p.creado_en ?? null],
      );
    }
    for (const r of recordatorios) {
      await client.query(
        `INSERT INTO recordatorios (id, cliente_id, fecha, tipo, creado_en)
         VALUES ($1,$2,$3,$4, COALESCE($5, now()))`,
        [r.id, r.cliente_id, r.fecha, r.tipo ?? 'whatsapp', r.creado_en ?? null],
      );
    }
    for (const k of config) {
      await client.query(
        `INSERT INTO config (clave, valor) VALUES ($1,$2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [k.clave, k.valor],
      );
    }

    // Re-sincronizar las secuencias tras insertar ids explicitos.
    for (const t of ['clientes', 'pagos', 'recordatorios']) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}), 1))`,
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, clientes: clientes.length, pagos: pagos.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/import/clientes -> carga masiva: actualiza por NOMBRE (o inserta).
// body: { filas: [ { nombre, whatsapp?, monto?, dia_cobro?, pagado_hasta?, periodo?, activo? } ] }
importRouter.post('/clientes', async (req, res, next) => {
  const filas = req.body?.filas;
  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ error: 'Envia "filas" con al menos un cliente.' });
  }
  const client = await pool.connect();
  let actualizados = 0; let insertados = 0; const omitidos = [];
  try {
    await client.query('BEGIN');
    for (const [i, f] of filas.entries()) {
      const nombre = String(f.nombre ?? '').trim();
      if (!nombre) { omitidos.push({ fila: i + 1, motivo: 'sin nombre' }); continue; }

      // Campos opcionales normalizados.
      const campos = {};
      if (f.whatsapp != null && f.whatsapp !== '') {
        const w = String(f.whatsapp).replace(/\D/g, '');
        if (!/^\d{9}$/.test(w)) { omitidos.push({ fila: i + 1, motivo: 'whatsapp no son 9 digitos' }); continue; }
        campos.whatsapp = w;
      }
      if (f.monto != null && f.monto !== '') campos.monto = Number(f.monto);
      if (f.dia_cobro != null && f.dia_cobro !== '') campos.dia_cobro = Number(f.dia_cobro);
      if (f.pagado_hasta != null && f.pagado_hasta !== '') {
        const v = String(f.pagado_hasta).length === 7 ? `${f.pagado_hasta}-01` : String(f.pagado_hasta);
        campos.pagado_hasta = aISODia1(v);
      }
      if (f.periodo != null && f.periodo !== '') {
        const p = String(f.periodo).toUpperCase();
        if (PERIODOS.includes(p)) campos.periodo = p;
      }
      if (f.activo != null && f.activo !== '') {
        campos.activo = f.activo === true || /^(true|si|s|1)$/i.test(String(f.activo));
      }

      const { rows: existe } = await client.query(
        'SELECT id FROM clientes WHERE lower(trim(nombre)) = lower($1) LIMIT 1', [nombre],
      );

      if (existe.length > 0) {
        const sets = Object.keys(campos);
        if (sets.length === 0) { omitidos.push({ fila: i + 1, motivo: 'sin campos a actualizar' }); continue; }
        const setSql = sets.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
        await client.query(
          `UPDATE clientes SET ${setSql} WHERE id = $${sets.length + 1}`,
          [...sets.map((k) => campos[k]), existe[0].id],
        );
        actualizados += 1;
      } else {
        // Insert nuevo: requiere whatsapp, monto y pagado_hasta.
        if (!campos.whatsapp || campos.monto == null || !campos.pagado_hasta) {
          omitidos.push({ fila: i + 1, motivo: 'cliente nuevo necesita whatsapp, monto y pagado_hasta' });
          continue;
        }
        await client.query(
          `INSERT INTO clientes (nombre, whatsapp, monto, dia_cobro, pagado_hasta, activo, periodo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [nombre, campos.whatsapp, campos.monto, campos.dia_cobro ?? 1, campos.pagado_hasta,
            campos.activo ?? true, campos.periodo ?? 'MENSUAL'],
        );
        insertados += 1;
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, actualizados, insertados, omitidos });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});
