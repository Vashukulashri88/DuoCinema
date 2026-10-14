@echo off
title DuoCinema - Cloudflare Remote Tunnel
echo =========================================================
echo    DuoCinema - Free Remote Tunnel for Long-Distance
echo =========================================================
echo.
echo This script creates a free, instant HTTPS link so your
echo girlfriend can join from anywhere in the world without
echo any router setup or port forwarding!
echo.

if not exist "cloudflared.exe" (
    echo [*] Downloading free Cloudflare Tunnel helper (cloudflared.exe)...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
    if errorlevel 1 (
        echo [!] Could not download cloudflared.exe automatically.
        echo Please download it manually from https://github.com/cloudflare/cloudflared/releases
        pause
        exit /b 1
    )
    echo [*] Download complete!
)

echo.
echo [*] Starting tunnel to http://localhost:8000...
echo [*] Look for the link ending in ".trycloudflare.com" below!
echo.
cloudflared.exe tunnel --url http://localhost:8000
pause
