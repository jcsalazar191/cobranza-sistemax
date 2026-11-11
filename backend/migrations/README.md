# Migraciones de produccion

Cada cambio de esquema nuevo se agrega como un archivo inmutable con el formato
`NNN_descripcion.sql`, por ejemplo `001_agregar_indice_clientes.sql`.

La primera linea debe declarar si el cambio permite volver a la imagen anterior:

```sql
-- deploy: backward-compatible
```

El despliegue normal solo admite migraciones `backward-compatible`: asi puede
restaurar automaticamente la imagen anterior si falla el healthcheck. Para un
cambio que requiera una segunda entrega (por ejemplo, borrar una columna), se
debe hacer primero una migracion compatible y planear el corte por separado.

El runner guarda el SHA-256 de cada archivo en `schema_migrations`. Modificar
una migracion ya aplicada hace fallar el despliegue; cree otra migracion.

`000_baseline.sql` no altera datos ni estructura. Solo registra la estructura
historica despues de verificar que existen `clientes`, `pagos` y `config`.
