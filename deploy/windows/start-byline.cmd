@echo off
rem Byline launcher for Windows. Double-click it, or let install-autostart.ps1 run it at log-on.
rem Reads settings from ..\..\.env (KEY=VALUE lines; copy .env.example to .env first), keeps data in .\data,
rem daily backups in .\backups, and a log in .\logs\byline.log. Restarts Byline if it crashes.
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
pushd "%ROOT%" || exit /b 1
set "ROOT=%CD%"

rem Defaults (a value in .env wins).
set "PORT=3000"
set "HOST=127.0.0.1"
set "BYLINE_DATA_DIR=%ROOT%\data"
set "BYLINE_BACKUP_DIR=%ROOT%\backups"

if exist "%ROOT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ROOT%\.env") do (
    if not "%%B"=="" set "%%A=%%B"
  )
)

where node >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org & popd & exit /b 1)
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
if not exist "%BYLINE_DATA_DIR%" mkdir "%BYLINE_DATA_DIR%"

:run
echo [%date% %time%] starting Byline on http://%HOST%:%PORT% >> "%ROOT%\logs\byline.log"
node --disable-warning=ExperimentalWarning server.js >> "%ROOT%\logs\byline.log" 2>&1
set "CODE=%ERRORLEVEL%"
echo [%date% %time%] Byline exited with code %CODE% >> "%ROOT%\logs\byline.log"
if not "%CODE%"=="0" (
  timeout /t 10 /nobreak >nul
  goto run
)
popd
endlocal
