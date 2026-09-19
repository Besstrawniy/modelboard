# Установка ModelBoard

Эта инструкция относится к текущему MVP. Сейчас PostgreSQL запускается в Docker, а Web/API/Collaboration server — через Node.js на хостовой системе.

## 1. Требования

Рекомендуемая среда:

- Ubuntu Server 22.04/24.04 или актуальный Debian;
- Node.js 22+;
- npm 10+;
- Docker;
- Docker Compose plugin;
- Git.

Проверка:

```bash
node -v
npm -v
docker --version
docker compose version
git --version
```

## 2. Клонирование

```bash
git clone https://github.com/Besstrawniy/modelboard.git
cd modelboard
```

Репозиторий private, поэтому GitHub может запросить авторизацию.

## 3. Переменные окружения

```bash
cp .env.example .env
```

Для локального запуска значения по умолчанию подходят.

Основные параметры:

```env
DATABASE_URL=postgresql://modelboard:modelboard@localhost:5432/modelboard
JWT_SECRET=change-me-in-production

API_PORT=3001
COLLAB_PORT=1234

WEB_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:3001/api
VITE_COLLAB_URL=ws://localhost:1234
```

Для сервера обязательно замените `JWT_SECRET`.

Пример:

```env
JWT_SECRET=very-long-random-secret
```

## 4. Запуск PostgreSQL

```bash
docker compose up -d postgres
```

Проверка:

```bash
docker compose ps
docker compose logs postgres
```

PostgreSQL специально публикуется только на:

```text
127.0.0.1:5432
```

Не открывайте порт 5432 в Интернет.

## 5. Установка зависимостей

```bash
npm install
```

## 6. Запуск MVP

```bash
npm run dev
```

Запускаются три процесса:

```text
web     -> http://localhost:5173
api     -> http://localhost:3001/api
collab  -> ws://localhost:1234
```

## 7. Запуск на удалённом сервере

Предположим, сервер имеет адрес:

```text
192.168.1.50
```

В `.env`:

```env
WEB_ORIGIN=http://192.168.1.50:5173
VITE_API_URL=http://192.168.1.50:3001/api
VITE_COLLAB_URL=ws://192.168.1.50:1234
```

После изменения Vite-переменных перезапустите `npm run dev`.

В firewall для тестового запуска понадобятся:

```text
5173/tcp  Web
3001/tcp  API
1234/tcp  Collaboration WebSocket
```

Порт `5432` наружу открывать не требуется.

Для постоянного публичного развёртывания текущий dev-сервер использовать не следует. Позже проект будет переведён на production Docker Compose + reverse proxy.

## 8. Проверка API

```bash
curl http://localhost:3001/api/health
```

Ожидаемый ответ:

```json
{"ok":true,"service":"modelboard-api"}
```

## 9. Проверка совместного редактирования

Откройте:

```text
http://localhost:5173
```

В первом браузере выберите `Owner`, во втором — `Editor`.

Переместите таблицу или измените значение ячейки. Изменение должно появиться во втором окне.

Для проверки прав откройте `Commenter` или `Viewer`.

## 10. CSV

Перетащите CSV на canvas.

Например:

```csv
id;hostname;ip
1;srv-main;172.168.16.2
2;srv-backup;172.168.16.3
```

После preview нажмите создание Dataset.

## 11. Обновление проекта

```bash
git pull
npm install
npm run dev
```

Если процесс уже работает, сначала остановите его через `Ctrl+C`.

## 12. Сброс dev-БД

На ранней стадии проекта миграции БД ещё не внедрены. Если изменился `infra/postgres/init.sql`, может потребоваться пересоздать dev volume:

```bash
docker compose down -v
docker compose up -d postgres
```

**Внимание:** команда `down -v` удаляет данные текущей dev-БД.

После появления миграций этот шаг будет убран.

## 13. Остановка

Node.js процессы:

```text
Ctrl+C
```

PostgreSQL:

```bash
docker compose down
```

С удалением dev-данных:

```bash
docker compose down -v
```

## 14. Диагностика

### Порт уже занят

Linux:

```bash
sudo ss -lntp | grep -E ':5173|:3001|:1234|:5432'
```

### PostgreSQL не стартует

```bash
docker compose logs --tail=200 postgres
```

### Web открывается, API недоступен

Проверьте:

```bash
curl http://localhost:3001/api/health
```

и значения:

```env
WEB_ORIGIN=
VITE_API_URL=
```

### На удалённом компьютере Web работает, но realtime нет

Проверьте:

```env
VITE_COLLAB_URL=ws://IP_СЕРВЕРА:1234
```

а также firewall на `1234/tcp`.

Если сайт позже будет работать по HTTPS, WebSocket тоже должен перейти на `wss://`.
