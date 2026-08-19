# Шашлык Лайк

Коммерческий сайт ресторана на React 19, Vite 7 и Node.js HTTP API. Данные каталога, заказов, сотрудников, истории статусов и локальной аналитики хранятся в `server/data/store.json`.

## Локальный запуск

```bash
npm.cmd install
npm.cmd run dev
```

- Сайт: `http://localhost:5173`
- API: `http://localhost:4174`
- Админка: `http://localhost:5173/admin`

## Production

```bash
npm.cmd run lint
npm.cmd test
npm.cmd run build
set NODE_ENV=production
npm.cmd start
```

В production сервер раздаёт `dist`, API и SPA fallback на одном порту. Перед запуском настройте reverse proxy с HTTPS и постоянное резервное копирование `server/data/store.json`.

Полная пошаговая инструкция для первого запуска в Railway, подключения GitHub, Volume, Telegram, домена, HTTPS, аналитики и резервных копий находится в [DEPLOYMENT.md](./DEPLOYMENT.md).

Для схемы **Vercel frontend + Railway API** используйте отдельную инструкцию [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md). На Vercel требуется `VITE_API_URL`; секреты и JSON-база остаются только на backend-хостинге.

## Environment

| Переменная | Назначение |
| --- | --- |
| `PORT` | Порт Node-сервера |
| `ADMIN_PASSWORD` | Начальный пароль владельца; production требует минимум 12 символов |
| `ADMIN_TOKEN_SECRET` | Подпись admin-токенов; production требует минимум 32 случайных символа |
| `TELEGRAM_BOT_TOKEN` | Секрет Telegram-бота, только на сервере |
| `TELEGRAM_CHAT_ID` | Резервный чат для заказов |
| `PUBLIC_SITE_URL` | Канонический origin для sitemap, например `https://example.ru` |
| `DATA_STORE_PATH` | Необязательный путь к JSON-базе; полезен для изолированных тестов |
| `TELEGRAM_DISABLED` | Отключает Telegram для тестовой среды при значении `true` |

Реальные секреты не должны попадать в `.env.example`, Git или клиентский bundle. После утечки Telegram-токен нужно отозвать у BotFather и выпустить новый.

## Заказы и статус

Заказ получает случайный `trackingToken`. В браузере хранится только токен активного заказа, а актуальный статус всегда запрашивается с сервера. Tracking и виджет активного заказа обновляются polling-запросом; Supabase/Realtime в текущей архитектуре не используется.

Внутренние статусы: `new`, `accepted`, `preparing`, `ready`, `delivering`, `completed`, `cancelled`. Клиентский timeline объединяет `accepted` и `preparing`. Все изменения проходят единый серверный валидатор и записываются в `orderStatusHistory`.

## Адрес доставки

`server/address-service.js` содержит заменяемый provider layer. Текущий provider `local` нормализует адрес Воронежа, требует улицу и дом и возвращает отдельные `city`, `street`, `house`. Квартира, подъезд, этаж и домофон сохраняются отдельно.

Координаты и настоящие polygon-зоны пока не подключены. Для точного autocomplete/geocoding замените provider на DaData или Яндекс, храните секретный ключ на сервере и добавьте проверку координат по зонам.

## Аналитика

Админка → **Аналитика** показывает:

- количество сессий и событий;
- воронку от просмотра сайта до заказа;
- ошибки checkout;
- заказы и выручку по `utm_source`, referral и direct.

События хранятся в `analyticsEvents`, ограничены последними 10 000 записями и не содержат имя, телефон, адрес или tracking-токен. UTM и первый referrer сохраняются на сессию и прикрепляются к заказу.

## Управление сайтом

- **Товары**: карточки, цены, фото URL, категории, дополнения и стоп-лист.
- **Заказы**: состав, Telegram-доставка и допустимые следующие статусы.
- **Люди**: сотрудники, роли, смены, точки и Telegram-привязка.
- **Точки**: адреса, комментарии, телефоны и часы самовывоза.
- **Профиль**: собственные имя, фамилия, телефон и фото.
- **Настройки**: контакты, часы, доставка и ссылки агрегаторов.
- **Аналитика**: трафик, воронка, источники, заказы и выручка.

Категории пока редактируются через JSON-хранилище; отдельный CRUD-интерфейс категорий остаётся задачей следующего этапа.

## SEO

Настроены route-specific title/description/canonical, OpenGraph, Twitter Card, Restaurant JSON-LD, `robots.txt` и динамический `/sitemap.xml`. Маршруты `/admin`, `/order/*`, `/checkout` и `/cart` получают `noindex` и server-side `X-Robots-Tag`.
