# Публикация «Шашлык Лайк»

Эта инструкция рассчитана на первый production-запуск. Основной вариант — один постоянный Node.js-сервис в Railway с подключённым Volume. Такой вариант подходит текущей архитектуре лучше Vercel: сервер одновременно раздаёт React/Vite-сборку, обслуживает API, хранит JSON-базу и постоянно опрашивает Telegram.

## Что используется в проекте

| Часть | Реализация |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 7 |
| Backend | Node.js HTTP server, `server/server.js` |
| База | `server/data/store.json`, без Supabase/PostgreSQL |
| Файлы | Статические изображения в `public`; аватары и данные — в JSON |
| Telegram | Long polling внутри Node-процесса, webhook не используется |
| Адреса | Локальный provider для Воронежа, внешнего API-ключа нет |
| Аналитика | Собственные события в JSON и вкладка «Аналитика» в админке |
| Production | `npm run build`, затем `npm start` |
| Health check | `GET /api/health` |

Supabase, migrations, RLS и Realtime в текущем проекте отсутствуют. Их не нужно создавать для первого запуска.

## До публикации

1. Отзовите ранее использовавшийся Telegram-токен у BotFather и выпустите новый. Не вставляйте старый токен в GitHub или сообщения.
2. Придумайте отдельный production-пароль владельца длиной минимум 12 символов.
3. Создайте случайный `ADMIN_TOKEN_SECRET` длиной не менее 32 символов. В PowerShell можно выполнить:

   ```powershell
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
   ```

4. Убедитесь, что `.env`, `.env.local`, `server/data/store.json`, `node_modules` и `dist` не попали в Git.
5. Сохраните отдельную копию текущего `server/data/store.json`, если в локальной базе уже есть нужные товары и сотрудники.

## Шаг 1. GitHub

1. Зарегистрируйтесь на [GitHub](https://github.com/).
2. Создайте пустой приватный репозиторий. Не добавляйте на сайте GitHub README, `.gitignore` или License.
3. В папке проекта выполните:

   ```powershell
   git init -b main
   git add .
   git status
   git commit -m "Prepare Shashlik Like for production"
   git remote add origin https://github.com/ВАШ-ЛОГИН/НАЗВАНИЕ-РЕПОЗИТОРИЯ.git
   git push -u origin main
   ```

4. Перед `git commit` внимательно посмотрите `git status`: `.env` и `server/data/store.json` там быть не должны.

Официальная справка: [добавление локального проекта в GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).

## Шаг 2. Railway

1. Зарегистрируйтесь на [Railway](https://railway.com/) через GitHub.
2. Нажмите **New Project** → **Deploy from GitHub Repo**.
3. Выберите созданный репозиторий.
4. Railway прочитает `railway.json`, выполнит `npm run build`, затем `npm start` и проверит `/api/health`.
5. Оставьте **одну реплику**. Несколько реплик нельзя использовать с этой JSON-базой и Telegram polling.

Railway подходит здесь как постоянный сервис. Vercel не является основным вариантом: serverless-функции не должны держать бесконечный Telegram polling, а локальная файловая система не подходит для постоянной JSON-базы.

## Шаг 3. Environment variables

Откройте сервис → **Variables** и добавьте:

```text
NODE_ENV=production
ADMIN_PASSWORD=<новый длинный пароль>
ADMIN_TOKEN_SECRET=<случайная строка 32+ символа>
TELEGRAM_BOT_TOKEN=<новый токен BotFather>
TELEGRAM_CHAT_ID=<резервный chat id владельца>
PUBLIC_SITE_URL=https://shashlik-like.ru
DATA_STORE_PATH=/data/store.json
TELEGRAM_DISABLED=false
```

`PORT` в Railway вручную не задавайте: платформа передаст его процессу сама. Секреты вводятся только в Variables, не в `.env.example` и не в frontend-переменные.

После изменения Variables нажмите **Deploy** для применения.

## Шаг 4. Постоянная база

1. На карточке сервиса создайте **Volume**.
2. Подключите его к тому же сервису.
3. Укажите mount path `/data`.
4. Проверьте, что `DATA_STORE_PATH=/data/store.json`.
5. Не запускайте несколько реплик сервиса: два процесса могут одновременно изменять один JSON-файл и дважды опрашивать Telegram.

Если нужно перенести существующую локальную базу, сначала сделайте её резервную копию, затем загрузите файл как `/data/store.json` через Railway CLI/Volume browser. Не заменяйте production-файл во время приёма заказов.

Railway Volume сохраняет файл между перезапусками и деплоями. Без Volume данные исчезнут после пересоздания контейнера. Справка: [Railway Volumes](https://docs.railway.com/volumes).

## Шаг 5. Первый запуск

1. Откройте **Deployments** и дождитесь статуса **Active**.
2. В **Settings** → **Networking** нажмите **Generate Domain**.
3. Откройте выданный адрес `https://....up.railway.app`.
4. Проверьте `https://....up.railway.app/api/health`: ожидается JSON со `status: ok`.
5. Откройте `/admin` и войдите новым production-паролем.
6. Сразу измените профиль владельца и проверьте список сотрудников.

Если старт не проходит, смотрите **Deployments** → нужный deployment → **View Logs**. Чаще всего причина — короткий пароль, короткий `ADMIN_TOKEN_SECRET`, неверный `DATA_STORE_PATH` или отсутствующий Volume.

## Шаг 6. Telegram

Интеграция работает через long polling, поэтому webhook и публичный Telegram endpoint не нужны.

1. Получите новый токен у BotFather и сохраните его в `TELEGRAM_BOT_TOKEN`.
2. Напишите боту с аккаунта владельца или сотрудника.
3. Бот выдаст одноразовый код на 30 минут.
4. В админке откройте **Люди**, выберите сотрудника и вставьте код подключения.
5. Сотрудник должен получить приветственное сообщение.
6. Создайте тестовый заказ и проверьте уведомление, состав заказа и кнопки статусов.
7. Убедитесь, что сервис запущен в одном экземпляре. Иначе Telegram будет возвращать конфликт polling.

`TELEGRAM_CHAT_ID` — резервный получатель. Основные получатели подключаются через коды во вкладке «Люди».

## Шаг 7. Домен и WWW

Рекомендуемый canonical-вариант: `https://shashlik-like.ru` без `www`. Он короче и уже используется в SEO-конфигурации.

1. Купите домен у любого регистратора.
2. В Railway откройте сервис → **Settings** → **Public Networking** → **Custom Domain**.
3. Добавьте `shashlik-like.ru`.
4. Railway покажет точные DNS-записи. Создайте у регистратора показанные `CNAME` и `TXT` без изменений.
5. Добавьте вторым доменом `www.shashlik-like.ru` и внесите показанные для него DNS-записи.
6. Приложение перенаправляет `www` на canonical-домен ответом 308, когда `PUBLIC_SITE_URL=https://shashlik-like.ru`.
7. DNS может обновляться до 72 часов. Проверять можно командами `nslookup shashlik-like.ru` и `nslookup www.shashlik-like.ru`.

Railway автоматически выпускает и обновляет сертификат Let's Encrypt после подтверждения домена. Используйте только URL с `https://`. Справка: [Custom domains и SSL](https://docs.railway.com/networking/domains/working-with-domains).

Если итоговый домен будет другим, замените его в `PUBLIC_SITE_URL`, `index.html` (`canonical` и `og:url`) и `public/robots.txt` (`Sitemap`).

## Шаг 8. SEO

После подключения домена проверьте:

```text
https://shashlik-like.ru/
https://shashlik-like.ru/robots.txt
https://shashlik-like.ru/sitemap.xml
https://shashlik-like.ru/site.webmanifest
```

В проекте настроены title, description, canonical, OpenGraph, Twitter Card, favicon, manifest, Restaurant JSON-LD, robots и sitemap. `/admin`, `/order/*`, `/checkout` и `/cart` получают `noindex` в HTML и `X-Robots-Tag` от сервера.

После запуска добавьте домен в Яндекс Вебмастер и Google Search Console, подтвердите владение и отправьте `/sitemap.xml`.

## Шаг 9. Аналитика

Существующая статистика находится в **Админка** → **Аналитика**:

- «Сессии» — приблизительное число визитов;
- воронка — просмотр сайта → меню → корзина → checkout → заказ;
- «Источники» — `utm_source`, referral или direct;
- заказы и выручка — dashboard и таблица заказов;
- ошибки оформления — показатель checkout errors.

Для рекламных кампаний используйте ссылки вида:

```text
https://shashlik-like.ru/?utm_source=vk&utm_medium=social&utm_campaign=summer
```

Внешняя веб-аналитика пока не подключена. Если понадобятся карты кликов, аудитории и рекламные кабинеты, следующим отдельным этапом можно добавить Яндекс Метрику с уведомлением о cookies/политикой конфиденциальности.

## Шаг 10. Логи и ошибки

| Проблема | Где смотреть |
| --- | --- |
| Frontend | DevTools браузера → Console и Network |
| Сервер/API | Railway → Service → Deployments/Logs |
| Telegram | Те же server logs, строки `Telegram ... failed` |
| JSON-база | server logs: ошибки чтения/записи и `/api/health` |
| Сборка | Railway → конкретный deployment → Build Logs |
| Ресурсы | Railway → Metrics: CPU, RAM, диск, рестарты |

При аварии сначала проверьте `/api/health`, затем Variables, Volume, последние server logs и только после этого делайте Redeploy.

## Резервные копии

1. В Railway откройте сервис → **Backups**.
2. Включите Daily, Weekly и Monthly для Volume.
3. Перед массовым импортом товаров или сотрудников создавайте manual backup.
4. Раз в месяц скачивайте отдельную копию `store.json` вне Railway.
5. Периодически проверяйте восстановление в отдельном тестовом окружении, не поверх работающего production.

Railway поддерживает ручные и автоматические резервные копии Volume и восстановление из выбранной даты: [Railway Volume Backups](https://docs.railway.com/volumes/backups).

## Production checklist владельца

- [ ] Новый Telegram-токен выпущен, старый отозван.
- [ ] GitHub-репозиторий не содержит `.env` и `server/data/store.json`.
- [ ] `npm run lint`, `npm test` и `npm run build` проходят.
- [ ] Railway deployment имеет статус Active.
- [ ] Подключён Volume `/data`.
- [ ] В Variables задан `DATA_STORE_PATH=/data/store.json`.
- [ ] Используется одна реплика.
- [ ] `/api/health` отвечает `status: ok`.
- [ ] Владелец входит в `/admin` production-паролем.
- [ ] Нельзя удалить или разжаловать последнего владельца.
- [ ] Товары, цены, дополнения и стоп-лист проверены.
- [ ] Светлая, тёмная и автоматическая темы проверены.
- [ ] Главная, меню, корзина, checkout, доставка и самовывоз проверены на телефоне и компьютере.
- [ ] Валидация российского телефона и адреса работает.
- [ ] Сотрудники, роли, смены и точки заполнены.
- [ ] Telegram-коды сотрудников подключаются.
- [ ] Тестовый production-заказ пришёл всем нужным получателям.
- [ ] Статус заказа меняется из Telegram и админки.
- [ ] Страница отслеживания показывает актуальный статус.
- [ ] Аналитика фиксирует визит, корзину, checkout и заказ.
- [ ] Домен открывается по HTTPS.
- [ ] `www` перенаправляется на домен без `www`.
- [ ] `robots.txt` и `sitemap.xml` открываются.
- [ ] `/admin` и `/order/*` имеют `noindex`.
- [ ] Включены Daily, Weekly и Monthly backups.

## Обновления после запуска

После изменений локально выполните:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
git add .
git commit -m "Describe the update"
git push
```

Railway автоматически соберёт новый deployment из GitHub. Перед крупным обновлением создайте manual backup Volume.
