@echo off
title Upload ClearMind Pro to GitHub
color 0A
cd /d "%~dp0"

echo =====================================================================
echo               Uploading ClearMind Pro to GitHub...
echo =====================================================================
echo.
echo  [*] Repository: https://github.com/prakhardhakad1/clearmind-pro
echo  [*] Uploading files...
echo.
echo  [NOTE] If a GitHub login window pops up, click "Sign in with your browser"!
echo.

git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo =====================================================================
    echo  [SUCCESS] All files have been successfully uploaded to GitHub!
    echo  View your code at: https://github.com/prakhardhakad1/clearmind-pro
    echo =====================================================================
    echo.
) else (
    echo.
    echo [ERROR] Upload failed. Please make sure you are signed in to GitHub.
    echo.
)

pause
