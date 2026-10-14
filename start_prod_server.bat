@echo off
REM ============================================================
REM  MenteeBOM production server launcher (port 80)
REM  Started automatically at boot by the "MenteeBOM Prod Server"
REM  scheduled task. Runs the prod DB (instance/menteebom.db).
REM  See AUTOSTART.md for setup and management.
REM ============================================================

set "APPDIR=c:\Users\mechanical\Documents\MenteeBOM software\MenteeBOM-Web"
cd /d "%APPDIR%"

if not exist "%APPDIR%\logs" mkdir "%APPDIR%\logs"

REM Force UTF-8 output: run.py prints emoji, which crash python with
REM UnicodeEncodeError under cp1252 when stdout is redirected to a file.
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo. >> "%APPDIR%\logs\prod_server.log"
echo ==================== boot start %DATE% %TIME% ==================== >> "%APPDIR%\logs\prod_server.log"

REM Explicit --port 80 so a port conflict fails loudly in the log
REM instead of silently falling back to port 5000.
".venv\Scripts\python.exe" run.py --port 80 >> "%APPDIR%\logs\prod_server.log" 2>&1
