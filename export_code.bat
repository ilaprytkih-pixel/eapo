@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

cd /d "%~dp0"
set "OUT=game_code.txt"

if exist "%OUT%" del "%OUT%"

for %%F in (lang.js map-generator.js game-state.js economy.js combat.js diplomacy.js bots.js llm-agent.js renderer.js ui-controls.js main.js index.html styles.css smoke-test.js FIXES_APPLIED.md) do (
    if exist "%%F" (
        echo ================================================================>> "%OUT%"
        echo === FILE: %%F >> "%OUT%"
        echo ================================================================>> "%OUT%"
        type "%%F" >> "%OUT%"
        echo.>> "%OUT%"
        echo.>> "%OUT%"
    ) else (
        echo WARNING: file not found: %%F
    )
)

echo Done. All code saved to: %cd%\%OUT%
pause
