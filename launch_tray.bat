@echo off
REM Relaunches the MenteeBOM tray icon (e.g. after clicking "Exit tray").
REM Safe to run twice - the tray is single-instance.
schtasks /run /tn "MenteeBOM Tray" >nul 2>&1
if errorlevel 1 (
    REM Task not registered yet - launch the tray directly, hidden.
    wscript.exe "%~dp0run_hidden.vbs" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tray_menteebom.ps1"
)
