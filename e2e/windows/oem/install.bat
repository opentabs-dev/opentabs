@echo off
REM ============================================================================
REM OpenTabs Windows E2E — Post-Install OEM Script
REM
REM This script runs automatically after Windows installation completes.
REM It installs Node.js 22, Git, clones the OpenTabs repo, builds it,
REM and runs the Windows-specific E2E test suite.
REM
REM Results are written to the Shared folder (mapped to /shared on the host).
REM ============================================================================

setlocal EnableDelayedExpansion

set "SHARED=C:\Users\opentabs\Desktop\Shared"
set "LOGFILE=%SHARED%\install.log"
set "RESULTFILE=%SHARED%\results.log"
set "REPO_DIR=C:\opentabs"

REM Wait for shared folder to be available
:wait_shared
if not exist "%SHARED%" (
    timeout /t 5 /nobreak >nul
    goto wait_shared
)

call :log "Starting OpenTabs Windows E2E setup"
call :log "=============================================="

REM ---- Wait for network ----
call :log "Waiting for network connectivity..."
:wait_network
ping -n 1 8.8.8.8 >nul 2>&1
if %errorlevel% neq 0 (
    call :log "  No network yet, retrying in 10s..."
    timeout /t 10 /nobreak >nul
    goto wait_network
)
call :log "Network is available"

REM ---- Install Node.js 22 LTS ----
call :log "Downloading Node.js 22 LTS..."

powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi' -OutFile 'C:\node-install.msi' -TimeoutSec 300; Write-Output 'Download OK' } catch { Write-Output \"Download failed: $_\"; exit 1 } }" >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
    call :log "FATAL: Node.js download failed"
    echo FATAL: Node.js download failed > "%RESULTFILE%"
    goto :done
)

call :log "Installing Node.js (silent MSI)..."
msiexec /i "C:\node-install.msi" /qn /norestart /l*v "C:\node-install-log.txt" >> "%LOGFILE%" 2>&1

REM Add to PATH for this session
set "PATH=C:\Program Files\nodejs;%PATH%"

REM Verify
node --version >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
    call :log "FATAL: Node.js installation failed"
    echo FATAL: Node.js installation failed > "%RESULTFILE%"
    goto :done
)
for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
for /f "delims=" %%v in ('npm --version') do set "NPM_VER=%%v"
call :log "Node.js installed: %NODE_VER%, npm: %NPM_VER%"

REM ---- Install Git ----
call :log "Downloading Git for Windows..."

powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe' -OutFile 'C:\git-install.exe' -TimeoutSec 300; Write-Output 'Download OK' } catch { Write-Output \"Download failed: $_\"; exit 1 } }" >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
    call :log "FATAL: Git download failed"
    echo FATAL: Git download failed > "%RESULTFILE%"
    goto :done
)

call :log "Installing Git (silent)..."
start /wait C:\git-install.exe /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh" /LOG="C:\git-install-log.txt"

REM Add to PATH for this session
set "PATH=C:\Program Files\Git\cmd;C:\Program Files\Git\bin;%PATH%"

git --version >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
    call :log "FATAL: Git installation failed"
    echo FATAL: Git installation failed > "%RESULTFILE%"
    goto :done
)
for /f "delims=" %%v in ('git --version') do set "GIT_VER=%%v"
call :log "Git installed: %GIT_VER%"

REM ---- Clone the repo ----
call :log "Cloning OpenTabs repo..."
git clone --depth 1 https://github.com/opentabs-dev/opentabs.git "%REPO_DIR%" >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
    call :log "FATAL: git clone failed"
    echo FATAL: git clone failed > "%RESULTFILE%"
    goto :done
)
call :log "Clone complete"

REM ---- Apply patches from OEM folder (pre-push fixes) ----
REM If C:\OEM\patches\ exists, copy its contents over the cloned repo.
REM This allows testing fixes before they are merged to main.
if exist "C:\OEM\patches" (
    call :log "Applying patches from OEM folder..."
    xcopy /s /y /q "C:\OEM\patches\*" "%REPO_DIR%\" >> "%LOGFILE%" 2>&1
    call :log "Patches applied"
)

REM ---- Install dependencies ----
call :log "Running npm ci (this takes a few minutes)..."
cd /d "%REPO_DIR%"
call npm ci --ignore-scripts >> "%LOGFILE%" 2>&1
REM Run install scripts for packages that need them (biome native binary, etc.)
REM but skip lefthook which requires git hooks setup
call npm rebuild >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
    call :log "FATAL: npm ci failed"
    echo FATAL: npm ci failed > "%RESULTFILE%"
    goto :done
)
call :log "npm ci complete"

REM ---- Build ----
REM Run build steps individually, skipping chmod (not available on Windows)
call :log "Running tsc --build..."
call npx tsc --build >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
    call :log "FATAL: tsc --build failed"
    echo FATAL: tsc --build failed > "%RESULTFILE%"
    goto :done
)

call :log "Running generate:browser-tools-catalog..."
call npm run generate:browser-tools-catalog >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
    call :log "WARNING: generate:browser-tools-catalog failed (non-fatal, catalog is pre-committed)"
)

call :log "Running extension bundle..."
call npm run --prefix platform/browser-extension build:bundle >> "%LOGFILE%" 2>&1
call npm run --prefix platform/browser-extension build:side-panel >> "%LOGFILE%" 2>&1

call :log "Running generate-icons..."
call npx tsx scripts/generate-icons.ts >> "%LOGFILE%" 2>&1

call :log "Running install-extension..."
call npx tsx scripts/install-extension.ts >> "%LOGFILE%" 2>&1

call :log "Build complete"

REM ---- Signal ready ----
echo READY > "%SHARED%\status.txt"
call :log "Running tests..."

REM ---- Run the Windows E2E test suite ----
REM The test script is in C:\OEM (copied from the host's oem/ mount),
REM not in the cloned repo (which may not have e2e/windows/ yet).
powershell -ExecutionPolicy Bypass -File "C:\OEM\run-tests.ps1" >> "%LOGFILE%" 2>&1

call :log "Tests complete."

:done
echo DONE > "%SHARED%\status.txt"
call :log "Setup finished."
goto :eof

:log
echo [%date% %time%] %~1 >> "%LOGFILE%"
echo [%date% %time%] %~1
goto :eof
