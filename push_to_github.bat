@echo off
title Push DuoCinema to GitHub
echo ========================================================
echo        Pushing DuoCinema to GitHub (Vashukulashri88)
echo ========================================================
echo.
echo Make sure you have created an empty repository on GitHub:
echo https://github.com/new (Name: DuoCinema)
echo.
pause
echo.
echo Pushing to origin main...
git push -u origin main
echo.
if %errorlevel% equ 0 (
    echo [SUCCESS] Project successfully pushed to:
    echo https://github.com/Vashukulashri88/DuoCinema
) else (
    echo.
    echo [!] If prompted, log in with your browser or Personal Access Token (PAT).
)
echo.
pause
