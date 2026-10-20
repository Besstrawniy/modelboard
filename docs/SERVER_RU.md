# Общий сервер ModelBoard для локальной сети или VPN

Участники открывают один адрес, например `http://192.168.1.50:8080`. Статический фронтенд, REST API (`/api`) и совместное редактирование (`/collab`) доступны через Nginx. База, API и Collaboration server не публикуют порты на хосте. Сайт запускается без dev-сервера Vite; Node.js нужен внутри образов, а не на компьютерах участников.

В серверном Compose используется вход по email и паролю. Выбор демонстрационной роли и API демо-входа отключены. Для открытого Интернета настройте HTTPS. Сам VPN не превращает HTTP-страницу в безопасный контекст браузера: буфер обмена через браузерный API и микрофон могут требовать HTTPS даже внутри VPN.

## Новый сервер

Нужны Git, Docker Engine и Docker Compose plugin с поддержкой `up --wait`. Команды выполняйте из корня репозитория:

```bash
git pull
cp .env.server.example .env.server
openssl rand -hex 24
openssl rand -hex 32
nano .env.server
```

Первое случайное значение вставьте в POSTGRES_PASSWORD, второе — в JWT_SECRET. WEB_ORIGIN замените на реальный адрес сервера. Например:

```env
POSTGRES_DB=modelboard
POSTGRES_USER=modelboard
POSTGRES_PASSWORD=СЛУЧАЙНОЕ_ЗНАЧЕНИЕ_ИЗ_ПЕРВОЙ_КОМАНДЫ
JWT_SECRET=СЛУЧАЙНОЕ_ЗНАЧЕНИЕ_ИЗ_ВТОРОЙ_КОМАНДЫ
OWNER_PASSWORD=ВАШ_ОТДЕЛЬНЫЙ_ПАРОЛЬ_НЕ_КОРОЧЕ_12_СИМВОЛОВ
WEB_BIND_ADDRESS=0.0.0.0
WEB_PORT=8080
WEB_ORIGIN=http://192.168.1.50:8080
```

Для пароля БД используйте сгенерированную hex-строку: она не требует экранирования в DATABASE_URL. Не копируйте примеры значений из инструкции как реальные секреты.

```bash
docker compose --env-file .env.server -f docker-compose.server.yml up -d --build --wait
docker compose --env-file .env.server -f docker-compose.server.yml ps
curl http://127.0.0.1:8080/api/health
```

Разрешите TCP 8080 от вашей локальной/VPN-подсети в firewall. Если используется UFW, пример для сети 192.168.1.0/24:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp
```

Подставьте вашу реальную подсеть. Порты 5432, 3001 и 1234 наружу не нужны.

На других компьютерах откройте `http://192.168.1.50:8080`. Войдите как `owner@example.local` с OWNER_PASSWORD. Для второго участника задайте отдельный EDITOR_PASSWORD, войдите как `editor@example.local` и откройте ту же доску. Статус должен стать `connected`. Проверьте перемещение фигуры и изменение ячейки с обеих сторон.

## Учётные записи и обновление существующего сервера

При обновлении добавьте в существующий .env.server OWNER_PASSWORD (от 12 символов).
Не заменяйте действующие POSTGRES_PASSWORD и JWT_SECRET. Затем пересоберите весь набор сервисов:

```bash
git pull
nano .env.server
docker compose --env-file .env.server -f docker-compose.server.yml up -d --build --wait
```

| Email | Пароль из .env.server |
| --- | --- |
| owner@example.local | OWNER_PASSWORD, обязательный |
| editor@example.local | EDITOR_PASSWORD |
| commenter@example.local | COMMENTER_PASSWORD |
| viewer@example.local | VIEWER_PASSWORD |

Для необязательных учётных записей пустой пароль означает, что вход отключён.
Каждый заданный пароль должен содержать минимум 12 символов; используйте разные пароли.
Это четыре общие учётные записи существующей установки, а не персональные аккаунты участников.
Права берутся из workspace_members в БД; передать себе роль OWNER в запросе нельзя.
Доски, таблицы и другие данные сохраняются, миграция БД не требуется.

После включения защиты старые демонстрационные токены перестают работать и в API, и в WebSocket.
Изменение любого из паролей с пересозданием API/Collab завершает действующие сеансы; участникам нужно войти заново.
Пароли остаются только на сервере, не попадают в сборку фронтенда и не записываются в localStorage.
Nginx ограничивает частоту запросов входа; после большого числа попыток подождите минуту.
Передавать пароли через HTTP следует только в доверенной сети/VPN; для остальных случаев нужен HTTPS.

Локальный запуск для разработки сохраняет демонстрационный вход.
Для проверки парольного режима через npm задайте AUTH_MODE=password, JWT_SECRET и пароли в корневом .env.
В NODE_ENV=production демонстрационный вход недоступен независимо от AUTH_MODE.

## Переход с существующего локального запуска

Сначала сохраните резервную копию, пока текущий PostgreSQL работает:

```bash
docker compose -f docker-compose.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > modelboard-before-server.dump
```

Остановите старый `npm run dev` через Ctrl+C. Создайте .env.server, сохранив POSTGRES_DB, POSTGRES_USER и POSTGRES_PASSWORD из действующей установки. При существующем volume изменение переменной POSTGRES_PASSWORD не меняет пароль внутри PostgreSQL.

Запускайте новый Compose из того же каталога репозитория и с тем же project name, что и старый. Оба Compose-файла используют volume `modelboard_pg`; при одинаковом project name это тот же том с данными. Если раньше использовали `docker compose -p ИМЯ`, используйте такое же `-p ИМЯ` и в новых командах. При переносе на другую машину сначала перенесите резервную копию и восстановите БД; само копирование Git-репозитория данные не переносит.

Далее выполните обычную команду запуска серверного Compose. API применит миграции, после его готовности запустится Collaboration server. Не выполняйте `down -v`: для обновления и перехода это не требуется и удаляет базу.

## Обычное обновление и остановка

```bash
git pull
docker compose --env-file .env.server -f docker-compose.server.yml up -d --build --wait
```

Секреты не генерируйте заново при каждом обновлении. Они лежат в .env.server, который исключён из Git и Docker build context.

Просмотр журналов:

```bash
docker compose --env-file .env.server -f docker-compose.server.yml logs -f --tail=100 web api collab
```

Остановка с сохранением данных:

```bash
docker compose --env-file .env.server -f docker-compose.server.yml down
```

Добавленная в `apps/web/public/music/` коллекция включается в web-образ при сборке. После добавления или замены файлов пересоберите web: `docker compose --env-file .env.server -f docker-compose.server.yml up -d --build web`.

## Подключение без Docker для разработки

Существующий `npm run dev` тоже работает с других компьютеров по `http://IP_СЕРВЕРА:5173`. В корневом .env замените прежние адреса localhost:

```env
VITE_API_URL=/api
VITE_COLLAB_URL=/collab
WEB_ORIGIN=http://192.168.1.50:5173
```

Перезапустите `npm run dev`. Vite проксирует API и WebSocket на процессы этого же сервера. Для участников нужен только TCP 5173. PostgreSQL при таком запуске по-прежнему запускается через исходный `docker-compose.yml`.

## Адреса и HTTPS

По умолчанию адреса определяются по открытой странице. Поэтому hostname, IP и порт не зашиты в собранный фронтенд. При открытии HTTPS-страницы клиент автоматически использует WSS. Явные VITE_API_URL и VITE_COLLAB_URL по-прежнему поддерживаются для нестандартной схемы; в Docker они по умолчанию не нужны.

Если перед Nginx установлен свой HTTPS reverse proxy, передавайте запросы целиком на web:80 или опубликованный WEB_PORT и поддержите WebSocket Upgrade для /collab. Для TLS на общем домене разрешайте участникам только этот домен. Настройка сертификатов и DNS зависит от адреса вашей инфраструктуры.

## Проверка в CI

Обычный набор проверяет приложение через Vite с проксированием. Отдельное задание `server-e2e` собирает реальные Docker-образы, поднимает PostgreSQL/API/Collaboration/Nginx и открывает сайт на http://modelboard.test:8080 (имя сопоставляется с 127.0.0.2 только внутри CI) в двух независимых браузерах. Проверяются редактирование фигуры и Dataset в обе стороны, подключения WS через /collab и отсутствие обращений браузеров к отдельным сервисным портам.

Создание ID объектов и строк работает по HTTP в локальной сети/VPN: клиент использует crypto.getRandomValues вместо ограниченного защищённым контекстом crypto.randomUUID. Серверный браузерный тест проверяет обычный HTTP-хост с isSecureContext=false, создание объектов владельцем и редактором, размещение таблицы и совместное изменение ячеек.
