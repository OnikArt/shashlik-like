# Production checklist

- [PASS] API использует серверную валидацию ассортимента, дополнений и стоимости заказа.
- [PASS] OWNER защищён от удаления, отключения и понижения на backend.
- [PASS] Telegram сотрудника привязывается одноразовым кодом, не только username.
- [PASS] Отзыв доступен только после статуса `completed` и сохраняется на сервере.
- [PASS] Public API, SPA fallback, CORS allowlist, rate limits и health endpoint реализованы.
- [PASS] Клиент не отправляет cross-site cookies; нет frontend Telegram secrets.
- [PASS] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` должны быть запущены перед deploy.
- [MANUAL CHECK] В production заданы `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET`, Telegram variables, `PUBLIC_SITE_URL`, `DATA_STORE_PATH` и CORS origins.
- [MANUAL CHECK] Проверены оба телефона: `+7 (909) 211-82-11`, `+7 (995) 669-12-42` во всех данных администратора.
- [MANUAL CHECK] Проверены Telegram Bot API, права бота в чате и тестовое уведомление заказа.
- [MANUAL CHECK] Проверены 320/390px, tablet, 1366px и 1920px в браузере после deploy.
- [MANUAL CHECK] Выполнены TLS/HTTPS, firewall, systemd restart, backup и restore по `DEPLOY_TIMEWEB.md`.
