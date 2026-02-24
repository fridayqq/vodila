# Руководство по деплою

## Подготовка

### 1. Настройка переменных окружения

```bash
cp .env.example .env
```

Отредактируйте `.env` и укажите:
- `TELEGRAM_BOT_TOKEN` - токен вашего Telegram бота
- Другие переменные при необходимости

### 2. Проверка локально

```bash
# Сборка и запуск
docker compose up -d

# Проверка работы
curl http://localhost:8000/api/stats

# Просмотр логов
docker compose logs -f
```

## Деплой на сервер

### Требования
- Docker и Docker Compose
- Домен с SSL сертификатом (рекомендуется)
- Открытый порт 8000 (или используйте reverse proxy)

### Вариант 1: Прямой деплой на VPS

```bash
# 1. Скопируйте файлы на сервер
scp -r . user@server:/opt/vodila

# 2. Подключитесь к серверу
ssh user@server

# 3. Перейдите в директорию
cd /opt/vodila

# 4. Запустите контейнер
docker compose -f docker-compose.prod.yml up -d

# 5. Проверьте статус
docker compose ps
```

### Вариант 2: С использованием Nginx reverse proxy

Создайте конфиг Nginx `/etc/nginx/sites-available/vodila`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
# Включите сайт
ln -s /etc/nginx/sites-available/vodila /etc/nginx/sites-enabled/

# Проверьте конфиг
nginx -t

# Перезагрузите Nginx
systemctl restart nginx
```

### Вариант 3: Docker Swarm

```bash
# Инициализируйте Swarm
docker swarm init

# Создайте стек
docker stack deploy -c docker-compose.prod.yml vodila

# Проверьте статус
docker stack ps vodila
```

### Вариант 4: Kubernetes

Создайте `k8s/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vodila-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: vodila
  template:
    metadata:
      labels:
        app: vodila
    spec:
      containers:
      - name: app
        image: vodila-app:latest
        ports:
        - containerPort: 8000
        volumeMounts:
        - name: data
          mountPath: /app/data
        env:
        - name: DATABASE_PATH
          value: /app/data/rules.db
        livenessProbe:
          httpGet:
            path: /api/stats
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: vodila-data-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: vodila-service
spec:
  selector:
    app: vodila
  ports:
  - port: 80
    targetPort: 8000
  type: LoadBalancer
```

## Telegram Bot настройка

### 1. Создание бота

1. Откройте @BotFather в Telegram
2. Отправьте `/newbot`
3. Следуйте инструкциям
4. Сохраните полученный токен

### 2. Создание Mini App

1. В @BotFather отправьте `/newapp`
2. Выберите бота
3. Укажите название и описание
4. Укажите URL: `https://your-domain.com`
5. Укажите short name

### 3. Настройка Webhook (опционально)

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-domain.com/api/telegram/webhook"
```

## Мониторинг

### Логи

```bash
# Просмотр логов
docker compose logs -f

# Логи за последние 100 строк
docker compose logs --tail=100
```

### Статистика

```bash
# Использование ресурсов
docker stats vodila-app-1

# Проверка здоровья
curl http://localhost:8000/api/stats
```

## Обновление

```bash
# Остановите текущий контейнер
docker compose down

# Пересоберите образ
docker compose build --no-cache

# Запустите новую версию
docker compose up -d

# Очистите старые образы
docker image prune -f
```

## Backup базы данных

```bash
# Копирование базы данных
docker cp vodila-app-1:/app/data/rules.db ./backup/rules.db

# Восстановление
docker cp ./backup/rules.db vodila-app-1:/app/data/rules.db
```

## Troubleshooting

### Контейнер не запускается

```bash
# Проверьте логи
docker compose logs

# Проверьте переменные окружения
docker compose config
```

### Ошибки базы данных

```bash
# Удалите том с данными (осторожно!)
docker volume rm vodila_app_data

# Перезапустите
docker compose up -d
```

### Проблемы с портами

```bash
# Проверьте занятые порты
netstat -tlnp | grep 8000

# Измените порт в docker-compose.yml
ports:
  - "8080:8000"
```
