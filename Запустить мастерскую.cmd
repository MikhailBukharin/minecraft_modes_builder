@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Нужен Python 3.10 или новее: https://www.python.org/downloads/
  pause
  exit /b 1
)
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8766/api/projects' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { Start-Process 'http://127.0.0.1:8766'; exit 0 } } catch {}; exit 1"
if not errorlevel 1 exit /b 0
python app\server.py --port 8766
if errorlevel 1 pause
