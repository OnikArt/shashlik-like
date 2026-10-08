# Развёртывание на Timeweb Cloud VPS

Ниже — простая схема для одного VPS: Nginx → Node.js приложение → постоянный JSON-store. Подходит текущей архитектуре без Docker и без нескольких реплик.

## 1. Сервер и доступ

Создайте VPS с Ubuntu 24.04 LTS, минимум 2 vCPU / 2 GB RAM. В панели Timeweb добавьте SSH-ключ. На сервере:

```bash
adduser shashlik
usermod -aG sudo shashlik
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

В DNS добавьте A-запись домена на IP VPS и дождитесь её распространения.

## 2. Runtime и код

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx git certbot python3-certbot-nginx
sudo mkdir -p /srv/shashlik-like
sudo chown shashlik:shashlik /srv/shashlik-like
sudo -u shashlik git clone <YOUR_GIT_REPOSITORY_URL> /srv/shashlik-like/app
cd /srv/shashlik-like/app && sudo -u shashlik npm ci && sudo -u shashlik npm run build
```

Создайте `/srv/shashlik-like/app/.env`, владельцем которого является `shashlik`, с правами `600`. Используйте имена из `.env.example`; для production обязательны `NODE_ENV=production`, `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET` (32+ случайных символа), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `PUBLIC_SITE_URL`, `DATA_STORE_PATH=/srv/shashlik-like/data/store.json`, `CORS_ALLOWED_ORIGINS` и `TELEGRAM_DISABLED=false`. Не добавляйте этот файл в Git.

```bash
mkdir -p /srv/shashlik-like/data
chown -R shashlik:shashlik /srv/shashlik-like
chmod 700 /srv/shashlik-like/data
chmod 600 /srv/shashlik-like/app/.env
```

## 3. systemd

Создайте `/etc/systemd/system/shashlik-like.service`:

```ini
[Unit]
Description=Shashlik Like web application
After=network.target
[Service]
Type=simple
User=shashlik
WorkingDirectory=/srv/shashlik-like/app
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shashlik-like
curl http://127.0.0.1:4174/api/health
```

`PORT` не фиксируйте в unit: приложение читает его из окружения; если не задан, использует `4174` для Nginx ниже.

## 4. Nginx и HTTPS

Создайте `/etc/nginx/sites-available/shashlik-like`:

```nginx
server {
  listen 80;
  server_name example.ru www.example.ru;
  client_max_body_size 2m;
  location / { proxy_pass http://127.0.0.1:4174; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/shashlik-like /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d example.ru -d www.example.ru --redirect
```

## 5. Проверка, обновление и rollback

После запуска проверьте `/api/health`, создание тестового заказа, уведомление Telegram, вход OWNER и изменение статуса. Логи: `sudo journalctl -u shashlik-like -f`; Nginx: `/var/log/nginx/access.log` и `error.log`.

Для обновления сделайте backup, затем `git fetch --all`, переключите на проверенный commit, `npm ci`, `npm run build`, `sudo systemctl restart shashlik-like`. При проблеме вернитесь на предыдущий commit, соберите и перезапустите. Не используйте несколько экземпляров сервиса: JSON-store и Telegram polling рассчитаны на один процесс.

Ежедневно копируйте `/srv/shashlik-like/data/store.json` вне VPS (например, через `rsync`/S3) и периодически проверяйте восстановление. Перед изменением меню сделайте ручную копию файла.
