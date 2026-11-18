@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-portable.ps1" -Role student
exit /b %errorlevel%
