# Salon Booking Template

English · Русский · Español · ʻŌlelo Hawaiʻi

---

## English

An open-source template for a beauty salon website with online booking and a protected admin panel. The public site is plain HTML/CSS/JS; the backend is Node.js + Fastify + SQLite. Fonts and assets are served locally — no external CDN, analytics, or third-party scripts.

All business details are placeholders. Replace the demo name, phone, address, map links and price list in `public/index.html`, `public/privacy.html` and `public/js/data.js` before publishing.

### Stack

| Layer | Technologies |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, self-hosted Manrope and Marck Script fonts |
| Backend | Node.js 24, Fastify 5, TypeScript |
| Database | SQLite (`better-sqlite3`), WAL, `secure_delete` |
| Auth | Argon2id, server-side sessions, HttpOnly + SameSite=Strict cookies, CSRF header |
| Real-time | Server-Sent Events with 15-second polling fallback |
| Containers | Docker, Docker Compose, Caddy (automatic TLS) |
| Deployment | Manual build on the server; no CI/CD, no external registry |

### Structure

```
public/                 public site and admin panel
  index.html            landing page
  privacy.html          personal-data policy template
  admin/                admin panel (plain HTML/CSS/JS, no build step)
  css/, js/, assets/    styles, scripts, fonts, placeholder images
server/src/             Fastify application
  config.ts             environment validation
  db/                   SQLite access
  lib/                  validation, security, time, backups
  routes/               public and admin APIs
  services/             sessions, events
  scripts/              migrations, admin, backup, retention
server/test/            Vitest: API, security, retention
migrations/             SQL migrations
docker/                 container entrypoint
deploy/                 Caddyfile
Dockerfile              multi-stage build
docker-compose.yml      local run
docker-compose.prod.yml production: app + Caddy
```

### Local run without Docker

Node.js 24+ is required.

```bash
npm install
cp .env.example .env
# Generate a backup key and put it into BACKUP_KEY:
openssl rand -hex 32
# Make sure APP_ORIGIN matches the address you open the site at.

npm run dev
# http://localhost:3000
```

Migrations run automatically on start. Manually:

```bash
npm run migrate:dev          # apply migrations
npm run admin:create:dev     # create an administrator (interactive)
npm run admin:reset:dev      # change password and revoke all sessions
```

Admin panel: `http://localhost:3000/admin/`.

### Admin access (demo)

The account is not created automatically. After the first start run `npm run admin:create:dev` (in Docker: `docker compose exec app node dist/scripts/create-admin.js`) and enter:

- Login: `admin`
- Password: `DemoPassw0rd!2026` (enter it twice when prompted)

Do not use this password on a public server — change it immediately:

```bash
# without Docker
npm run admin:reset:dev

# in Docker
docker compose exec app node dist/scripts/reset-admin.js
```

The reset script asks for the login and the new password twice, then terminates all active sessions. Password rules: at least 12 characters, no spaces, at least 3 of 4 groups (lowercase, uppercase, digits, symbols), and it must not contain the login. Another account can be created with `admin:create` / `create-admin.js`.

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development` / `test` / `production` | `development` |
| `HOST`, `PORT` | bind address and port | `0.0.0.0`, `3000` |
| `APP_ORIGIN` | exact public origin used for Origin/CSRF checks | required |
| `COOKIE_SECURE` | `true` only over HTTPS | `false` |
| `TRUST_PROXY` | `true` only behind a trusted proxy (Caddy) | `false` |
| `SESSION_IDLE_HOURS` | idle session lifetime | `12` |
| `SESSION_ABSOLUTE_DAYS` | absolute session lifetime | `7` |
| `BOOKING_RETENTION_DAYS` | booking retention | `90` |
| `BACKUP_RETENTION_DAYS` | backup retention | `7` |
| `BACKUP_KEY` | 64 hex characters (32 bytes) for AES-256-GCM | — |
| `BACKUP_KEY_FILE` | path to a key file (Docker secret) | — |
| `CONSENT_VERSION` | consent version stored with each booking | `2026-11-04` |
| `RATE_LIMIT_DISABLED` | disable only in tests | `false` |
| `LOG_LEVEL` | Fastify log level | `info` |

`.env` and `.env.production` are not committed. Use `chmod 600 .env`.

### Docker locally

```bash
docker compose up -d --build
docker compose logs -f app
```

Site: `http://localhost:3000`. The port is bound to `127.0.0.1` only. Data lives in the named volume `salon-template-data`.

```bash
docker compose exec app node dist/scripts/create-admin.js
docker compose down
docker compose down -v   # careful: deletes the database
```

### Backups, restore, retention

A backup is a consistent SQLite snapshot (`VACUUM INTO`) encrypted with AES-256-GCM. Files named `salon-<timestamp>.db.enc` are written to `BACKUP_DIR`.

```bash
# without Docker
npm run backup:dev
npm run restore:dev -- data/backups/salon-....db.enc
npm run retention:dev

# in Docker
docker compose exec app node dist/scripts/backup.js
docker compose stop app
docker compose run --rm app node dist/scripts/restore.js /app/data/backups/<file>.db.enc
docker compose start app
```

`restore` checks SQLite integrity and keeps the current database next to the original before replacing it. Expired bookings, sessions and audit rows are removed automatically; `retention` can also be run from cron.

### Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Tests use in-memory SQLite and never touch the local database.

### Security

- Passwords are hashed with Argon2id; session tokens are stored hashed.
- Cookies: `HttpOnly`, `SameSite=Strict`, `Secure` in production, `__Host-` prefix over HTTPS.
- Every state-changing admin request requires same-origin and the `x-csrf-token` header.
- Login is rate limited; after 10 failures an IP+login pair is blocked for 15 minutes.
- Public form: 5 requests / 10 minutes per IP, honeypot, duplicate suppression, strict Zod validation, body limit.
- SQL is always parameterized; search escapes `%` and `_`.
- CSP allows only self-hosted scripts plus the JSON-LD hash; no `unsafe-inline`.
- Logs contain no query strings, headers, names, phones or comments.
- Medical categories are rejected by the API even if the form is bypassed.
- The container runs as non-root with a read-only rootfs, no capabilities and `no-new-privileges`.

### Production: manual deployment

CI/CD and external registries are not used. The image is built on the server from source, so code and secrets never leave it.

1. Provision a VPS (Ubuntu 24.04, 2–4 vCPU, 4 GB RAM, 40+ GB SSD), point DNS at it, create a sudo user with SSH keys, configure firewall (22/80/443) and fail2ban, install Docker Engine and Compose v2.
2. Put the source on the server:

```bash
sudo mkdir -p /opt/salon-template/secrets
sudo chown -R "$USER":"$USER" /opt/salon-template
cd /opt/salon-template
# git clone <repo> . or unpack an archive

cp .env.production.example .env.production
# Set DOMAIN and APP_ORIGIN to your real domain, then:
chmod 600 .env.production

openssl rand -hex 32 > secrets/backup_key
chmod 600 secrets/backup_key
```

3. Build and start:

```bash
cd /opt/salon-template
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml exec app \
  node dist/scripts/create-admin.js
```

4. Optional manual backup before updating (e.g. daily at 03:10 server time):

```cron
10 3 * * * cd /opt/salon-template && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app node dist/scripts/backup.js >> /var/log/salon-template-backup.log 2>&1
```

### Production: update and rollback

```bash
cd /opt/salon-template
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T app node dist/scripts/backup.js
docker tag salon-template-app:prod salon-template-app:previous
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml build app
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --remove-orphans
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

If the new container fails or `/readyz` does not answer:

```bash
cd /opt/salon-template
docker tag salon-template-app:previous salon-template-app:prod
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d --no-build --force-recreate app
```

The `salon-template-data` volume is untouched by a rollback. If a migration has already been applied, restore the database from a backup before starting the older image.

### Data and privacy

Bookings are kept for 90 days, encrypted backups for 7 days, and admin audit records for 1 year without personal data. Before going live, fill in `public/privacy.html` and handle any operator/legal requirements yourself. Remove test bookings and test admin accounts before handing the site over.

### License

MIT © 2026 wnselin. See [LICENSE](LICENSE).

---

## Русский

Шаблон сайта салона красоты с онлайн-записью и защищённой админ-панелью. Публичная часть — обычные HTML/CSS/JS, бэкенд — Node.js + Fastify + SQLite. Шрифты и ресурсы размещены локально, внешних CDN и аналитики нет.

Все реквизиты в шаблоне — заглушки. Перед публикацией замените демо-название, телефон, адрес, ссылки на карту и прайс в `public/index.html`, `public/privacy.html` и `public/js/data.js`.

### Стек

| Слой | Технологии |
|---|---|
| Фронтенд | Vanilla HTML/CSS/JS, локальные шрифты Manrope и Marck Script |
| Бэкенд | Node.js 24, Fastify 5, TypeScript |
| БД | SQLite (`better-sqlite3`), WAL, `secure_delete` |
| Авторизация | Argon2id, серверные сессии, HttpOnly + SameSite=Strict cookie, CSRF-заголовок |
| Real-time | Server-Sent Events, резервный polling каждые 15 секунд |
| Контейнеры | Docker, Docker Compose, Caddy (TLS) |
| Деплой | Ручная сборка на сервере, без CI/CD и внешнего registry |

### Структура

```
public/                 публичный сайт и админ-панель
  index.html            главная страница
  privacy.html          шаблон политики персональных данных
  admin/                админ-панель (HTML/CSS/JS, без сборки)
  css/, js/, assets/    стили, скрипты, шрифты, заглушки изображений
server/src/             Fastify-приложение
  config.ts             валидация окружения
  db/                   доступ к SQLite
  lib/                  валидация, безопасность, время, бэкапы
  routes/               публичный API и админ-API
  services/             сессии, события
  scripts/              миграции, админ, бэкапы, retention
server/test/            Vitest: API, безопасность, retention
migrations/             SQL-миграции
docker/                 entrypoint контейнера
deploy/                 Caddyfile
Dockerfile              multi-stage сборка
docker-compose.yml      локальный запуск
docker-compose.prod.yml production: app + Caddy
```

### Локальный запуск без Docker

Нужен Node.js 24+.

```bash
npm install
cp .env.example .env
openssl rand -hex 32   # ключ бэкапов, вставьте в BACKUP_KEY
npm run dev
# http://localhost:3000
```

Миграции применяются автоматически. Отдельно: `npm run migrate:dev`, `npm run admin:create:dev`, `npm run admin:reset:dev`. Админ-панель: `http://localhost:3000/admin/`.

### Доступ в админку (демо)

Аккаунт не создаётся автоматически. После первого запуска выполните `npm run admin:create:dev` (в Docker: `docker compose exec app node dist/scripts/create-admin.js`) и введите:

- Логин: `admin`
- Пароль: `DemoPassw0rd!2026` (дважды при создании)

Не используйте этот пароль на публичном сервере — сразу смените его:

```bash
# без Docker
npm run admin:reset:dev

# в Docker
docker compose exec app node dist/scripts/reset-admin.js
```

Скрипт запросит логин и новый пароль дважды, затем завершит все активные сессии. Требования к паролю: не менее 12 символов, без пробелов, минимум 3 из 4 групп (строчные, заглавные, цифры, спецсимволы), пароль не должен содержать логин. Другого администратора можно создать через `admin:create` / `create-admin.js`.

### Переменные окружения

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `NODE_ENV` | `development` / `test` / `production` | `development` |
| `HOST`, `PORT` | адрес и порт | `0.0.0.0`, `3000` |
| `APP_ORIGIN` | точный публичный origin для Origin/CSRF | обязательна |
| `COOKIE_SECURE` | `true` только за HTTPS | `false` |
| `TRUST_PROXY` | `true` только за доверенным прокси | `false` |
| `SESSION_IDLE_HOURS` / `SESSION_ABSOLUTE_DAYS` | сроки сессии | `12` / `7` |
| `BOOKING_RETENTION_DAYS` | срок хранения заявок | `90` |
| `BACKUP_RETENTION_DAYS` | срок хранения бэкапов | `7` |
| `BACKUP_KEY` | 64 hex-символа для AES-256-GCM | — |
| `BACKUP_KEY_FILE` | путь к файлу с ключом (Docker secret) | — |
| `CONSENT_VERSION` | версия согласия | `2026-11-04` |
| `RATE_LIMIT_DISABLED` | только в тестах | `false` |
| `LOG_LEVEL` | уровень логов | `info` |

`.env` и `.env.production` не коммитятся: `chmod 600 .env`.

### Docker локально

```bash
docker compose up -d --build
docker compose logs -f app
docker compose exec app node dist/scripts/create-admin.js
docker compose down -v   # удалит базу
```

Сайт: `http://localhost:3000`, порт привязан к `127.0.0.1`. Данные — в volume `salon-template-data`.

### Бэкапы и проверки

Бэкап — консистентный снимок SQLite, зашифрованный AES-256-GCM: `salon-<timestamp>.db.enc`.

```bash
npm run backup:dev
npm run restore:dev -- data/backups/salon-....db.enc
npm run retention:dev
```

Проверки: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Тесты используют in-memory SQLite.

### Безопасность

Хеши паролей Argon2id, сессии хешируются, cookie `HttpOnly`/`SameSite=Strict`/`Secure`, CSRF-заголовок, rate limit, honeypot, параметризованный SQL, строгий CSP, non-root контейнер с read-only rootfs. Подробности — в английской секции.

### Production: ручной деплой

CI/CD и внешний registry не используются: образ собирается прямо на сервере.

```bash
sudo mkdir -p /opt/salon-template/secrets
sudo chown -R "$USER":"$USER" /opt/salon-template
cd /opt/salon-template
# git clone <repo> . или распакуйте архив
cp .env.production.example .env.production
# укажите DOMAIN и APP_ORIGIN
chmod 600 .env.production
openssl rand -hex 32 > secrets/backup_key
chmod 600 secrets/backup_key

docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml exec app \
  node dist/scripts/create-admin.js
```

Обновление: бэкап → `docker tag salon-template-app:prod salon-template-app:previous` → `git pull --ff-only` → `build app` → `up -d --remove-orphans`. Откат: `docker tag salon-template-app:previous salon-template-app:prod` и `up -d --no-build --force-recreate app`. Volume `salon-template-data` при откате не затрагивается; при уже применённой миграции сначала восстановите БД из бэкапа.

### Данные и лицензия

Заявки — 90 дней, бэкапы — 7 дней, аудит администратора — 1 год без персональных данных. Перед публикацией заполните `public/privacy.html` и удалите тестовые заявки и учётные записи. MIT © 2026 wnselin, см. [LICENSE](LICENSE).

---

## Español

Plantilla de código abierto para el sitio web de un salón de belleza, con reserva en línea y un panel de administración protegido. La parte pública es HTML/CSS/JS sin frameworks; el backend usa Node.js + Fastify + SQLite. Las fuentes y los recursos se sirven localmente: sin CDN externos ni analítica.

Todos los datos comerciales son de ejemplo. Sustituye el nombre, teléfono, dirección, enlaces de mapa y lista de precios en `public/index.html`, `public/privacy.html` y `public/js/data.js`.

### Tecnologías

| Capa | Tecnologías |
|---|---|
| Frontend | HTML/CSS/JS puro, fuentes locales Manrope y Marck Script |
| Backend | Node.js 24, Fastify 5, TypeScript |
| Base de datos | SQLite (`better-sqlite3`), WAL, `secure_delete` |
| Autenticación | Argon2id, sesiones en servidor, cookies HttpOnly + SameSite=Strict, cabecera CSRF |
| Tiempo real | Server-Sent Events con respaldo de sondeo cada 15 s |
| Contenedores | Docker, Docker Compose, Caddy (TLS) |
| Despliegue | Compilación manual en el servidor; sin CI/CD ni registro externo |

### Estructura

```
public/                 sitio público y panel de administración
  index.html            página principal
  privacy.html          plantilla de política de datos personales
  admin/                panel de administración (HTML/CSS/JS)
  css/, js/, assets/    estilos, scripts, fuentes e imágenes de ejemplo
server/src/             aplicación Fastify
  config.ts             validación del entorno
  db/, lib/, routes/, services/, scripts/
server/test/            pruebas Vitest
migrations/             migraciones SQL
docker/, deploy/        entrypoint y Caddyfile
Dockerfile              compilación multi-etapa
docker-compose.yml      ejecución local
docker-compose.prod.yml producción: app + Caddy
```

### Inicio local sin Docker

Se requiere Node.js 24+.

```bash
npm install
cp .env.example .env
openssl rand -hex 32   # clave de copias de seguridad → BACKUP_KEY
npm run dev
# http://localhost:3000
```

Las migraciones se aplican al iniciar. También: `npm run migrate:dev`, `npm run admin:create:dev`, `npm run admin:reset:dev`. Panel: `http://localhost:3000/admin/`.

### Acceso al panel (demo)

La cuenta no se crea automáticamente. Tras el primer inicio ejecuta `npm run admin:create:dev` (en Docker: `docker compose exec app node dist/scripts/create-admin.js`) e introduce:

- Usuario: `admin`
- Contraseña: `DemoPassw0rd!2026` (dos veces al crearla)

No uses esta contraseña en un servidor público; cámbiala enseguida:

```bash
# sin Docker
npm run admin:reset:dev

# en Docker
docker compose exec app node dist/scripts/reset-admin.js
```

El script pide el usuario y la nueva contraseña dos veces y cierra todas las sesiones activas. Reglas: al menos 12 caracteres, sin espacios, al menos 3 de 4 grupos (minúsculas, mayúsculas, dígitos, símbolos) y la contraseña no debe contener el usuario. Otra cuenta se crea con `admin:create` / `create-admin.js`.

### Variables de entorno

| Variable | Uso | Valor por defecto |
|---|---|---|
| `NODE_ENV` | `development` / `test` / `production` | `development` |
| `HOST`, `PORT` | dirección y puerto | `0.0.0.0`, `3000` |
| `APP_ORIGIN` | origen público exacto para Origin/CSRF | obligatoria |
| `COOKIE_SECURE` | `true` solo con HTTPS | `false` |
| `TRUST_PROXY` | `true` solo tras proxy de confianza | `false` |
| `SESSION_IDLE_HOURS` / `SESSION_ABSOLUTE_DAYS` | duración de sesión | `12` / `7` |
| `BOOKING_RETENTION_DAYS` | retención de reservas | `90` |
| `BACKUP_RETENTION_DAYS` | retención de copias | `7` |
| `BACKUP_KEY` | 64 caracteres hex para AES-256-GCM | — |
| `BACKUP_KEY_FILE` | ruta al archivo de clave (secreto Docker) | — |
| `CONSENT_VERSION` | versión del consentimiento | `2026-11-04` |
| `RATE_LIMIT_DISABLED` | solo en pruebas | `false` |
| `LOG_LEVEL` | nivel de registro | `info` |

`.env` y `.env.production` no se versionan: `chmod 600 .env`.

### Docker local

```bash
docker compose up -d --build
docker compose exec app node dist/scripts/create-admin.js
docker compose down -v   # cuidado: borra la base de datos
```

Sitio: `http://localhost:3000`, puerto enlazado solo a `127.0.0.1`. Datos en el volumen `salon-template-data`.

### Copias de seguridad y comprobaciones

Copia coherente de SQLite cifrada con AES-256-GCM: `salon-<timestamp>.db.enc`.

```bash
npm run backup:dev
npm run restore:dev -- data/backups/salon-....db.enc
npm run retention:dev
```

Comprobaciones: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Las pruebas usan SQLite en memoria.

### Seguridad

Contraseñas con hash Argon2id, sesiones con hash, cookies `HttpOnly`/`SameSite=Strict`/`Secure`, cabecera CSRF, límite de frecuencia, honeypot, SQL parametrizado, CSP estricto y contenedor non-root con sistema de archivos de solo lectura.

### Producción: despliegue manual

Sin CI/CD ni registro externo: la imagen se compila en el servidor.

```bash
sudo mkdir -p /opt/salon-template/secrets
sudo chown -R "$USER":"$USER" /opt/salon-template
cd /opt/salon-template
# git clone <repo> . o descomprima el archivo
cp .env.production.example .env.production
# configure DOMAIN y APP_ORIGIN
chmod 600 .env.production
openssl rand -hex 32 > secrets/backup_key
chmod 600 secrets/backup_key

docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml exec app \
  node dist/scripts/create-admin.js
```

Actualización: copia de seguridad → `docker tag salon-template-app:prod salon-template-app:previous` → `git pull --ff-only` → `build app` → `up -d --remove-orphans`. Reversión: `docker tag salon-template-app:previous salon-template-app:prod` y `up -d --no-build --force-recreate app`. El volumen `salon-template-data` no se toca; si ya se aplicó una migración, restaure la base desde una copia antes de iniciar la imagen anterior.

### Datos y licencia

Reservas: 90 días; copias cifradas: 7 días; auditoría del administrador: 1 año sin datos personales. Antes de publicar, complete `public/privacy.html` y elimine reservas y cuentas de prueba. MIT © 2026 wnselin, véase [LICENSE](LICENSE).

---

## ʻŌlelo Hawaiʻi

Aloha! He kumu hoʻohālike kēia no ka pūnaewele o kekahi salona nani: he ʻaoʻao lehulehu (HTML/CSS/JS) a me kahi papa hoʻokele no nā noi. Aia nā ʻikepili ma ka server o ʻoe iho; ʻaʻohe CDN, ʻaʻohe ʻikepili i nā lawelawe ʻē aʻe.

E hoʻololi i ka inoa, ke kelepona, ka helu wahi a me ka papa kumukūʻai ma `public/index.html`, `public/privacy.html` a me `public/js/data.js` ma mua o ka hoʻolaha ʻana.

### Nā ʻenehana

| Māhele | Nā mea i hoʻohana ʻia |
|---|---|
| ʻAoʻao lehulehu | HTML/CSS/JS, nā font Manrope lāua ʻo Marck Script ma ka server |
| Backend | Node.js 24, Fastify 5, TypeScript |
| Waihona ʻikepili | SQLite (`better-sqlite3`) |
| Palekana | Argon2id, mau kau ma ka server, cookie HttpOnly, CSRF |
| Manawa maoli | Server-Sent Events |
| Pahu hana | Docker, Docker Compose, Caddy |
| Hoʻokomo ʻana | Kūkulu lima ma ka server; ʻaʻohe CI/CD |

### Hoʻomaka wikiwiki

Pono ʻoe iā Node.js 24+.

```bash
npm install
cp .env.example .env
openssl rand -hex 32   # e waiho i ke kī ma BACKUP_KEY
npm run dev
# http://localhost:3000
```

Hoʻopili ʻakomi ʻia nā migrations. ʻO ka papa hoʻokele: `http://localhost:3000/admin/`.

### Komika i ka papa hoʻokele (demo)

ʻAʻole hana ʻakomi ʻia ka moʻokāki. E holo mua i `npm run admin:create:dev` (ma Docker: `docker compose exec app node dist/scripts/create-admin.js`) a e hoʻokomo i:

- Inoa komika: `admin`
- ʻŌlelo huna: `DemoPassw0rd!2026` (e kākau i ʻelua manawa)

Mai hoʻohana i kēia ʻōlelo huna ma ke kikowaena lehulehu; e hoʻololi koke:

```bash
# me Docker ʻole
npm run admin:reset:dev

# ma Docker
docker compose exec app node dist/scripts/reset-admin.js
```

E nīnau ke kauoha i ke inoa a me ka ʻōlelo huna hou i ʻelua manawa, a e pani i nā kau āpau. Nā kūlana: ma ka liʻiliʻi he 12 huaʻōlelo, ʻaʻohe wahi hakahaka, ma ka liʻiliʻi 3 o 4 pūʻulu (haʻahaʻa, kiʻekiʻe, helu, hōʻailona), ʻaʻole e komo ka inoa komika i loko o ka ʻōlelo huna.

Nā kauoha nui: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. No Docker: `docker compose up -d --build`. Aia nā ʻikepili ma ka volume `salon-template-data`.

### Hoʻokomo ʻana ma ka server

Kūkulu ʻia ke kiʻi ma ka server iho; ʻaʻohe lawelawe CI a i ʻole registry waho.

```bash
sudo mkdir -p /opt/salon-template/secrets
sudo chown -R "$USER":"$USER" /opt/salon-template
cd /opt/salon-template
cp .env.production.example .env.production
# E hoʻonoho iā DOMAIN lāua ʻo APP_ORIGIN
chmod 600 .env.production
openssl rand -hex 32 > secrets/backup_key
chmod 600 secrets/backup_key

docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml exec app \
  node dist/scripts/create-admin.js
```

No ka hoʻololi hou ʻana: e hana i kope mua, a laila `git pull --ff-only`, `build app`, `up -d --remove-orphans`. No ka hoʻihoʻi ʻana: `docker tag salon-template-app:previous salon-template-app:prod` a me `up -d --no-build --force-recreate app`.

Mālama ʻia nā noi no 90 lā, nā kope i hoʻopuna ʻia no 7 lā. Ma mua o ka hoʻolaha ʻana, e hoʻopiha iā `public/privacy.html` a e wehe i nā ʻikepili hoʻāʻo. Laikini MIT © 2026 wnselin — nānā iā [LICENSE](LICENSE).
