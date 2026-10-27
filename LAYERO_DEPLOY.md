# Развёртывание «Шашлык Лайк × ШашлычОК» на Layero

Документ актуален на 14 октября 2026 года. Предпочтительный production-адрес: `https://shashlik-like.layero.app`.

На момент проверки этот URL возвращает Layero-экран «Адрес свободен» с HTTP 404. Значит адрес доступен для проекта, но ещё не подтверждён как активный production-домен. Создайте/переименуйте проект со slug `shashlik-like` и после этого сверьте точный URL в панели: Layero прямо рекомендует не собирать адрес вручную.

## Что исправлено в конфигурации

- Runtime указан как `node_web`, как требует схема Layero.
- Runtime-план Layero для `node_web` не выполняет отдельный `buildCommand` (`dry-run` показывает `build_cmd: none`). Поэтому `startCommand` вызывает `npm run start:layero`, который сначала создаёт `dist`, затем запускает один Node.js-сервер.
- Node.js слушает `0.0.0.0` и порт из `PORT`, по умолчанию `4174`.
- Сервер проверяет production-переменные до приёма трафика и отдаёт собранный React из `dist`.
- Прямые переходы на `/menu`, `/admin`, `/order/...`, `/checkout` и другие React-маршруты используют SPA fallback.
- `GET /health` и `GET /api/health` проверяют frontend, постоянное хранилище и показывают активный storage backend.
- `PUBLIC_SITE_URL` проверяется при запуске. Значение без `https://` больше не приводит к скрытому HTTP 500 на `GET /`.

Текущее содержимое `layero.json`:

```json
{
  "$schema": "https://layero.ru/schema/layero-v2.json",
  "installCommand": "npm ci --include=dev",
  "nodeVersion": "22",
  "runtime": "node_web",
  "startCommand": "npm run start:layero",
  "port": 4174,
  "env": {
    "NODE_ENV": "production"
  }
}
```

## Переменные окружения

| Переменная | Точное значение для Layero | Обязательная? | Назначение |
|---|---|---:|---|
| `NODE_ENV` | `production` | Да | Уже задано в `layero.json`; в панели дублировать не требуется. |
| `PORT` | `4174` | Да | Уже задано полем `port` в `layero.json`; вручную добавлять в панели не требуется. |
| `VITE_API_URL` | **НЕ ДОБАВЛЯТЬ** | Нет | Frontend и API работают на одном origin. Пустое значение включает безопасный same-origin режим. |
| `ADMIN_PASSWORD` | Сгенерировать локально командой ниже и вставить результат | Да | Пароль владельца. Минимум 12 символов; не использовать `admin` или старый скомпрометированный пароль. |
| `ADMIN_TOKEN_SECRET` | Сгенерировать локально командой ниже и вставить результат | Да | Секрет подписи admin-токенов, минимум 32 случайных символа. |
| `TELEGRAM_BOT_TOKEN` | Скопировать значение `TELEGRAM_BOT_TOKEN` из локального `.env` | Да для Telegram | Токен существует локально. Добавлять только как защищённую переменную Layero. |
| `TELEGRAM_CHAT_ID` | Скопировать значение `TELEGRAM_CHAT_ID` из локального `.env` | Рекомендуется | Резервный чат для заказов, пока сотрудники ещё не привязаны к боту. Значение существует локально. |
| `PUBLIC_SITE_URL` | `https://shashlik-like.layero.app` после закрепления этого slug в Layero | Да | Канонический HTTPS origin сайта. Если панель выдаст другой адрес, используйте точный URL из панели. Схема `https://` обязательна. |
| `DATA_STORE_PATH` | **НЕ ДОБАВЛЯТЬ** для production | Нет | Используется только локально и в тестах. |
| `LAYERO_DATABASE_URL` | Выдаётся Layero PostgreSQL автоматически | Да | Постоянное хранилище заказов, сотрудников, каталога, настроек, Telegram-привязок и загруженных изображений. Без него production не запустится. |
| `ALLOW_EMPTY_DATABASE_INITIALIZATION` | `false` / не задавать при миграции | Нет | Устанавливать `true` только один раз для совершенно нового проекта без данных. Для существующего сайта сначала импортировать backup. |
| `TELEGRAM_DISABLED` | `false` | Да для Telegram | Включает уведомления и обработку бота. |
| `TELEGRAM_POLLING_ENABLED` | `true` | Да на единственном активном экземпляре | Long polling нельзя одновременно запускать в нескольких репликах. |
| `CORS_ALLOWED_ORIGINS` | `https://shashlik-like.layero.app` после закрепления этого slug в Layero | Да | Должен точно совпадать с `PUBLIC_SITE_URL`. Если панель выдаст другой адрес, замените оба значения. |
| `TELEGRAM_API_BASE_URL` | **НЕ ДОБАВЛЯТЬ** | Нет | Только тестовая переменная для локального mock API; в production её переопределение запрещено. |

### Безопасная генерация секретов в PowerShell

Сгенерировать новый пароль владельца:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
```

Сгенерировать `ADMIN_TOKEN_SECRET`:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

Каждая команда печатает значение один раз. Вставьте его в защищённую переменную Layero. Не сохраняйте результат в Git, документации, сообщениях или скриншотах.

## Готовый список для вставки в Layero

```env
ADMIN_PASSWORD=<результат первой PowerShell-команды>
ADMIN_TOKEN_SECRET=<результат второй PowerShell-команды>
TELEGRAM_BOT_TOKEN=<точное значение из локального .env>
TELEGRAM_CHAT_ID=<точное значение из локального .env>
PUBLIC_SITE_URL=https://shashlik-like.layero.app
TELEGRAM_DISABLED=false
TELEGRAM_POLLING_ENABLED=true
CORS_ALLOWED_ORIGINS=https://shashlik-like.layero.app
```

Не добавляйте `VITE_API_URL`, `DATA_STORE_PATH`, `TELEGRAM_API_BASE_URL`, `LAYERO_DATABASE_URL`, `PORT` и `NODE_ENV` вручную. Последние две уже определены в `layero.json`; `LAYERO_DATABASE_URL` появится автоматически только после подключения базы.

Перед вставкой откройте Project → Domains/Environments и убедитесь, что production URL действительно равен `https://shashlik-like.layero.app`. Сейчас публичная проверка показывает, что адрес свободен, а не привязан к активному deploy.

## Действия в панели Layero

1. Откройте или создайте проект `shashlik-like` в Layero и подключите этот GitHub-репозиторий.
2. В Project → Domains/Environments закрепите свободный slug `shashlik-like` либо скопируйте точный URL, который показывает панель.
3. Если URL отличается, замените им `PUBLIC_SITE_URL` и `CORS_ALLOWED_ORIGINS` в готовом списке.
4. Откройте раздел переменных окружения текущего сервиса.
5. Добавьте восемь строк из готового списка выше. Для пароля, admin-secret и Telegram-токена включите режим защищённого значения, если он доступен.
6. Убедитесь, что `PUBLIC_SITE_URL` начинается именно с `https://`, без завершающего `/`.
7. Убедитесь, что у сервиса одна активная реплика с `TELEGRAM_POLLING_ENABLED=true`. На каждой дополнительной реплике polling должен быть `false`.
8. Запустите повторный deploy последнего коммита. Не используйте development-команду `npm run dev`.
9. В логах должны последовательно пройти `npm ci --include=dev`, `npm run build` из `start:layero` и запуск `server/server.js`.
10. После запуска откройте `<точный production URL>/health`. Ожидается HTTP 200 и `"status":"ok"`.
11. Проверьте `/`, `/menu`, `/admin`, вход владельца и тестовый заказ на отдельном тестовом окружении.

## Telegram

- Код использует официальный `https://api.telegram.org`.
- Токен и резервный chat id найдены в локальном `.env`; их значения намеренно не приведены в этом файле.
- Новый заказ, смена статуса, отмена, создание товара, изменение цены, главного фото, галереи и наличия покрыты интеграционным тестом с локальным Telegram mock API.
- Ошибка отправки повторяется до трёх раз. Не доставленные уведомления сохраняются в outbox постоянного хранилища.
- Реальную отправку сообщения в чат выполняйте только после проверки, что `TELEGRAM_CHAT_ID` относится к тестовому чату.
- Layero может останавливать неактивный serverless runtime. Для непрерывного long polling нужен режим без засыпания/always-on либо отдельный постоянно работающий worker. Иначе бот сможет получать обновления только пока runtime активен.

## Миграция постоянных данных

Production backend хранит состояние и новые загрузки в PostgreSQL. Файловое JSON-хранилище осталось только для локальной разработки и тестов. Пустая production-база не заполняется автоматически: это защищает от случайного запуска поверх утраченного подключения.

Перед переключением существующего сайта необходимо:

1. До deploy скачать backup текущего `store.json` и `public/uploads` из старого runtime.
2. Подключить Layero PostgreSQL и получить автоматически выданный `LAYERO_DATABASE_URL`.
3. Запустить `CONFIRM_PERSISTENT_IMPORT=YES LAYERO_DATABASE_URL="..." node scripts/import-store-to-postgres.js /absolute/store.json /absolute/uploads` из защищённой среды с доступом к базе.
4. Сверить напечатанные количества товаров, заказов, пользователей и изображений с backup.
5. Выполнить deploy без `ALLOW_EMPTY_DATABASE_INITIALIZATION`, проверить `/api/health` (`storage: postgres`) и данные в админке.
6. Настроить backup PostgreSQL и выполнить пробное восстановление на отдельной базе.

Локальный тест подтверждает сохранение данных после перезапуска только при использовании того же постоянного файла. Он не превращает эфемерный диск Layero в постоянное хранилище.

## Контрольная проверка после deploy

- `/` возвращает реальную HTML-страницу, не фиктивный health-ответ.
- `/health` и `/api/health` возвращают HTTP 200.
- `/menu`, `/cart`, `/checkout`, `/admin` открываются прямой ссылкой.
- JS, CSS, изображения, manifest и локальные шрифты возвращают HTTP 200.
- Вход владельца работает с новым `ADMIN_PASSWORD`.
- Заказ создаётся только на тестовых данных и открывается по выданному tracking token.
- Бот отвечает на `getMe`, а тестовый чат получает заказ и обновление статуса.
- После перезапуска и нового deploy данные проверяются повторно; только эта проверка подтверждает, что конкретное окружение Layero подключено к постоянной базе.

## Официальные материалы Layero

- `https://docs.layero.ru/deploys/layero-json/`
- `https://docs.layero.ru/runtime/overview/`
- `https://docs.layero.ru/runtime/lifecycle/`
- `https://docs.layero.ru/getting-started/frameworks/`
- `https://docs.layero.ru/getting-started/concepts/`
- `https://docs.layero.ru/database/`
- `https://docs.layero.ru/database/connect/`
