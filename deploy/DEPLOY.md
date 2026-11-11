# Despliegue seguro de Cobranzas

Produccion es `https://cobranza.sysfarma.pe`. Es un proyecto Docker aislado:
solo se administra el servicio `app` del proyecto Compose `cobranzasysfarmape`.
No se toca EnterFarma, Evolution, otras redes, ni el volumen PostgreSQL `pgdata`.

La carpeta `/var/www/cobranza.sysfarma.pe` conserva su `.env`, `media` y
`docker-compose.yml`, pero **no es un checkout Git**. El release se genera con
`git archive` desde un commit exacto de `main` y se extrae bajo
`/var/lib/cobranza-releases/<commit>`.

## Instalacion unica en el servidor

Primero debe estar instalado el helper remoto y comprobado sin desplegar nada:

```bash
./deploy/install-server-deployer.sh
```

Instala `/usr/local/sbin/deploy-apk-cobranza` con permisos `0750`, crea solo
las carpetas privadas de releases/backups de Cobranzas y ejecuta un healthcheck.
El helper toma un `flock` en `/var/lock/apk-cobranza-deploy.lock`; por eso dos
sesiones no pueden desplegar al mismo tiempo.

## Flujo de cada release

```bash
git push origin main
./deploy/deploy.sh --check  # tests, build y preflight; no modifica produccion
./deploy/deploy.sh          # promociona exactamente HEAD
```

El script exige: rama `main`, arbol enteramente limpio, `HEAD == origin/main`,
tests Node de backend y frontend, y build Vite correcto. Luego empaqueta el
commit, verifica SHA-256 en el servidor y deja que el helper construya la
imagen con `GIT_COMMIT=<sha>`.

El resultado se comprueba en ambos extremos:

```text
http://127.0.0.1:3100/api/health
https://cobranza.sysfarma.pe/api/health
```

Ambos deben devolver `ok`, `db` y el mismo `commit` de 40 caracteres. La
bitacora operacional queda fuera del repositorio: `/var/log/cobranza-deploy.log`.

## Migraciones

Las migraciones viven en `backend/migrations/NNN_descripcion.sql`. No ejecute
`schema.sql` en una base existente: ese archivo es solo para el primer volumen.

Cada archivo requiere una de estas cabeceras:

```sql
-- deploy: backward-compatible
-- deploy: requires-manual-rollback
```

El helper solo promociona migraciones compatibles hacia atras. Antes de aplicar
una pendiente crea un `pg_dump` formato custom en `/var/backups/cobranza` y usa
un advisory lock PostgreSQL. Guarda nombre, checksum, fecha y commit en
`schema_migrations`; editar o borrar una migracion ya aplicada detiene el
despliegue. No hay rollback automatico de base de datos: restaurar datos sin
revision podria perder cobros; el dump es la red de seguridad para un operador.

`000_baseline.sql` no modifica el esquema actual. Solo registra el punto de
partida despues de comprobar las tablas minimas de la base historica.

## Recuperacion

Si la nueva app no pasa healthcheck, el helper vuelve automaticamente a la
imagen previa, porque toda migracion admitida es compatible con ella. Revise:

```bash
ssh root@5.161.118.178 'tail -100 /var/log/cobranza-deploy.log'
ssh root@5.161.118.178 'docker logs --tail 100 cobranzasysfarmape-app-1'
```

No borre releases, imagenes ni archivos sueltos de produccion como parte de un
deploy. La limpieza historica es una tarea distinta que requiere inventario y
aprobacion explicita.
