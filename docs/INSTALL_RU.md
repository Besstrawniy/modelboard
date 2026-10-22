# Установка ModelBoard

Эта инструкция относится к текущему MVP. Для разработки PostgreSQL запускается в Docker, а Web/API/Collaboration server — через Node.js на хостовой системе. Для общего сервера в локальной сети/VPN есть отдельный Docker Compose: [SERVER_RU.md](SERVER_RU.md).

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

Если репозиторий закрытый, GitHub запросит авторизацию при клонировании.

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
VITE_API_URL=/api
VITE_COLLAB_URL=/collab
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

Для постоянного запуска в локальной сети или VPN используйте [серверную инструкцию](SERVER_RU.md). Она содержит Docker Compose, сохранение существующей БД, настройку общего адреса, обновление и диагностику.

Для тестового запуска через Node.js откройте `http://IP_СЕРВЕРА:5173`. В корневом .env установите:

```env
WEB_ORIGIN=http://192.168.1.50:5173
VITE_API_URL=/api
VITE_COLLAB_URL=/collab
```

Перезапустите `npm run dev`. Vite проксирует оба сервиса; для участников достаточно одного порта 5173. Старые VITE-адреса с localhost нужно заменить, иначе браузер участника будет обращаться к его собственному компьютеру.

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

Если процесс уже работает, остановите его через `Ctrl+C`.

Затем:

```bash
git pull
npm install
npm run dev
```

При старте API автоматически выполняет ещё не применённые SQL-миграции из:

```text
packages/db/migrations/
```

Применённые версии фиксируются в таблице `schema_migrations`.

Поэтому после обычного обновления проекта **не нужно удалять PostgreSQL volume** и не нужно повторно выполнять `init.sql`.

## 12. Миграции и сброс dev-БД

Нормальное обновление схемы:

```bash
git pull
npm run dev
```

В логе API при наличии новой миграции появится сообщение вида:

```text
Applied database migration: 001_object_templates.sql
```

Полный сброс БД нужен только если вы сознательно хотите удалить все локальные данные:

```bash
docker compose down -v
docker compose up -d postgres
```

**Внимание:** `down -v` безвозвратно удаляет текущие Dataset, шаблоны, комментарии и другие данные dev-БД.

## 13. WSL

Для Windows рекомендуется запускать ModelBoard внутри WSL2, но сам репозиторий лучше хранить в Linux filesystem, например:

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/Besstrawniy/modelboard.git
cd modelboard
```

Путь вида:

```text
/mnt/c/Users/.../modelboard
```

тоже работает, но npm/Vite могут быть медленнее, а на `node_modules` иногда встречаются ошибки `ENOTEMPTY` из-за NTFS.

Обязательно используйте Node.js 22+:

```bash
node -v
```

Если используется Node.js 18, Vite 8 может завершиться ошибкой, связанной с `node:util/styleText`.

## 14. Остановка

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

## 15. Диагностика

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

Проверьте запрос WebSocket к `/collab` в браузере и журналы collab/web. Для Vite и серверного Nginx используется тот же адрес, что у страницы. Не оставляйте VITE_COLLAB_URL с localhost на компьютерах участников. Если используется HTTPS reverse proxy, ему нужно передавать WebSocket Upgrade; клиент выберет WSS автоматически.
