# CSystem — production image for Coolify / Docker
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DOCKER=1 \
    NODE_ENV=production \
    APP_PORT=3220 \
    PORT=3000 \
    FRONTEND_PORT=3000 \
    API_ORIGIN=http://127.0.0.1:3220 \
    ODBC_DRIVER=ODBC Driver 18 for SQL Server \
    COOKIE_SECURE=1

WORKDIR /app

# unixODBC + Microsoft ODBC Driver 18 (required by node-odbc → SQL Server)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg apt-transport-https \
      unixodbc unixodbc-dev \
      build-essential python3 \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
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
COPY start.js ./

RUN mkdir -p /app/backend/uploads \
    && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["node", "start.js"]
