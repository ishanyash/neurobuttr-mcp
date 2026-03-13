: ; # Cross-platform polyglot launcher
: ; # On Windows this runs as a .cmd batch file
: ; # On Unix/macOS the shell ignores the batch lines and runs bash
: ; exec bash "${0%.cmd}" "$@"
@echo off
setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "HOOK_NAME=%~1"
if "%HOOK_NAME%"=="" (
  echo Usage: run-hook.cmd ^<hook-name^>
  exit /b 1
)
set "HOOK_SCRIPT=%SCRIPT_DIR%%HOOK_NAME%"
if not exist "%HOOK_SCRIPT%" (
  echo Hook script not found: %HOOK_SCRIPT%
  exit /b 1
)
bash "%HOOK_SCRIPT%"
exit /b %errorlevel%
