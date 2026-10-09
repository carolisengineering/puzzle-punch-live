@echo off
setlocal
cd /d "%~dp0"
title Puzzle Punch Launcher

rem -- start the telemetry helper in its own minimized window (keeps running while you play)
start "Puzzle Punch Helper" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0puzzle_punch_helper.ps1"

rem -- give the helper a moment to start, then open the game
timeout /t 2 /nobreak >nul
start "" "http://localhost:8747/"

endlocal
