import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMigrations, splitMigrations } from '../scripts/migration-lib.js';

function migrationDir(files) {
  const directory = mkdtempSync(join(tmpdir(), 'cobranza-migrations-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(directory, name), body);
  return directory;
}

test('lee migraciones ordenadas y detecta compatibilidad de rollback', () => {
  const migrations = readMigrations(migrationDir({
    '002_indice.sql': '-- deploy: backward-compatible\nCREATE INDEX x ON clientes(id);\n',
    '001_tabla.sql': '-- deploy: requires-manual-rollback\nCREATE TABLE x(id int);\n',
  }));
  assert.deepEqual(migrations.map((item) => item.id), ['001_tabla', '002_indice']);
  assert.equal(migrations[0].backwardCompatible, false);
});

test('impide cambiar o borrar una migracion ya aplicada', () => {
  const migrations = readMigrations(migrationDir({
    '001_tabla.sql': '-- deploy: backward-compatible\nCREATE TABLE x(id int);\n',
  }));
  assert.throws(() => splitMigrations(migrations, [{ id: '001_tabla', checksum: 'alterado' }]));
  assert.throws(() => splitMigrations([], [{ id: '001_tabla', checksum: 'alterado' }]));
});
