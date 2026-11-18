@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-portable.ps1" -Role teacher
exit /b %errorlevel%
