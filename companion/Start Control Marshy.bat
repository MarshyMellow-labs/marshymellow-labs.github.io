@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)
node --env-file-if-exists=.env marshy-control.mjs
if errorlevel 1 pause
endlocal
