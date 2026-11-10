@echo off
rem Start AI (Gemma) + teacher screen (Google login) + optional Bluetooth classroom. See AI_LOGIN_BLUETOOTH_JA.md
rem   start_all.bat              start the AI server and open the teacher screen
rem   start_all.bat -Bluetooth   also start the Bluetooth relay app
rem   start_all.bat -Check       start nothing, only check the current state
rem Runs the PowerShell script with -ExecutionPolicy Bypass (works even if script execution is disabled).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_all.ps1" %*
pause
