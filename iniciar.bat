@echo off
echo Iniciando VMS Platform...

start "Backend" cmd /k "cd /d C:\Users\vitor\vms-platform\backend && py -3.11 -m uvicorn app.main:app --reload --port 8000"

timeout /t 3

start "Frontend" cmd /k "cd /d C:\Users\vitor\vms-platform\frontend && npm run dev"

echo Servidores iniciados!