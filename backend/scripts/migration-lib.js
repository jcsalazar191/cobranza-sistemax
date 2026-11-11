import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationName = /^(\d{3}_[a-z0-9][a-z0-9_-]*)\.sql$/i;

export function readMigrations(directory) {
  const migrations = readdirSync(directory)
    .map((file) => {
      const match = migrationName.exec(file);
      if (!match) return null;
      const sql = readFileSync(join(directory, file), 'utf8');
      const compatibility = /^\s*--\s*deploy:\s*(backward-compatible|requires-manual-rollback)\s*$/im.exec(sql);
      if (!compatibility) throw new Error(`${file}: falta la cabecera "-- deploy: backward-compatible".`);
      return {
        id: match[1],
        file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
        backwardCompatible: compatibility[1] === 'backward-compatible',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));

  const ids = new Set();
  for (const migration of migrations) {
    if (ids.has(migration.id)) throw new Error(`ID de migracion duplicado: ${migration.id}`);
    ids.add(migration.id);
  }
  return migrations;
}

export function splitMigrations(migrations, appliedRows) {
  const applied = new Map(appliedRows.map((row) => [row.id, row]));
  for (const migration of migrations) {
    const existing = applied.get(migration.id);
    if (existing && existing.checksum !== migration.checksum) {
      throw new Error(`${migration.file}: su checksum no coincide con el que ya fue aplicado; no modifique migraciones historicas.`);
    }
  }
  for (const row of appliedRows) {
    if (!migrations.some((migration) => migration.id === row.id)) {
      throw new Error(`La migracion aplicada ${row.id} ya no existe en el release.`);
    }
  }
  return migrations.filter((migration) => !applied.has(migration.id));
}
