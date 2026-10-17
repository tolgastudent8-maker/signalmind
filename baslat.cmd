@echo off
REM SignalMind AI - tek tikla baslatma (demo / production modu)
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. https://nodejs.org adresinden Node 22.5+ kurun.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Paketler kuruluyor...
  call npm install --no-fund --no-audit || goto :fail
)

if not exist .env.local (
  echo .env.local bulunamadi. .env.example kopyalaniyor; API anahtarinizi yazin ve tekrar calistirin.
  copy .env.example .env.local >nul
  notepad .env.local
  exit /b 1
)

echo Uygulama derleniyor (bir dakika surebilir)...
call npm run build || goto :fail

echo.
echo SignalMind AI baslatiliyor: http://localhost:3000
start "" http://localhost:3000
call npm start
exit /b 0

:fail
echo Bir hata olustu. Yukaridaki mesaji kontrol edin.
pause
exit /b 1
