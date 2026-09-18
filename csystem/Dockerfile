# CSystem — production image for Coolify / Docker
# พอร์ตเดียว (PORT=3000): เสิร์ฟทั้งหน้าเว็บ + /api/*
#
# โหมดง่าย: ตอน build จะใส่ไฟล์ .env เข้า image (ต้องมี .env ในโฟลเดอร์นี้)
# ระวัง: ใครดึง image ไปได้จะอ่านรหัสใน image ได้ — ใช้ registry ส่วนตัวเท่านั้น
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DOCKER=1 \
    NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SERVE_FRONTEND=1 \
    FRONTEND_ROOT=/app/frontend \
    COOKIE_SECURE=1 \
    PREFER_DOTENV=1

WORKDIR /app

# unixODBC + Microsoft ODBC Driver 18 (required by node-odbc → SQL Server)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg apt-transport-https \
      unixodbc unixodbc-dev \
      build-essential python3 \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
      > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm --prefix backend install --omit=dev \
    && npm cache clean --force

COPY backend ./backend
COPY frontend ./frontend
COPY docker-entrypoint.sh ./
# bake รหัสจากเครื่องที่ build (ต้องมีไฟล์ .env)
COPY .env /app/.env
RUN cp /app/.env /app/backend/.env \
    && sed -i 's/\r$//' /app/.env /app/backend/.env /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/backend/uploads \
    && chown -R node:node /app

# entrypoint รันเป็น root เพื่อ chown volume แล้วค่อยสลับเป็น node
USER root

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
