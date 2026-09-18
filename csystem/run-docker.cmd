@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env" (
  echo [ERROR] ไม่พบไฟล์ .env
  echo.
  echo สร้างก่อน:
  echo   copy .env.example .env
  echo แล้วใส่ DB_PASS / รหัสอื่นๆ ใน .env
  echo.
  pause
  exit /b 1
)

echo เริ่ม CS System ด้วย docker compose...
echo เปิดเบราว์เซอร์ที่ http://localhost:3001
echo กด Ctrl+C เพื่อหยุด
echo.
docker compose up --build
