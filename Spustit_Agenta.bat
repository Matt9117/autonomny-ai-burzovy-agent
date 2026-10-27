@echo off
chcp 65001 >nul
title Autonomny AI Burzovy Agent (100 EUR)
echo Spustam lokalny server a pripajam sa na burzove data...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
