# Vercel: frontend «Шашлык Лайк»

## Важная архитектура

Vercel публикует только React/Vite frontend. Рабочий сайт также требует постоянно запущенный Node API из `server/server.js`, JSON-базу на постоянном диске и Telegram long polling. Этот backend нужно оставить на Railway или другом постоянном Node-хостинге.

```text
Браузер → Vercel frontend → HTTPS → Railway Node API → Volume / Telegram
```

Размещать текущий `server/server.js` как Vercel Function нельзя без переписывания хранения и Telegram: serverless-функция не держит бесконечный polling, а её файловая система не является постоянной базой.

## Переменная Vercel

На Vercel нужна ровно одна пользовательская переменная:

```env
VITE_API_URL=https://ВАШ-API-ДОМЕН.up.railway.app
```

- Это публичный origin backend без `/api` и без завершающего `/`.
- Значение берётся в Railway: backend service → **Settings** → **Networking** → **Public Domain**.
- URL обязан начинаться с `https://`, иначе браузер заблокирует запросы как Mixed Content.
- Переменная не секретная: любое `VITE_*` значение попадает в browser bundle.
- Добавьте её в **Production** и **Preview**. Для **Development** она не нужна: локально Vite проксирует `/api` на `http://localhost:4174`.
- После изменения env обязательно создайте новый deployment: старые сборки значение не получают.

Backend-секреты `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` и `DATA_STORE_PATH` в Vercel добавлять нельзя. Они остаются только в Railway Variables.

## CORS на backend

В Railway добавьте или обновите:

```env
CORS_ALLOWED_ORIGINS=https://shashlik-like.ru,https://www.shashlik-like.ru,https://ИМЯ-ПРОЕКТА.vercel.app,https://ИМЯ-ПРОЕКТА-*.vercel.app
PUBLIC_SITE_URL=https://shashlik-like.ru
```

Значения перечисляются через запятую. Для первого теста достаточно точного production URL Vercel. Шаблон с `*` нужен для Preview deployments и должен соответствовать только вашему проекту, а не всем доменам `*.vercel.app`.

После изменения Railway Variables примените новый deployment/restart backend.

## Настройки проекта Vercel

Файл `vercel.json` уже задаёт нужные значения:

```text
Framework Preset: Vite
Root Directory: ./
Install Command: npm install
Build Command: npm run build
Output Directory: dist
Node.js: 20.x, 22.x или 24.x
```

Также настроены SPA rewrite на `index.html`, security headers и `X-Robots-Tag` для `/admin`, `/order/*`, `/checkout`, `/cart`.

## Первый deploy

1. Сначала опубликуйте backend по инструкции `DEPLOYMENT.md` и проверьте `https://API-ДОМЕН/api/health`.
2. Закоммитьте `vercel.json`, `src/api.ts` и остальные изменения, затем отправьте их в GitHub.
3. Откройте [Vercel](https://vercel.com/) → **Add New** → **Project**.
4. Импортируйте GitHub-репозиторий проекта.
5. Проверьте настройки из предыдущего раздела.
6. Откройте **Environment Variables** и добавьте `VITE_API_URL` для Production и Preview.
7. Нажмите **Deploy**.
8. После получения URL Vercel добавьте этот origin в `CORS_ALLOWED_ORIGINS` на Railway и перезапустите backend.
9. В Vercel откройте **Deployments** → последний deployment → **Redeploy**, если `VITE_API_URL` был добавлен после первой сборки.

Для уже подключённого проекта достаточно push нового commit. Vercel автоматически создаст deployment.

## Проверка после deploy

1. Откройте `/` и убедитесь, что меню загрузилось без экрана ошибки.
2. Перейдите кнопками на `/menu`, `/delivery`, `/pickup`, `/about`, `/contacts`.
3. Для каждого маршрута сделайте refresh и откройте его в новой вкладке: Vercel не должен отвечать 404.
4. Добавьте товар, обновите страницу и проверьте сохранение корзины.
5. Измените количество, удалите товар, снова добавьте его.
6. Пройдите `/checkout`, проверьте адрес и российскую маску телефона.
7. Создайте тестовый заказ, откройте tracking URL и обновите его.
8. Войдите в `/admin`, откройте dashboard, orders, products, people и settings.
9. Проверьте светлую и тёмную тему на desktop и mobile.
10. Откройте `/robots.txt`, `/sitemap.xml`, `/site.webmanifest`.
11. В DevTools → **Console** не должно быть runtime, CORS и Mixed Content errors.
12. В DevTools → **Network** запрос `/api/bootstrap` должен уходить на Railway URL и возвращать JSON со статусом 200.

## Если сайт всё ещё не работает

### Vercel

Откройте **Project → Deployments → deployment → Build Logs**:

- проверьте, что использован новый commit;
- найдите строку `VITE_API_URL` в Settings, не печатая секреты;
- проверьте Output Directory `dist`;
- после изменения env обязательно сделайте Redeploy.

### Browser DevTools

В **Console** ищите:

- `Failed to fetch` — API недоступен или неверный URL;
- `blocked by CORS policy` — frontend origin не добавлен в Railway `CORS_ALLOWED_ORIGINS`;
- `Mixed Content` — в `VITE_API_URL` указан `http://`;
- `Unexpected token '<'` — вместо API JSON пришёл `index.html`, обычно env отсутствует или URL неверный.

В **Network** выберите `bootstrap`:

- Request URL должен быть Railway HTTPS URL;
- 200 + `application/json` — нормально;
- 404 — неверный backend URL;
- 403 на OPTIONS — origin не разрешён CORS;
- 502/503 — backend не запущен;
- `(blocked:cors)` — исправить allowlist на backend.

### Railway

Откройте backend service → **Deployments → View Logs**. Проверьте запуск Node, Volume, production secrets и Telegram. Отдельно откройте `/api/health`; ответ должен содержать `"status":"ok"`.
