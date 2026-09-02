@echo off
title ClearMind Pro - AI Tutor & Live Knowledge Canvas
color 0B
cd /d "%~dp0"

echo =====================================================================
echo           ClearMind Pro - Multi-Modal AI Educational Ecosystem
echo =====================================================================
echo.
echo  [*] Starting ClearMind Pro on http://127.0.0.1:8000 ...
echo  [*] Automatically opening your default web browser...
echo.
echo  [NOTE] Keep this command window open while using ClearMind Pro.
echo         To stop the server, press Ctrl + C or close this window.
echo.
echo =====================================================================
echo.

:: Automatically open browser after 2 seconds
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8000'"

:: Start Uvicorn FastAPI Server (0.0.0.0 allows mobile & local network access)
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] ClearMind Pro failed to start.
    echo Please make sure Python and the required packages are installed.
    echo.
    pause
)
