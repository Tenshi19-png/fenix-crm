@echo off
title Fenix - Vista previa de prueba
cd /d "%~dp0"
echo Esta vista usa una COPIA separada de los datos locales.
echo Abre http://127.0.0.1:3457 en tu navegador.
echo No cierres esta ventana mientras revisas la aplicacion.
node scripts/preview.js
pause
