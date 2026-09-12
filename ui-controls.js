let _actionPanel = null;
let mapZoom = 1.0;
let mapPanX = 0, mapPanY = 0;
let _panDragging = false;
let _panStartX = 0, _panStartY = 0;
let _panStartPanX = 0, _panStartPanY = 0;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4.0;

// Применяем translate+scale: пан правой кнопкой + зум колесом.
// getBoundingClientRect учитывает обе трансформации — клики/ховер работают как есть.
function applyMapTransform() {
    // Карта не должна уходить дальше своего края: при zoom=1 пан невозможен
    const maxPanX = Math.max(0, (canvas.width * (mapZoom - 1)) / 2);
    const maxPanY = Math.max(0, (canvas.height * (mapZoom - 1)) / 2);
    mapPanX = Math.max(-maxPanX, Math.min(maxPanX, mapPanX));
    mapPanY = Math.max(-maxPanY, Math.min(maxPanY, mapPanY));
    canvas.style.transform = `translate(${mapPanX}px, ${mapPanY}px) scale(${mapZoom})`;
}

function fmtNum(n) {
    if (n == null || !isFinite(n)) return '0';
    const neg = n < 0 ? '-' : '';
    const a = Math.abs(Math.round(n));
    if (a >= 1e9) return neg + (a / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return neg + (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return neg + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return neg + a.toLocaleString('en-US');
}

function addGameLog(msg) {
    const el = document.getElementById('gameLog');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = 1;
    clearTimeout(el._logTimer);
    el._logTimer = setTimeout(() => { el.style.opacity = 0.6; }, 4000);
}

function setupUIControls() {
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('mousemove', onCanvasMousemove);

    // Безопасный зум колесом: CSS scale на канвасе. Клики/ховер уже учитывают
    // масштаб через getBoundingClientRect (canvas.width / rect.width).
    canvas.addEventListener('wheel', function(e) {
        e.preventDefault(); // не скроллить страницу над картой

        const zoomSpeed = 0.1;
        const delta = e.deltaY > 0 ? -1 : 1;
        const oldZoom = mapZoom;
        mapZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, mapZoom + delta * zoomSpeed));
        if (mapZoom === oldZoom) return;

        applyMapTransform();
    }, { passive: false });

    // Панорамирование карты правой кнопкой мыши (актуально при зуме > 1).
    // Вся математика — CSS translate; клики продолжают работать благодаря getBoundingClientRect.
    canvas.addEventListener('contextmenu', function(e) {
        e.preventDefault(); // не показывать меню браузера
    });
    canvas.addEventListener('mousedown', function(e) {
        if (e.button !== 2) return;
        _panDragging = true;
        _panStartX = e.clientX;
        _panStartY = e.clientY;
        _panStartPanX = mapPanX;
        _panStartPanY = mapPanY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
    });
    window.addEventListener('mousemove', function(e) {
        if (!_panDragging) return;
        mapPanX = _panStartPanX + (e.clientX - _panStartX);
        mapPanY = _panStartPanY + (e.clientY - _panStartY);
        applyMapTransform();
    });
    window.addEventListener('mouseup', function(e) {
        if (e.button !== 2 || !_panDragging) return;
        _panDragging = false;
        canvas.style.cursor = 'crosshair';
    });

    window.addEventListener('resize', function() {
        const oldPs = pixelSize;
        calcPixelSize();
        if (pixelSize !== oldPs) {
            setCanvasSize();
            // Пересчитываем позицию оверлея под новый размер канваса
            const overlay = document.getElementById('selectOverlay');
            if (overlay && typeof showCountrySelectOverlay === 'function') {
                showCountrySelectOverlay();
            }
        }
    });

    document.getElementById('pauseBtn').addEventListener('click', function() {
        G.isPaused = !G.isPaused;
        this.textContent = G.isPaused ? t('resume') : t('pause');
    });

    const seedInput = document.getElementById('seedInput');
    seedInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const val = parseInt(this.value);
            if (val > 0) generate(val);
            if (typeof initGameState === 'function') initGameState();
            G.isPlayerSelectPhase = true;
            showCountrySelectOverlay();
            if (typeof hideProvincePanel === 'function') hideProvincePanel();
            if (typeof initLlmPanel === 'function') initLlmPanel();
        }
    });
    seedInput.addEventListener('blur', function() {
        const val = parseInt(this.value);
        if (val > 0 && val !== seed) {
            generate(val);
            if (typeof initGameState === 'function') initGameState();
            G.isPlayerSelectPhase = true;
            showCountrySelectOverlay();
            if (typeof hideProvincePanel === 'function') hideProvincePanel();
            if (typeof initLlmPanel === 'function') initLlmPanel();
        }
    });

    document.getElementById('langBtn').addEventListener('click', function() {
        setLang(currentLang === 'en' ? 'ru' : 'en');
    });

    setupBalanceSliders();
    setupGenSliders();
    setupCountryPanel();
    if (typeof setupLlmUI === 'function') setupLlmUI();
    if (typeof initLlmPanel === 'function') initLlmPanel();
}

function setupBalanceSliders() {
    ['attackRate', 'defenseRate', 'tickInterval', 'botInterval', 'flankPenalty'].forEach(id => {
        const el = document.getElementById(id);
        const label = document.getElementById(id + 'Val');
        if (!el || !label) return;
        const update = () => {
            const v = parseFloat(el.value);
            label.textContent = v;
            if (id === 'attackRate') G.params.attackRate = v;
            else if (id === 'defenseRate') G.params.defenseRate = v;
            else if (id === 'tickInterval') G.params.tickInterval = v;
            else if (id === 'botInterval') G.params.botIntervalTicks = v;
            else if (id === 'flankPenalty') G.params.flankDefensePenalty = v;
        };
        el.addEventListener('input', update);
        update();
    });
    ['growthRate', 'taxRate', 'armyUpkeepRate', 'infraUpkeepRate'].forEach(id => {
        const el = document.getElementById(id);
        const label = document.getElementById(id + 'Val');
        if (!el || !label) return;
        const update = () => {
            const v = parseFloat(el.value);
            label.textContent = v;
            if (id === 'growthRate') G.params.growthRate = v;
            else if (id === 'taxRate') G.params.taxRate = v;
            else if (id === 'armyUpkeepRate') G.params.armyUpkeepRate = v;
            else if (id === 'infraUpkeepRate') G.params.infraUpkeepRate = v;
        };
        el.addEventListener('input', update);
        update();
    });
}

function setupGenSliders() {
    ['mapWidth', 'mapHeight'].forEach(id => {
        const el = document.getElementById(id);
        const label = document.getElementById(id + 'Val');
        if (!el || !label) return;
        el.addEventListener('input', () => { label.textContent = el.value; });
        el.addEventListener('change', () => {
            generate();
            if (typeof initGameState === 'function') initGameState();
            G.isPlayerSelectPhase = true;
            showCountrySelectOverlay();
            if (typeof hideProvincePanel === 'function') hideProvincePanel();
            if (typeof initLlmPanel === 'function') initLlmPanel();
        });
    });

    ['provCount', 'countryCount', 'terrainFit'].forEach(id => {
        const el = document.getElementById(id);
        const label = document.getElementById(id + 'Val');
        if (!el || !label) return;
        el.addEventListener('input', () => {
            if (id === 'provCount') {
                const countryEl = document.getElementById('countryCount');
                const countryLabel = document.getElementById('countryCountVal');
                const maxCountries = Math.max(2, Math.min(12, Math.floor(parseInt(el.value) / 4)));
                countryEl.max = maxCountries;
                if (parseInt(countryEl.value) > maxCountries) {
                    countryEl.value = maxCountries;
                }
                countryLabel.textContent = countryEl.value;
            }
            label.textContent = el.value;
        });
        el.addEventListener('change', () => {
            generateBorders();
            if (typeof initGameState === 'function') initGameState();
            G.isPlayerSelectPhase = true;
            showCountrySelectOverlay();
            if (typeof hideProvincePanel === 'function') hideProvincePanel();
            if (typeof initLlmPanel === 'function') initLlmPanel();
        });
    });
    ['showProvinces', 'showCountries'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            _mapDirty = true; // границы кэшируются в offscreen-слое — обязаны инвалидировать
            render();
        });
    });
}

function onCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * sx;
    const my = (e.clientY - rect.top) * sy;

    updateCoordDisplay(mx, my);

    if (G.isPlayerSelectPhase) {
        handlePlayerSelectClick(mx, my);
        return;
    }

    if (_actionPanel) {
        _actionPanel.remove();
        _actionPanel = null;
    }

    const prov = getProvinceAtPixel(mx, my);

    if (!prov || !prov.cells) {
        G.selectedProvinceId = null;
        hideArrows();
        hideActionPanel();
        hideProvincePanel();
        return;
    }

    if (G.selectedProvinceId != null && _arrowTargets.includes(prov.id)) {
        handleArrowClick(G.selectedProvinceId, prov.id);
        return;
    }

    if (isOwnProvince(prov)) {
        if (G.selectedProvinceId === prov.id) {
            G.selectedProvinceId = null;
            hideArrows();
            hideProvincePanel();
        } else {
            G.selectedProvinceId = prov.id;
            hideActionPanel();
            showProvincePanel(prov);
        }
    } else {
        G.selectedProvinceId = null;
        hideArrows();
        hideProvincePanel();
    }
}

function hideProvincePanel() {
    const el = document.getElementById('provincePanel');
    if (el) el.remove();
}

function showProvincePanel(province) {
    hideProvincePanel();
    if (!isOwnProvince(province)) return;

    const panel = document.createElement('div');
    panel.className = 'game-panel';
    panel.id = 'provincePanel';
    panel.style.left = '50%';
    panel.style.bottom = '120px';
    panel.style.transform = 'translateX(-50%)';

    let html = `<h3>Province #${province.id}</h3>`;
    html += `<div style="font-size:10px;color:#6a7a9a;">Pop: ${fmtNum(province.population)} | Infra: ${fmtNum(province.infrastructure)} | Army: ${fmtNum(province.army)}</div>`;

    if (province.port && province.port.built) {
        // Считаем корабли по фактической стоянке (portProvinceId), как во всех
        // остальных местах (startCapture, боты, стрелки). homeProvinceId — это
        // «родной» порт: после одностороннего транспорта корабль остаётся в
        // порту назначения, и старый фильтр показывал тут фантомные корабли.
        const myShips = G.ships.filter(s => s.portProvinceId === province.id && s.ownerCid === G.playerCountryId);
        const idleShips = myShips.filter(s => s.state === 'idle').length;
        html += `<div style="margin-top:6px;">\u2693 Port \u2014 Ships: ${province.port.ships}/${G.params.maxShipsPerPort} (${idleShips} idle)</div>`;
        if (idleShips > 0) {
            html += `<div style="margin-top:4px;font-size:10px;color:#4a8acc;">Sea routes: click a dashed arrow to send ships</div>`;
        } else if (province.port.ships > 0) {
            html += `<div style="margin-top:4px;font-size:10px;color:#6a7a9a;">Ships at sea\u2026 wait for idle ships to sail again</div>`;
        }
        if (province.port.ships > 0) {
            html += `<button class="btn" id="sendRouteBtn" style="margin-top:4px;font-size:10px;">Send Patrol Route</button>`;
        }
        if (province.port.ships < G.params.maxShipsPerPort) {
            html += `<button class="btn" id="buildShipBtn" style="margin-top:6px;font-size:10px;">Build Ship (${G.params.shipCost}g)</button>`;
        }
    } else if (province.isCoastal) {
        html += `<div style="margin-top:6px;">Coastal province</div>`;
        html += `<button class="btn" id="buildPortBtn" style="margin-top:6px;font-size:10px;">Build Port (${G.params.portCost}g)</button>`;
        html += `<div style="margin-top:4px;font-size:10px;color:#6a7a9a;">Port \u2192 build ships \u2192 sea routes to all coastal provinces</div>`;
        if (province.port && province.port.built === false && province.port.buildTimer > 0) {
            html += `<div style="margin-top:4px;font-size:10px;color:#a0b0d0;">Building port\u2026</div>`;
        }
    }

    panel.innerHTML = html;
    document.querySelector('.container').appendChild(panel);

    const portBtn = document.getElementById('buildPortBtn');
    if (portBtn) portBtn.addEventListener('click', () => buildPort(province));

    const shipBtn = document.getElementById('buildShipBtn');
    if (shipBtn) shipBtn.addEventListener('click', () => buildShip(province));

    const routeBtn = document.getElementById('sendRouteBtn');
    if (routeBtn) routeBtn.addEventListener('click', () => sendShipRoute(province));
}

function buildPort(province) {
    const cid = findCountryOfProvince(province.id);
    if (cid < 0) return;
    const country = countryList[cid];
    if (!province.isCoastal) { addGameLog('Not a coastal province'); return; }
    if (province.port && province.port.built) { addGameLog('Port already exists'); return; }
    if (country.treasury < G.params.portCost) {
        addGameLog('Not enough gold to build port');
        return;
    }
    const pos = findPortVisualPosition(province);
    const vx = pos ? pos.vx : -1;
    const vy = pos ? pos.vy : -1;
    const waterRegionId = (vx >= 0 && G.waterRegionOf) ? G.waterRegionOf[idxOf(vx, vy)] : -1;
    if (waterRegionId >= 0 && G.waterIsOcean[waterRegionId] === false) {
        addGameLog('Cannot build port on enclosed water body');
        return;
    }
    country.treasury -= G.params.portCost;
    province.port = { built: true, ships: 0, buildTimer: 0, vx, vy, waterRegionId };
    addGameLog(`Built port in province ${province.id} — build ships to unlock sea routes`);
    hideProvincePanel();
    showProvincePanel(province);
}

function buildShip(province) {
    const cid = findCountryOfProvince(province.id);
    if (cid < 0) return;
    const country = countryList[cid];
    if (country.treasury < G.params.shipCost) {
        addGameLog('Not enough gold to build ship');
        return;
    }
    if (!province.port || !province.port.built) return;
    if (province.port.vx < 0 || province.port.vy < 0) {
        addGameLog('Invalid port position');
        return;
    }
    if (province.port.ships >= G.params.maxShipsPerPort) {
        addGameLog('Port is at max capacity');
        return;
    }
    country.treasury -= G.params.shipCost;
    province.port.ships++;
    G.ships.push({
        id: shipIdCounter++,
        ownerCid: cid,
        homeProvinceId: province.id,
        portProvinceId: province.id,
        targetProvinceId: null,
        x: province.port.vx * pixelSize + pixelSize / 2,
        y: province.port.vy * pixelSize + pixelSize / 2,
        targetX: -1, targetY: -1,
        path: null,
        pathIndex: 0,
        progress: 0,
        state: 'idle',
        speed: G.params.shipMoveSpeed
    });
    addGameLog(`Built ship in province ${province.id}`);
    hideProvincePanel();
    showProvincePanel(province);
}

function sendShipRoute(province) {
    const cid = findCountryOfProvince(province.id);
    if (cid < 0 || cid !== G.playerCountryId) return;
    const idleShips = G.ships.filter(s => s.portProvinceId === province.id && s.state === 'idle' && s.ownerCid === cid);
    if (idleShips.length === 0) { addGameLog('No idle ships in this port'); return; }

    const targets = [];
    for (const pr of provinceList) {
        if (!pr.cells || pr.id === province.id || !pr.isCoastal || !pr.port || !pr.port.built) continue;
        const owner = findCountryOfProvince(pr.id);
        if (owner === cid && canSeaTravel(province, pr)) targets.push(pr);
    }
    if (targets.length === 0) { addGameLog('No friendly ports reachable by sea'); return; }

    const target = targets[Math.floor(Math.random() * targets.length)];
    const ship = idleShips[0];

    const fx = province.port.vx, fy = province.port.vy;
    const tx = target.port.vx, ty = target.port.vy;
    if (fx < 0 || fy < 0 || tx < 0 || ty < 0) { addGameLog('Invalid port position'); return; }

    const path = findWaterPath(fx, fy, tx, ty);
    if (!path) { addGameLog('No water route to target'); return; }

    ship.state = 'sailing';
    ship.targetX = target.port.vx;
    ship.targetY = target.port.vy;
    ship.targetProvinceId = target.id;
    ship.path = path;
    ship.pathIndex = 0;
    ship.progress = 0;
    province.port.ships = Math.max(0, province.port.ships - 1);
    addGameLog(`Ship sailing from ${province.id} to ${target.id}`);
    hideProvincePanel();
    showProvincePanel(province);
}

function updateCoordDisplay(mx, my) {
    const cx = Math.floor(mx / pixelSize);
    const cy = Math.floor(my / pixelSize);
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) {
        document.getElementById('coord').textContent = '\u25c7';
        document.getElementById('elev').textContent = '';
        return;
    }
    const h = heightMap[cy][cx];
    const m = moistMap[cy][cx];
    const lat = latMap[cy][cx];
    document.getElementById('coord').textContent = `[${cx}, ${cy}]`;

    let biome = '';
    const cold = lat < 0.15;
    const wettest = m > 0.72 && lat > 0.5;
    if (h < 0.30) biome = 'deep ocean';
    else if (h < 0.44) biome = 'ocean';
    else if (h < 0.48) biome = 'shoal';
    else if (h < 0.505) biome = 'beach';
    else if (h < 0.90) {
        if (cold) {
            biome = h < 0.56 ? 'tundra' : (h < 0.68 ? 'sparse taiga' : (h < 0.76 ? 'taiga' : (h < 0.86 ? 'rocky slopes' : 'alpine')));
        } else if (wettest) {
            biome = h < 0.56 ? 'light jungle' : (h < 0.68 ? 'jungle' : (h < 0.76 ? 'dense rainforest' : (h < 0.86 ? 'cloud forest' : 'alpine')));
        } else if (m < 0.5) {
            biome = h < 0.52 ? 'dunes' : (h < 0.62 ? 'semi-desert' : (h < 0.68 ? 'dry steppe' : (h < 0.76 ? 'dry hills' : (h < 0.86 ? 'foothills' : 'rocky slopes'))));
        } else {
            biome = h < 0.52 ? 'meadow' : (h < 0.62 ? 'savanna' : (h < 0.68 ? 'plain' : (h < 0.76 ? 'forest' : (h < 0.86 ? 'coniferous forest' : 'rocky slopes'))));
        }
    }
    else if (h < 0.94) biome = 'mountain';
    else biome = 'snow peak';
    let extra = '';
    if (provinceMap) {
        const pid = provinceMap[cy * COLS + cx];
        const cid = countryMap[cy * COLS + cx];
        if (pid >= 0) extra = ` \u00b7 prov ${pid}${cid >= 0 ? ', country ' + cid : ''}`;
    }
    document.getElementById('elev').textContent = `${(h * 100).toFixed(1)}% \u00b7 ${biome}${extra}`;
}

function onCanvasMousemove(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * sx;
    const my = (e.clientY - rect.top) * sy;
    const cx = Math.floor(mx / pixelSize);
    const cy = Math.floor(my / pixelSize);
    if (!_panDragging) {
        canvas.style.cursor = (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) ? 'crosshair' : 'default';
    }
}

function handlePlayerSelectClick(mx, my) {
    const prov = getProvinceAtPixel(mx, my);
    if (!prov) return;
    const cid = findCountryOfProvince(prov.id);
    if (cid < 0) return;
    if (countryList[cid] && countryList[cid].provinces.length > 0) {
        selectPlayerCountry(cid);
        addGameLog(`You selected ${countryList[cid].name}`);
    }
}

function handleArrowClick(srcProvId, targetProvId) {
    const src = provinceList[srcProvId];
    const tgt = provinceList[targetProvId];
    if (!src || !tgt) return;

    hideProvincePanel();

    const isEnemy = !isOwnProvince(tgt);
    const hasNeighbor = src.neighbors instanceof Set ? src.neighbors.has(tgt.id) : src.neighbors.includes(tgt.id);
    const isSea = !hasNeighbor;
    if (isEnemy) {
        showActionPanel(src, tgt, 'attack', isSea);
    } else {
        showActionPanel(src, tgt, 'reinforce', isSea);
    }
}

function showActionPanel(srcProv, tgtProv, mode, isSea) {
    hideActionPanel();
    const isAttack = mode === 'attack';

    const panel = document.createElement('div');
    panel.className = 'game-panel';
    panel.id = 'actionPanel';

    const srcCountry = countryList[findCountryOfProvince(srcProv.id)];
    const tgtCountry = countryList[findCountryOfProvince(tgtProv.id)];
    const title = isAttack
        ? `${t('attack')} ${t('provinces')} ${tgtProv.id} (${tgtCountry ? tgtCountry.name : '?'})`
        : `${t('reinforce')} ${t('provinces')} ${tgtProv.id}`;

    const seaNote = isSea
        ? `<div style="font-size:10px;color:#4a8acc;margin-top:4px;">\u2937 Sea route${isAttack ? ' — корабли будут потрачены на десант' : ' — корабли вернутся (или останутся в порту назначения)'}</div>`
        : '';

    let flankNote = '';
    if (isAttack) {
        const fronts = new Set();
        for (const c of G.captures) {
            if (c.isActive && c.targetProvinceId === tgtProv.id) fronts.add(c.attackerProvinceId);
        }
        const F = Math.min(fronts.size + 1, G.params.flankMaxFronts || 5);
        if (F >= 2) {
            const mult = Math.max(0, 1 - G.params.flankDefensePenalty * (F - 1));
            flankNote = `<div style="font-size:10px;color:#dd9999;margin-top:4px;">\u2694 Flank attack: ${F} fronts \u2014 defender counter \u00d7${mult.toFixed(2)}</div>`;
        }
    }

    panel.innerHTML = `
        <h3>${title}</h3>
        <div class="slider-row">
            <label>${t('army')}</label>
            <input type="range" id="actionSlider" min="10" max="100" value="60" step="5">
            <span class="val" id="actionSliderVal">60%</span>
        </div>
        <div style="font-size:10px;color:#6a7a9a;margin-top:4px;">
            ${t('sending')} <span id="sendAmount">${fmtNum(srcProv.army * 0.6)}</span> / ${fmtNum(srcProv.army)} available
        </div>
        ${seaNote}
        ${flankNote}
        <div id="shipInfo" style="font-size:10px;color:#6a7a9a;margin-top:2px;"></div>
        <div class="btn-row">
            <button class="cancel-btn" id="actionCancel">${t('cancel')}</button>
            <button class="confirm-btn ${isAttack ? 'btn-attack' : 'btn-reinforce'}" id="actionConfirm">${isAttack ? t('attack') : t('reinforce')}</button>
        </div>
    `;

    panel.style.left = '50%';
    panel.style.bottom = '70px';
    panel.style.transform = 'translateX(-50%)';
    document.querySelector('.container').appendChild(panel);
    _actionPanel = panel;

    const slider = document.getElementById('actionSlider');
    const valLabel = document.getElementById('actionSliderVal');
    const sendLabel = document.getElementById('sendAmount');
    const shipInfo = document.getElementById('shipInfo');

    function updateShipInfo() {
        if (!isSea) return;
        const pct = parseInt(slider.value);
        const commit = Math.floor(srcProv.army * pct / 100);
        const needed = Math.ceil(commit / G.params.shipCapacity);
        const has = G.ships.filter(s => s.portProvinceId === srcProv.id && s.state === 'idle' && s.ownerCid === G.playerCountryId).length;
        if (needed > 0) {
            shipInfo.textContent = `Ships: ${has} idle, ${needed} needed`;
            shipInfo.style.color = has >= needed ? '#88bb88' : '#dd6666';
        }
    }

    slider.addEventListener('input', () => {
        valLabel.textContent = slider.value + '%';
        sendLabel.textContent = Math.floor(srcProv.army * parseInt(slider.value) / 100);
        updateShipInfo();
    });

    updateShipInfo();

    document.getElementById('actionCancel').addEventListener('click', hideActionPanel);
    document.getElementById('actionConfirm').addEventListener('click', () => {
        const pct = parseInt(slider.value);
        const commit = Math.floor(srcProv.army * pct / 100);
        if (isSea) {
            const port = srcProv.port;
            const needed = Math.ceil(commit / G.params.shipCapacity);
            const idleShips = G.ships.filter(s => s.portProvinceId === srcProv.id && s.state === 'idle' && s.ownerCid === G.playerCountryId).length;
            if (!port || !port.built || idleShips < needed) {
                addGameLog('Not enough idle ships');
                return;
            }
            if (!canSeaTravel(srcProv, tgtProv)) {
                addGameLog('No sea route to target');
                return;
            }
        }
        if (isAttack) {
            const tgtCid = findCountryOfProvince(tgtProv.id);
            if (tgtCid >= 0) {
                const srcCid = findCountryOfProvince(srcProv.id);
                if (!isAtWar(srcCid, tgtCid)) {
                    if (!canDeclareWar(srcCid, tgtCid)) {
                        addGameLog('Cannot declare war yet (peace grace period)');
                        return;
                    }
                }
            }
            const opts = isSea ? { isSea: true } : undefined;
            const cap = startCapture(srcProv, tgtProv, pct, opts);
            if (cap) {
                if (tgtCid >= 0) {
                    const srcCid = findCountryOfProvince(srcProv.id);
                    if (!isAtWar(srcCid, tgtCid)) {
                        startWar(srcCid, tgtCid);
                        recordCombat(srcCid, tgtCid);
                    } else {
                        recordCombat(srcCid, tgtCid);
                    }
                }
                addGameLog(`Attack: ${srcProv.id} -> ${tgtProv.id} (${pct}%)`);
            }
        } else if (isSea) {
            const port = srcProv.port;
            const needed = Math.ceil(commit / G.params.shipCapacity);
            const idleShips = G.ships.filter(s => s.portProvinceId === srcProv.id && s.state === 'idle' && s.ownerCid === G.playerCountryId);
            if (commit <= 0) {
                addGameLog('Not enough army to send');
                return;
            }
            if (!port || !port.built || port.vx < 0 || idleShips.length < needed) {
                addGameLog('Not enough idle ships');
                return;
            }
            if (!canSeaTravel(srcProv, tgtProv)) {
                addGameLog('No sea route to target');
                return;
            }

            // Морское подкрепление = транспортный рейс: корабли везут войска
            // и остаются в порту назначения, либо возвращаются обратно.
            let destX, destY;
            if (tgtProv.port && tgtProv.port.built && tgtProv.port.vx >= 0) {
                destX = tgtProv.port.vx;
                destY = tgtProv.port.vy;
            } else {
                const landPos = findPortVisualPosition(tgtProv);
                if (!landPos) {
                    addGameLog('No landing point at target');
                    return;
                }
                destX = landPos.vx;
                destY = landPos.vy;
            }
            const path = findWaterPath(port.vx, port.vy, destX, destY);
            if (!path) {
                addGameLog('No sea route to target');
                return;
            }

            const base = Math.floor(commit / needed);
            const extra = commit % needed;
            for (let i = 0; i < needed; i++) {
                const ship = idleShips[i];
                ship.state = 'sailing';
                ship.payload = base + (i < extra ? 1 : 0);
                ship.transportSrcPortId = srcProv.id;
                ship.targetProvinceId = tgtProv.id;
                ship.path = path;
                ship.pathIndex = 0;
                ship.progress = 0;
            }
            srcProv.army -= commit;
            port.ships = Math.max(0, port.ships - needed);
            addGameLog(`Sea reinforce: ${srcProv.id} -> ${tgtProv.id} (${pct}%, ${commit} troops)`);
        } else {
            const ok = reinforceProvince(srcProv, tgtProv, pct);
            if (ok) addGameLog(`Reinforced: ${srcProv.id} -> ${tgtProv.id} (${pct}%)`);
        }
        hideActionPanel();
        G.selectedProvinceId = null;
        hideArrows();
        hideProvincePanel();
    });
}

function hideActionPanel() {
    const el = document.getElementById('actionPanel');
    if (el) el.remove();
    _actionPanel = null;
}

function refreshProvincePanel() {
    const panel = document.getElementById('provincePanel');
    if (!panel || G.selectedProvinceId == null) return;
    const prov = provinceList[G.selectedProvinceId];
    if (!prov || !prov.cells || !isOwnProvince(prov)) { hideProvincePanel(); return; }
    const port = prov.port;
    const sig = [prov.population, prov.infrastructure, prov.army, port ? port.built : false, port ? port.ships : 0].join('|');
    if (sig === refreshProvincePanel._sig) return;
    refreshProvincePanel._sig = sig;
    hideProvincePanel();
    showProvincePanel(prov);
}

function setupCountryPanel() {
    const toggle = document.getElementById('countryPanelToggle');
    const body = document.getElementById('countryPanelBody');
    if (toggle && body) {
        toggle.addEventListener('click', () => {
            body.classList.toggle('collapsed');
            toggle.textContent = body.classList.contains('collapsed') ? t('countryPanelCollapsed') : t('countryPanel');
        });
    }
}

function updateCountryPanel() {
    const body = document.getElementById('countryPanelBody');
    if (!body || !countryList) return;
    if (Date.now() - updateCountryPanel._lastUpdate < 500) return;
    updateCountryPanel._lastUpdate = Date.now();

    const playerCid = G.playerCountryId;
    const playerCountry = playerCid >= 0 ? countryList[playerCid] : null;
    // Все входящие мирные предложения (очередь, не один слот)
    let peaceProposalHtml = '';
    const peaceProps = (typeof getPeaceProposals === 'function' && playerCid >= 0)
        ? getPeaceProposals(playerCid) : [];
    for (const fromId of peaceProps) {
        const fromCountry = countryList[fromId];
        if (!fromCountry) continue;
        peaceProposalHtml += `
                <div class="peace-proposal">
                    <span>${fromCountry.name} ${t('proposesPeace')}</span>
                    <button class="btn-peace" data-peace-accept="${fromId}">${t('acceptPeace')}</button>
                    <button class="cancel-btn" data-peace-reject="${fromId}">${t('rejectPeace')}</button>
                </div>`;
    }

    let html = peaceProposalHtml;

    for (const c of countryList) {
        const totalPop = c.provinces.reduce((s, pid) => s + (provinceList[pid] ? provinceList[pid].population : 0), 0);
        const provCount = c.provinces.length;
        const treasury = c.treasury || 0;
        const hist = c.treasuryHistory || [];
        let trend = '\u2192';
        if (hist.length >= 2) {
            const prev = hist[hist.length - 2];
            if (treasury > prev * 1.01) trend = '\u2191';
            else if (treasury < prev * 0.99) trend = '\u2193';
        }
        const crisis = (c.crisisTurns || 0) >= 3;
        const col = COUNTRY_COLORS[c.id % COUNTRY_COLORS.length];
        const colorHex = '#' + ((1 << 24) + (col[0] << 16) + (col[1] << 8) + col[2]).toString(16).slice(1);
        const treasuryStr = fmtNum(treasury);
        const popStr = fmtNum(totalPop);

        let atWarBadge = '';
        let peaceBtn = '';
        if (playerCid >= 0 && c.id !== playerCid && isAtWar(playerCid, c.id)) {
            atWarBadge = '<span class="war-badge">' + t('war') + '</span>';
            peaceBtn = `<button class="btn-peace" data-enemy-id="${c.id}" style="margin-left:auto;">${t('proposePeace')}</button>`;
        }
        const repVal = Math.round(c.reputation || 0);
        const repColor = repVal >= 0 ? '#88bb88' : '#dd8888';

        html += `<div class="country-row${crisis ? ' country-crisis' : ''}">
            <span class="country-color" style="background:${colorHex}"></span>
            <span class="country-name">${c.name || '?'}${atWarBadge}</span>
            <span class="country-provs">${provCount}</span>
            <span class="country-pop">${popStr}</span>
            <span class="country-treasury">${treasuryStr}</span>
            <span class="country-trend">${trend}</span>
            <span class="country-rep" title="репутация (доверие к договорам)" style="color:${repColor}">${repVal >= 0 ? '+' : ''}${repVal}</span>
            ${peaceBtn}
        </div>`;
    }
    body.innerHTML = html;

    body.querySelectorAll('[data-peace-accept]').forEach(btn => {
        btn.addEventListener('click', () => acceptPeace(parseInt(btn.dataset.peaceAccept)));
    });
    body.querySelectorAll('[data-peace-reject]').forEach(btn => {
        btn.addEventListener('click', () => rejectPeace(parseInt(btn.dataset.peaceReject)));
    });

    body.querySelectorAll('.btn-peace[data-enemy-id]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const enemyId = parseInt(btn.dataset.enemyId);
            const chance = typeof playerPeaceChance === 'function'
                ? playerPeaceChance(enemyId)
                : (shouldBotWantPeace(enemyId, playerCid) ? 1 : 0);
            if (Math.random() < chance) {
                makePeace(playerCid, enemyId);
                addGameLog('Peace accepted!');
            } else {
                addGameLog('Enemy refuses peace');
            }
        });
    });
}

// ---------- LLM панель ----------

let _llmPanelOpen = false;

function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
    return escHtml(s).replace(/"/g, '&quot;');
}

function setupLlmUI() {
    const btn = document.getElementById('llmBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            _llmPanelOpen = !_llmPanelOpen;
            const panel = document.getElementById('llmPanel');
            if (panel) panel.style.display = _llmPanelOpen ? '' : 'none';
        });
    }

    const enabled = document.getElementById('llmEnabled');
    if (enabled) {
        enabled.checked = !!(G.llm && G.llm.enabled);
        enabled.addEventListener('change', () => {
            G.llm.enabled = enabled.checked;
            if (G.llm.enabled) {
                G.llmRound.pendingStart = true;
                addGameLog('LLM agents enabled — следующий ход начнёт раунд');
            } else {
                G.llmRound.state = 'idle';
                addGameLog('LLM agents disabled');
            }
            refreshLlmPanelStatus();
        });
    }

    const roundTicks = document.getElementById('llmRoundTicks');
    if (roundTicks) roundTicks.addEventListener('change', () => {
        const v = parseInt(roundTicks.value);
        if (v >= 10) G.llm.roundTicks = v;
    });

    const deadline = document.getElementById('llmDeadline');
    if (deadline) deadline.addEventListener('change', () => {
        const v = parseInt(deadline.value);
        if (v >= 500) G.llm.deadlineMs = v;
    });

    const maxTok = document.getElementById('llmMaxTokens');
    if (maxTok) maxTok.addEventListener('change', () => {
        const v = parseInt(maxTok.value);
        if (v >= 100) G.llm.maxTokens = v;
    });

    const apiKey = document.getElementById('llmApiKey');
    if (apiKey) {
        apiKey.value = (typeof llmGetStoredApiKey === 'function') ? llmGetStoredApiKey() : '';
        apiKey.addEventListener('change', () => {
            try { localStorage.setItem('llmApiKey', apiKey.value); } catch (e) {}
            if (G.llm) G.llm.apiKey = apiKey.value;
            addGameLog('API key сохранён (применяется ко всем странам без своего ключа)');
        });
    }

    const forceAll = document.getElementById('llmForceAllBtn');
    if (forceAll) forceAll.addEventListener('click', () => {
        const pending = new Set();
        if (G.llmRound && G.llmRound.state === 'collecting' && G.llmRound.responses) {
            for (const cid of Object.keys(G.llmRound.responses)) pending.add(parseInt(cid, 10));
        }
        for (const cid of getLlmCountryIds()) {
            if (!pending.has(cid)) forceLlmCall(cid);
        }
    });
}

function initLlmPanel() {
    if (!countryList) return;
    const wrap = document.getElementById('llmCountries');
    if (!wrap) return;
    let html = '';
    for (const c of countryList) {
        const cfg = llmCountryConfig(c.id);
        const isPlayer = c.id === G.playerCountryId;
        const endpointVal = cfg.endpoint || '';
        const presetMatch = Object.values(LLM_PRESETS).some(p => p.endpoint === endpointVal);
        html += `<div class="llm-row" data-cid="${c.id}">
            <span class="llm-cname">${escHtml(c.name)}${isPlayer ? ' (you)' : ''}</span>
            <select class="llm-mode" data-cid="${c.id}" ${isPlayer ? 'disabled' : ''}>
                <option value="bot" ${cfg.mode === 'bot' ? 'selected' : ''}>bot</option>
                <option value="llm" ${cfg.mode === 'llm' ? 'selected' : ''}>LLM</option>
            </select>
            <select class="llm-endpoint" data-cid="${c.id}">
                ${Object.values(LLM_PRESETS).map(p =>
                    `<option value="${p.endpoint}" ${endpointVal === p.endpoint ? 'selected' : ''}>${p.label}</option>`).join('')}
                <option value="custom" ${presetMatch ? '' : 'selected'}>custom</option>
            </select>
            <input type="text" class="llm-model" data-cid="${c.id}" value="${escAttr(cfg.model)}" title="модель">
            <select class="llm-personality" data-cid="${c.id}">
                ${LLM_PERSONALITIES.map(p =>
                    `<option value="${p}" ${cfg.personality === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
            <input type="number" class="llm-temp" data-cid="${c.id}" step="0.1" min="0" max="1.5" value="${cfg.temperature}" title="temperature">
            <input type="password" class="llm-apikey" data-cid="${c.id}" value="${escAttr(cfg.apiKey || '')}" placeholder="key" title="API key (пусто = глобальный)">
        </div>`;
    }
    wrap.innerHTML = html;

    wrap.querySelectorAll('.llm-mode').forEach(sel => {
        sel.addEventListener('change', () => {
            const cid = parseInt(sel.dataset.cid);
            const cfg = llmCountryConfig(cid);
            cfg.mode = sel.value;
            if (cfg.mode === 'llm' && G.llm.enabled) {
                G.llmRound.pendingStart = true;
                addGameLog(countryList[cid].name + ' → LLM');
            }
            refreshLlmPanelStatus();
        });
    });

    wrap.querySelectorAll('.llm-endpoint').forEach(sel => {
        sel.addEventListener('change', () => {
            const cid = parseInt(sel.dataset.cid);
            const cfg = llmCountryConfig(cid);
            if (sel.value === 'custom') {
                const url = prompt('Endpoint (base URL, напр. http://127.0.0.1:9655):', cfg.endpoint);
                if (url) {
                    cfg.endpoint = url.trim();
                    sel.value = Object.values(LLM_PRESETS).some(p => p.endpoint === cfg.endpoint) ? cfg.endpoint : 'custom';
                } else {
                    sel.value = Object.values(LLM_PRESETS).some(p => p.endpoint === cfg.endpoint) ? cfg.endpoint : 'custom';
                }
            } else {
                cfg.endpoint = sel.value;
                const preset = Object.values(LLM_PRESETS).find(p => p.endpoint === sel.value);
                if (preset && !cfg.model) cfg.model = preset.model;
            }
        });
    });

    wrap.querySelectorAll('.llm-model').forEach(inp => {
        inp.addEventListener('change', () => {
            const cid = parseInt(inp.dataset.cid);
            llmCountryConfig(cid).model = inp.value.trim() || 'deepseek-chat';
        });
    });

    wrap.querySelectorAll('.llm-personality').forEach(sel => {
        sel.addEventListener('change', () => {
            const cid = parseInt(sel.dataset.cid);
            llmCountryConfig(cid).personality = sel.value;
        });
    });

    wrap.querySelectorAll('.llm-temp').forEach(inp => {
        inp.addEventListener('change', () => {
            const cid = parseInt(inp.dataset.cid);
            const v = parseFloat(inp.value);
            llmCountryConfig(cid).temperature = isFinite(v) ? v : 0.5;
        });
    });

    wrap.querySelectorAll('.llm-apikey').forEach(inp => {
        inp.addEventListener('change', () => {
            const cid = parseInt(inp.dataset.cid);
            llmCountryConfig(cid).apiKey = inp.value.trim();
        });
    });

    refreshLlmPanelStatus();
}

let _llmPanelRefreshTimer = null;

function refreshLlmPanelStatus() {
    // Coalescing: pushLlmActivity зовёт панель на каждое событие LLM — не
    // пересобираем DOM десятки раз за секунду (плюс sig-кэши внутри).
    clearTimeout(_llmPanelRefreshTimer);
    _llmPanelRefreshTimer = setTimeout(doRefreshLlmPanelStatus, 120);
}

function doRefreshLlmPanelStatus() {
    const el = document.getElementById('llmStatus');
    if (!el) return;
    if (!countryList) return;
    let html = '';
    for (const c of countryList) {
        const cfg = G.llm.countries[c.id];
        if (!cfg) continue;
        const st = cfg.status || {};
        const stateLabel = st.state || 'idle';
        html += `<div class="llm-status-line">
            <span class="llm-cname">${escHtml(c.name)}</span>
            <span class="llm-state-${stateLabel}">${stateLabel}</span>
            ${st.snapshotLen ? `<span>snap:${st.snapshotLen}b</span>` : ''}
            <span>calls:${st.totalCalls || 0} to:${st.totalTimeouts || 0} err:${st.totalErrors || 0} inv:${st.totalInvalid || 0}</span>
            ${(st.botFallbackRounds || 0) > 0 ? `<span style="color:#dd9944">bot-fallback:${st.botFallbackRounds}</span>` : ''}
            ${st.lastError ? `<span style="color:#dd8888">${escHtml(st.lastError)}</span>` : ''}
            ${st.lastReasoning ? `<details><summary>reasoning</summary><pre>${escHtml(st.lastReasoning)}</pre></details>` : ''}
            ${st.lastActions && st.lastActions.length ? `<details><summary>actions (${st.lastActions.length})</summary><pre>${escHtml(JSON.stringify(st.lastActions))}</pre></details>` : ''}
            ${st.lastSnapshot ? `<details><summary>snapshot</summary><pre>${escHtml(st.lastSnapshot)}</pre></details>` : ''}
            <button class="btn" data-force="${c.id}">force</button>
        </div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-force]').forEach(b => {
        b.addEventListener('click', () => forceLlmCall(parseInt(b.dataset.force)));
    });
    const feedEl = document.getElementById('llmActivity');
    if (feedEl) {
        const feed = (G.llm && G.llm.activity) || [];
        if (feed.length === 0) {
            feedEl.innerHTML = '<div class="llm-feed-empty">пока нет событий</div>';
        } else {
            feedEl.innerHTML = '<div class="llm-feed-title">События LLM (по раундам):</div>' +
                feed.slice().reverse().map(e =>
                    `<div class="llm-feed-line" data-cid="${e.cid}"><span class="llm-feed-time">${e.t}</span> <b>${escHtml(e.name)}:</b> ${escHtml(e.text)}</div>`
                ).join('');
        }
    }
    refreshTreatiesUI();
    updatePlayerLettersUI();
}

function refreshTreatiesUI() {
    const el = document.getElementById('llmTreaties');
    if (!el) return;
    const playerCid = G.playerCountryId;
    const active = getActiveTreatiesFor(playerCid);
    const offers = getIncomingProposals(playerCid);
    const myProvinces = playerCid >= 0 && countryList[playerCid] ? countryList[playerCid].provinces.join(',') : '';
    // Сигнатурный кэш: пересобираем DOM только при реальном изменении, иначе
    // ввод игрока (селекты/поля договора) сбрасывается на каждом событии LLM.
    const sig = [playerCid, myProvinces,
        active.map(t => [t.id, t.type, t.status, t.turnExpires, t.terms && t.terms.gold_per_turn].join(':')).join('|'),
        offers.map(p => [p.id, p.type, p.lastOfferBy, p.counterCount, JSON.stringify(p.terms)].join(':')).join('|')
    ].join('#');
    if (sig === refreshTreatiesUI._sig) return;
    refreshTreatiesUI._sig = sig;

    let html = '<div class="treaty-title">Treaties (договоры)</div>';
    if (!active.length) html += '<div style="color:#6a7a9a;">нет активных договоров</div>';
    for (const t of active) {
        const other = t.a === playerCid ? t.b : t.a;
        const oc = countryList[other];
        const remaining = Math.max(0, t.turnExpires - G.turnNumber);
        html += `<div class="treaty-item"><b>${escHtml(treatyTypeLabel(t.type))}</b> с ${escHtml(oc ? oc.name : '?')} — ещё ${remaining} ходов
            <button class="btn" data-break="${t.id}">разорвать</button></div>`;
    }
    html += '<div class="treaty-title">Incoming offers (входящие)</div>';
    if (!offers.length) html += '<div style="color:#6a7a9a;">нет оферт</div>';
    for (const p of offers) {
        const oc = countryList[p.lastOfferBy];
        const desc = [];
        desc.push(p.terms.duration + ' ходов');
        if (p.type === 'tribute') desc.push(p.terms.gold_per_turn + ' зол/ход');
        if (p.type === 'province_transfer') desc.push('провинция P' + p.terms.province_id);
        html += `<div class="treaty-item">${escHtml(oc ? oc.name : '?')}: <b>${escHtml(treatyTypeLabel(p.type))}</b> (${desc.join(', ')})
            <button class="btn" data-accept="${p.id}">принять</button>
            <button class="btn" data-reject="${p.id}">отклонить</button>
            <button class="btn" data-counter="${p.id}">контр</button></div>`;
    }
    html += '<div class="treaty-title">Предложить договор</div>';
    html += '<select id="treatyType">' + TREATY_TYPES.map(t => `<option value="${t}">${escHtml(treatyTypeLabel(t))}</option>`).join('') + '</select>';
    html += '<select id="treatyTarget">' + countryList.filter(c => c.id !== playerCid && c.provinces.length > 0)
        .map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('') + '</select>';
    html += '<input id="treatyDuration" type="number" value="10" min="1" max="60" title="ходы">';
    html += '<input id="treatyGold" type="number" value="50" min="1" max="1000" title="золота/ход (для дани)">';
    const transferProvs = playerCid >= 0 && countryList[playerCid]
        ? countryList[playerCid].provinces.filter(pid => {
            const p = provinceList[pid];
            return p && p.cells > 0 && pid !== countryList[playerCid].capital &&
                !(G.captures || []).some(c => c.isActive && c.targetProvinceId === pid);
          })
        : [];
    html += '<select id="treatyProvince" style="display:none;" title="провинция для передачи">' +
        transferProvs.map(pid => `<option value="${pid}">P${pid}</option>`).join('') + '</select>';
    html += '<button class="btn" id="treatyProposeBtn">Предложить</button>';
    el.innerHTML = html;

    const onT = (id, fn) => {
        const b = document.getElementById(id);
        if (b) b.addEventListener('click', fn);
    };
    const typeSel = document.getElementById('treatyType');
    if (typeSel) {
        typeSel.addEventListener('change', () => {
            const pv = document.getElementById('treatyProvince');
            if (pv) pv.style.display = typeSel.value === 'province_transfer' ? '' : 'none';
        });
    }
    onT('treatyProposeBtn', () => {
        const type = document.getElementById('treatyType').value;
        const target = parseInt(document.getElementById('treatyTarget').value);
        const duration = parseInt(document.getElementById('treatyDuration').value) || 10;
        const gold = parseInt(document.getElementById('treatyGold').value) || 0;
        const terms = { duration };
        if (type === 'tribute') terms.gold_per_turn = gold;
        if (type === 'province_transfer') {
            const pv = document.getElementById('treatyProvince');
            if (!pv || pv.value === '') {
                addGameLog('Нет провинций для передачи');
                return;
            }
            terms.province_id = parseInt(pv.value);
        }
        const prop = createTreatyProposal(playerCid, target, type, terms);
        addGameLog(prop ? 'Treaty proposal sent' : 'Не удалось предложить договор');
        refreshTreatiesUI();
    });
    el.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => {
        if (acceptTreatyProposal(parseInt(b.dataset.accept), playerCid)) addGameLog('Treaty accepted');
        refreshTreatiesUI();
    }));
    el.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => {
        rejectTreatyProposal(parseInt(b.dataset.reject), playerCid);
        refreshTreatiesUI();
    }));
    el.querySelectorAll('[data-counter]').forEach(b => b.addEventListener('click', () => {
        const gold = parseInt(document.getElementById('treatyGold').value) || 0;
        const duration = parseInt(document.getElementById('treatyDuration').value) || 10;
        const pid = parseInt(b.dataset.counter);
        const prop = getProposalById(pid);
        const terms = { duration };
        if (prop && prop.type === 'tribute') terms.gold_per_turn = gold;
        counterTreatyProposal(pid, playerCid, terms);
        addGameLog('Counter-offer sent');
        refreshTreatiesUI();
    }));
    el.querySelectorAll('[data-break]').forEach(b => b.addEventListener('click', () => {
        if (terminateTreaty(parseInt(b.dataset.break), playerCid)) addGameLog('Treaty broken');
        refreshTreatiesUI();
    }));
}

function updatePlayerLettersUI() {
    const el = document.getElementById('llmPlayerLetters');
    if (!el) return;
    const playerCid = G.playerCountryId;
    const allLetters = G.letterQueue || [];
    // Сигнатурный кэш: не пересобираем DOM, пока письма не изменились —
    // иначе текст в textarea и фокус теряются при активности LLM-агентов.
    const recentSig = allLetters.slice(-10).map(l => l.id + ':' + l.read + ':' + l.toCountryId).join('|');
    const sig = playerCid + '#' + allLetters.length + '#' + recentSig;
    if (sig === updatePlayerLettersUI._sig) return;
    updatePlayerLettersUI._sig = sig;

    let html = '<div style="color:#a0b0d0;margin-bottom:2px;">Переписка (все письма)</div>';
    const recent = allLetters.slice(-10).reverse();
    if (!recent.length) html += '<div style="color:#6a7a9a;">писем пока нет</div>';
    for (const l of recent) {
        const from = countryList[l.fromCountryId];
        const to = countryList[l.toCountryId];
        const isToPlayer = l.toCountryId === playerCid;
        html += `<div class="letter-item"><b>${from ? escHtml(from.name) : '?'}</b> → <b>${to ? escHtml(to.name) : '?'}</b> (r${l.sentRound}): ${escHtml(l.text)}${isToPlayer ? ' <span style="color:#88bb88;">[вам]</span>' : ''}</div>`;
    }
    if (playerCid >= 0) {
        const targets = countryList.filter(c => c.id !== playerCid && c.provinces.length > 0);
        html += `<select id="letterTarget">${targets.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}</select>`;
        html += '<textarea id="letterText" placeholder="текст письма..."></textarea>';
        html += '<button class="btn" id="letterSendBtn">Отправить</button>';
    }
    el.innerHTML = html;
    const sendBtn = document.getElementById('letterSendBtn');
    if (sendBtn) sendBtn.addEventListener('click', () => {
        const t = parseInt(document.getElementById('letterTarget').value);
        const text = (document.getElementById('letterText').value || '').slice(0, 400);
        if (!text.trim()) return;
        if (typeof sendLetter === 'function') {
            sendLetter(playerCid, t, text);
        } else {
            if (!G._letterIdCounter) G._letterIdCounter = 0;
            G.letterQueue.push({ id: ++G._letterIdCounter, fromCountryId: playerCid, toCountryId: t, text, sentRound: G.turnNumber, read: false });
        }
        addGameLog('Letter sent to ' + countryList[t].name);
        updatePlayerLettersUI();
    });
}
