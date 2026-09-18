#!/bin/sh
set -eu

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
export DOCKER="${DOCKER:-1}"
export ODBC_DRIVER="${ODBC_DRIVER:-ODBC Driver 18 for SQL Server}"
export FRONTEND_ROOT="${FRONTEND_ROOT:-/app/frontend}"
export SERVE_FRONTEND="${SERVE_FRONTEND:-1}"
export PREFER_DOTENV="${PREFER_DOTENV:-1}"
export UPLOAD_ROOT="${UPLOAD_ROOT:-/app/backend/uploads}"

# โหลด /app/.env เข้า environment (รองรับรหัสที่มี $) — ทับค่าจาก Kube ถ้า PREFER_DOTENV=1
if [ -f /app/.env ]; then
  echo "[entrypoint] loading baked /app/.env"
  eval "$(node -e '
const fs = require("fs");
const prefer = process.env.PREFER_DOTENV === "1";
for (const line of fs.readFileSync("/app/.env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 1) continue;
  const k = t.slice(0, i).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'\''") && v.endsWith("'\''"))) v = v.slice(1, -1);
  if (!prefer && process.env[k] !== undefined) continue;
  process.stdout.write("export " + k + "=" + JSON.stringify(v) + "\n");
}
')"
fi

# เตรียมโฟลเดอร์รูปให้เขียนได้ (volume ต้อง mount มาที่นี่ตอน deploy)
UPLOAD_DIR="${UPLOAD_ROOT:-/app/backend/uploads}"
mkdir -p "$UPLOAD_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$UPLOAD_DIR" 2>/dev/null || true
  chmod -R u+rwX "$UPLOAD_DIR" 2>/dev/null || true
fi

# ทดสอบเขียนไฟล์ (ล้มเหลวชัดๆ ถ้าวอลุ่มเป็น read-only)
if touch "$UPLOAD_DIR/.write-test" 2>/dev/null; then
  rm -f "$UPLOAD_DIR/.write-test"
  echo "[entrypoint] uploads OK (writable): $UPLOAD_DIR"
else
  echo "[entrypoint] WARNING: uploads NOT writable: $UPLOAD_DIR"
  echo "[entrypoint] → ตั้ง Persistent Storage / volume ไปที่ $UPLOAD_DIR"
fi

echo "[entrypoint] HOST=${HOST} PORT=${PORT} (UI+API combined)"
echo "[entrypoint] ODBC_DRIVER=${ODBC_DRIVER}"
echo "[entrypoint] UPLOAD_ROOT=${UPLOAD_DIR}"
echo "[entrypoint] DB_HOST=${DB_HOST:-unset} DB_NAME=${DB_NAME:-unset} DB_USER=${DB_USER:-unset}"
if [ -n "${DB_PASS:-}" ]; then
  echo "[entrypoint] DB_PASS=set (length=${#DB_PASS})"
else
  echo "[entrypoint] DB_PASS=MISSING"
fi

# รันแอปด้วย user node ถ้า entrypoint ถูกเรียกเป็น root
if [ "$(id -u)" = "0" ]; then
  exec runuser -u node -- node /app/backend/server.js
fi
exec node /app/backend/server.js
