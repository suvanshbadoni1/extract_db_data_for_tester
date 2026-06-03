@echo off
title Payment Transaction Query Tool
echo ========================================
echo   Payment Transaction Query Tool
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Check if .env file exists
if not exist .env (
    echo [WARNING] .env file not found!
    echo Creating default .env file...
    (
        echo MSSQL_USER=test_user
        echo MSSQL_PASSWORD=test123
        echo MSSQL_SERVER=10.230.195.68
        echo MSSQL_DATABASE=PRMNRT
        echo MSSQL_PORT=14889
        echo ORACLE1_USER=upfdev4
        echo ORACLE1_PASSWORD=upfdev4
        echo ORACLE1_CONNECT_STRING=10.230.195.68:1521/UPFDB
        echo ORACLE2_USER=eps_user
        echo ORACLE2_PASSWORD=
        echo ORACLE2_CONNECT_STRING=10.230.195.68:1521/EPSDB
    ) > .env
    echo [OK] .env file created. Please update with your credentials.
)

:: Check if node_modules exists
if not exist node_modules (
    echo [INFO] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
)

:: Create logs directory if not exists
if not exist logs mkdir logs

:: Start the server in a new window
echo [INFO] Starting server...
start "Payment Query Server" /min cmd /c "node server.js"

:: Wait for server to start (5 seconds)
echo [INFO] Waiting for server to start...
timeout /t 5 /nobreak >nul

:: Open browser
echo [INFO] Opening browser...
start http://localhost:3000

echo.
echo ========================================
echo   Application is running!
echo   Browser should open automatically
echo   Press any key to STOP the server
echo ========================================
pause >nul

:: Kill the Node.js process
echo [INFO] Stopping server...
taskkill /f /im node.exe >nul 2>nul

echo [INFO] Application stopped.
timeout /t 2 /nobreak >nul
exit