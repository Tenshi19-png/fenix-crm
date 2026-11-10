@echo off
title Fenix CRM - Servidor Local
cd /d "%~dp0"
echo ========================================================
echo   Iniciando Fenix CRM en http://localhost:3456 ...
echo   No cierres esta ventana mientras uses el sistema.
echo ========================================================
start "" "http://localhost:3456"
node server/index.js
pause

