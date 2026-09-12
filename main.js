function startGame() {
    setCanvasSize();
    generate();

    if (typeof initGameState === 'function') initGameState();

    document.getElementById('importInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            if (typeof importMapState === 'function') importMapState(ev.target.result);
            if (typeof initGameState === 'function') initGameState(true);
            G.isPlayerSelectPhase = true;
            showCountrySelectOverlay();
            if (typeof hideProvincePanel === 'function') hideProvincePanel();
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    document.getElementById('exportBtn').addEventListener('click', function() {
        if (typeof exportMapState === 'function') exportMapState();
    });

    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.addEventListener('click', function() {
        if (typeof saveFullGameState !== 'function') return;
        const s = saveFullGameState();
        const el = document.getElementById('mapStatus');
        if (el) el.textContent = s ? 'Автосейв сохранён' : 'Не удалось сохранить';
    });

    const loadBtn = document.getElementById('loadBtn');
    if (loadBtn) loadBtn.addEventListener('click', function() {
        if (typeof loadFullGameState !== 'function') return;
        let raw = null;
        try { raw = (typeof localStorage !== 'undefined' ? localStorage : null) && localStorage.getItem('eapo_autosave_v1'); } catch (e) {}
        if (!raw) {
            const el = document.getElementById('mapStatus');
            if (el) el.textContent = 'Автосейва нет';
            return;
        }
        const canConfirm = typeof confirm === 'function';
        if (canConfirm && !confirm('Загрузить автосейв? Текущая игра будет потеряна.')) return;
        const res = loadFullGameState(raw);
        const el = document.getElementById('mapStatus');
        if (el) el.textContent = res.ok ? 'Автосейв загружен (ход ' + G.turnNumber + ')' : (res.msg || 'Ошибка загрузки');
    });

    document.getElementById('regenerateBtn').addEventListener('click', function() {
        generate();
        if (typeof initGameState === 'function') initGameState();
        G.isPlayerSelectPhase = true;
        showCountrySelectOverlay();
        if (typeof hideProvincePanel === 'function') hideProvincePanel();
        if (typeof initLlmPanel === 'function') initLlmPanel();
    });

    showCountrySelectOverlay();

    if (typeof setupUIControls === 'function') setupUIControls();
    if (typeof initLlmPanel === 'function') initLlmPanel();

    if (typeof applyTranslations === 'function') applyTranslations();
    const langBtnEl = document.getElementById('langBtn');
    if (langBtnEl) langBtnEl.textContent = currentLang === 'en' ? 'RU' : 'EN';

    requestAnimationFrame(gameLoop);
}

function showCountrySelectOverlay() {
    const existing = document.getElementById('selectOverlay');
    if (existing) existing.remove();

    const container = document.querySelector('.container');
    const overlay = document.createElement('div');
    overlay.id = 'selectOverlay';
    overlay.className = 'player-select-overlay';
    overlay.innerHTML = `<div class="player-select-msg">${typeof t === 'function' ? t('clickToSelect') : 'Click any province to select your country'}</div>`;
    container.appendChild(overlay);

    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    overlay.style.top = (canvasRect.top - containerRect.top) + 'px';
    overlay.style.left = (canvasRect.left - containerRect.left) + 'px';
    overlay.style.width = canvasRect.width + 'px';
    overlay.style.height = canvasRect.height + 'px';
}

let _lastGameTick = 0;
let _lastFrameTs = 0;
let _tickPaused = true;

function gameLoop(timestamp) {
    if (_lastFrameTs === 0) _lastFrameTs = timestamp;
    const frameDt = timestamp - _lastFrameTs;
    _lastFrameTs = timestamp;

    if (typeof updateFleetAnims === 'function') updateFleetAnims(frameDt);
    if (typeof updateShips === 'function') updateShips(frameDt);

    if (!G.isPaused && !G.isPlayerSelectPhase) {
        if (_tickPaused) { _lastGameTick = timestamp; _tickPaused = false; }

        const elapsed = timestamp - _lastGameTick;
        if (elapsed >= G.params.tickInterval) {
            _lastGameTick = timestamp;
            const dt = Math.min(elapsed, G.params.tickInterval * 3);
            G.tickCount++;

            for (let i = G.captures.length - 1; i >= 0; i--) {
                const cap = G.captures[i];
                if (!cap.isActive) {
                    G.captures.splice(i, 1);
                    continue;
                }
                processCaptureTick(cap, dt);
            }

            const resolvedProvs = new Set();
            // Учитываем ВСЕ захваты провинции (включая только что погибших атакующих —
            // они ещё в массиве, но уже isActive=false). Иначе при обнулении гарнизона
            // в тот же тик, что гибель всех атакующих, провинция зависала с армией 0.
            for (const cap of G.captures) {
                const tp = provinceList[cap.targetProvinceId];
                if (tp && tp.cells > 0 && tp.army <= 0) resolvedProvs.add(cap.targetProvinceId);
            }
            for (const pid of resolvedProvs) resolveProvinceCombat(pid);

            if (G.tickCount % G.params.botIntervalTicks === 0) {
                G.turnNumber++;
                processEconomyTurn();
                if (typeof processDiplomacyTurn === 'function') processDiplomacyTurn();
                if (typeof processLlmTurn === 'function') processLlmTurn();
                for (const c of countryList) {
                    processBotTurn(c.id);
                }

                // Ответы ботов на оферты/письма должны отражаться в панели сразу,
                // а не только при LLM-событиях (сиг-кэши делают вызов дешёвым).
                if (typeof refreshTreatiesUI === 'function') refreshTreatiesUI();
                if (typeof updatePlayerLettersUI === 'function') updatePlayerLettersUI();

                // Автосейв каждые 10 ходов (полный снимок без apiKey)
                if (G.turnNumber % 10 === 0 && typeof saveFullGameState === 'function') {
                    saveFullGameState();
                }

                if (G.playerCountryId >= 0) {
                    const pc = countryList[G.playerCountryId];
                    if (pc && (pc.peaceGracePeriod || 0) > 0) pc.peaceGracePeriod--;
                }

                for (const pr of provinceList) {
                    if (pr.cells > 0) {
                        const ownerId = findCountryOfProvince(pr.id);
                        if (ownerId >= 0) {
                            pr.army += Math.ceil(pr.cells / 250);
                        }
                    }
                }
            }
        }

        G.captures = G.captures.filter(c => c.isActive);
        // Жизненный цикл fleet-анимаций полностью ведёт updateFleetAnims:
        // завершённый захват => флот уплывает домой (returning), а не исчезает.
        G.ships = G.ships.filter(s => s.state !== 'used');
    } else {
        _tickPaused = true;
    }

    try {
        render();
    } catch (e) {
        console.error('render failed', e);
    }

    if (typeof drawPorts === 'function') drawPorts();
    if (typeof drawShips === 'function') drawShips();
    if (typeof drawFleetAnims === 'function') drawFleetAnims();
    if (typeof drawArmyNumbers === 'function') drawArmyNumbers();
    if (typeof drawCaptureAnimation === 'function') drawCaptureAnimation();
    if (typeof drawProgressBars === 'function') drawProgressBars();
    if (typeof drawSelectionHighlight === 'function') drawSelectionHighlight();
    if (G.selectedProvinceId != null && typeof drawArrows === 'function') {
        drawArrows(G.selectedProvinceId);
    }
    if (typeof updateCountryPanel === 'function') updateCountryPanel();
    if (typeof refreshProvincePanel === 'function') refreshProvincePanel();

    requestAnimationFrame(gameLoop);
}

// Автосейв при закрытии/уходе со страницы (безопасно для pagehide/visibilitychange).
function autosaveOnUnload() {
    try {
        if (typeof saveFullGameState === 'function') saveFullGameState();
    } catch (e) {}
}
if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', autosaveOnUnload);
    window.addEventListener('beforeunload', autosaveOnUnload);
}

startGame();
