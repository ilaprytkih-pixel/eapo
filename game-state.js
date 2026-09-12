let shipIdCounter = 0;

const G = {
    playerCountryId: -1,
    captures: [],
    fleetAnims: [],
    ships: [],
    selectedProvinceId: null,
    isPaused: false,
    turnNumber: 0,
    tickCount: 0,
    lastTickTime: 0,
    params: {
        attackRate: 0.05,
        defenseRate: 0.03,
        tickInterval: 200,
        botIntervalTicks: 10,
        growthRate: 0.015,
        taxRate: 0.05,
        armyUpkeepRate: 0.005,
        infraUpkeepRate: 0.003,
        portCost: 1000,
        shipCost: 150,
        shipCapacity: 1500,
        portUpkeep: 2,
        shipUpkeep: 0.5,
        maxShipsPerPort: 12,
        fleetTravelMs: 2600,
        shipMoveSpeed: 3600,
        flankDefensePenalty: 0.20,
        flankMaxFronts: 5
    },
    isPlayerSelectPhase: true,
    wars: new Map(),
    diplomacyInitialized: false,
    waterRegionOf: null,
    waterIsOcean: [],
    llm: {
        enabled: false,
        roundTicks: 30,
        deadlineMs: 15000,
        maxTokens: 400,
        temperature: 0.5,
        countries: {}
    },
    llmRound: { state: 'idle', roundNumber: 0, startedTick: 0, pendingStart: false, responses: {} },
    letterQueue: [],
    treaties: [],
    treatyProposals: []
};

function initGameState(keepData) {
    for (const pr of provinceList) {
        if (!keepData) pr.army = Math.max(10, Math.round(pr.cells / 50));
        pr.captureProgress = [];
        pr.cellIndices = [];
        if (!keepData) pr.port = { built: false, ships: 0, buildTimer: 0, vx: -1, vy: -1 };
        pr.seaZones = new Set();
    }
    for (let i = 0; i < COLS * ROWS; i++) {
        const pid = provinceOf[i];
        if (pid >= 0) provinceList[pid].cellIndices.push(i);
    }
    for (const pr of provinceList) {
        if (pr.cellIndices.length > 1) {
            const cx = pr.cx, cy = pr.cy;
            pr.cellIndices.sort((a, b) => {
                const ax = a % COLS, ay = (a / COLS) | 0;
                const bx = b % COLS, by = (b / COLS) | 0;
                const da = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
                const db = (bx - cx) * (bx - cx) + (by - cy) * (by - cy);
                return db - da;
            });
        }
    }

    for (const pr of provinceList) {
        if (pr.cells <= 0) continue;
        const biome = getBiomeName(heightMap[pr.cy | 0][pr.cx | 0], moistMap[pr.cy | 0][pr.cx | 0], latMap[pr.cy | 0][pr.cx | 0]);
        pr.biome = biome;
        if (!keepData) {
            const growthMult = BIOME_GROWTH[biome] || 0.8;
            pr.population = Math.max(10, Math.round(pr.cells * 2 * growthMult));
            const infraCap = BIOME_INFRA_CAP[biome] || 50;
            pr.infrastructure = Math.max(10, Math.round(infraCap * 0.3 + (seededRandom() * infraCap * 0.4)));
        }
    }

    cacheCoastalProvinces();
    if (typeof cacheCoastalWaterAccess === 'function') cacheCoastalWaterAccess();

    for (const c of countryList) {
        if (!keepData) {
            c.treasury = c.provinces.reduce((s, pid) => s + (provinceList[pid].population || 0), 0) * 2;
            c.treasuryHistory = [c.treasury];
        }
        c.crisisTurns = 0;
    }

    G.captures = [];
    G.fleetAnims = [];
    G.ships = [];
    G.playerCountryId = -1;
    G.playerProvinceSet = new Set();
    G.isPlayerSelectPhase = true;
    G.selectedProvinceId = null;
    G.isPaused = false;
    G.turnNumber = 0;
    G.tickCount = 0;
    G.lastTickTime = 0;
    G.wars = new Map();
    G.llmRound = { state: 'idle', roundNumber: 0, startedTick: 0, pendingStart: false, responses: {} };
    G.letterQueue = [];
    G.treaties = [];
    G.treatyProposals = [];
    G._treatyIdCounter = 0;
    G._proposalIdCounter = 0;

    for (const c of countryList) {
        c.relations = {};
        c.gracePeriod = 15 + Math.floor(seededRandom() * 10);
        c.warExhaustion = 0;
        c.peaceGracePeriod = 0;
        c._peaceProposalFrom = null;
        c.reputation = 0;
    }
    rebuildPlayerProvinceSet();
}

function selectPlayerCountry(countryId) {
    G.playerCountryId = countryId;
    rebuildPlayerProvinceSet();
    G.isPlayerSelectPhase = false;
    removeOverlay();
}

function removeOverlay() {
    const el = document.getElementById('selectOverlay');
    if (el) el.remove();
}

function getProvinceAtPixel(mx, my) {
    const cx = Math.floor(mx / pixelSize);
    const cy = Math.floor(my / pixelSize);
    if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
        const pid = provinceMap ? provinceMap[cy * COLS + cx] : -1;
        if (pid >= 0) return provinceList[pid];
    }
    let best = null, bestDist = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            const pid = provinceMap ? provinceMap[ny * COLS + nx] : -1;
            if (pid < 0) continue;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) { bestDist = dist; best = provinceList[pid]; }
        }
    }
    return best;
}

function getCountryAtPixel(mx, my) {
    const cx = Math.floor(mx / pixelSize);
    const cy = Math.floor(my / pixelSize);
    if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
        return countryMap ? countryMap[cy * COLS + cx] : -1;
    }
    let best = -1, bestDist = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            const cid = countryMap ? countryMap[ny * COLS + nx] : -1;
            if (cid < 0) continue;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) { bestDist = dist; best = cid; }
        }
    }
    return best;
}

function isOwnProvince(province) {
    return G.playerCountryId >= 0 && G.playerProvinceSet.has(province.id);
}

function rebuildPlayerProvinceSet() {
    if (G.playerCountryId < 0) { G.playerProvinceSet = new Set(); return; }
    const c = countryList[G.playerCountryId];
    G.playerProvinceSet = new Set(c.provinces);
}

function isCoastalProvince(pid) {
    const pr = provinceList[pid];
    if (!pr || !pr.cellIndices || pr.cells <= 0) return false;
    return pr.isCoastal === true;
}

function cacheCoastalProvinces() {
    if (!provinceList || !heightMap) return;
    for (const pr of provinceList) {
        if (!pr.cellIndices || pr.cells <= 0) { pr.isCoastal = false; continue; }
        let coastal = false;
        for (const idx of pr.cellIndices) {
            const x = idx % COLS, y = (idx / COLS) | 0;
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                if (heightMap[ny][nx] <= 0.5) { coastal = true; break; }
            }
            if (coastal) break;
        }
        pr.isCoastal = coastal;
    }
}

function findWaterPath(fromX, fromY, toX, toY) {
    if (heightMap[fromY] === undefined || heightMap[fromY][fromX] === undefined) return null;
    if (heightMap[toY] === undefined || heightMap[toY][toX] === undefined) return null;
    if (heightMap[fromY][fromX] > 0.5 || heightMap[toY][toX] > 0.5) return null;

    const visited = new Uint8Array(COLS * ROWS);
    const prev = new Int32Array(COLS * ROWS);
    const queue = [[fromX, fromY]];
    let head = 0;
    visited[fromY * COLS + fromX] = 1;
    prev[fromY * COLS + fromX] = -1;

    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
    let found = false;
    let cur;
    while (head < queue.length) {
        cur = queue[head++];
        const [cx, cy] = cur;
        if (cx === toX && cy === toY) { found = true; break; }
        for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            if (heightMap[ny][nx] > 0.5) continue;
            const nidx = ny * COLS + nx;
            if (visited[nidx]) continue;
            visited[nidx] = 1;
            prev[nidx] = cy * COLS + cx;
            queue.push([nx, ny]);
        }
    }
    if (!found) return null;

    const path = [];
    let cx = toX, cy = toY;
    while (cx !== fromX || cy !== fromY) {
        path.push([cx, cy]);
        const pidx = prev[cy * COLS + cx];
        if (pidx < 0) break;
        cx = pidx % COLS;
        cy = (pidx / COLS) | 0;
    }
    path.push([fromX, fromY]);
    path.reverse();

    const step = Math.max(3, Math.floor(path.length / 30));
    const waypoints = [];
    for (let i = 0; i < path.length; i += step) {
        waypoints.push({ x: path[i][0] * pixelSize + pixelSize / 2, y: path[i][1] * pixelSize + pixelSize / 2 });
    }
    const last = path[path.length - 1];
    waypoints.push({ x: last[0] * pixelSize + pixelSize / 2, y: last[1] * pixelSize + pixelSize / 2 });
    return waypoints;
}

function updateShips(frameDt) {
    if (!G.ships) return;
    const speed = G.params.shipMoveSpeed || 3600;
    for (const ship of G.ships) {
        if (ship.state !== 'sailing' || !ship.path || ship.path.length < 2) continue;
        const totalSegs = ship.path.length - 1;
        ship.progress = (ship.progress || 0) + frameDt / speed;
        if (ship.progress >= 1) {
            const destId = ship.targetProvinceId;

            ship.progress = 0;
            ship.pathIndex = 0;

            if (ship.transportSrcPortId != null && destId != null) {
                const destProv = provinceList[destId];
                const destPort = destProv && destProv.port && destProv.port.built && destProv.port.vx >= 0 ? destProv.port : null;
                const stillMine = destProv ? findCountryOfProvince(destId) === ship.ownerCid : false;
                // Войска высаживаются только если провинция всё ещё наша.
                // Если цель захвачена в рейсе — войска НЕ сгорают: корабль увозит их домой.
                if (ship.payload > 0 && stillMine && destProv) {
                    destProv.army = (destProv.army || 0) + ship.payload;
                    ship.payload = 0;
                }

                const canDock = destPort && stillMine && destPort.ships < G.params.maxShipsPerPort;
                if (canDock) {
                    // В порту назначения есть место — корабль остаётся там.
                    ship.portProvinceId = destId;
                    destPort.ships = Math.min(destPort.ships + 1, G.params.maxShipsPerPort);
                    ship.x = destPort.vx * pixelSize + pixelSize / 2;
                    ship.y = destPort.vy * pixelSize + pixelSize / 2;
                    ship.state = 'idle';
                    ship.path = null;
                    ship.targetProvinceId = null;
                    ship.transportSrcPortId = null;
                    continue;
                }
                // Провинция захвачена, порт переполнен или нет порта — возвращаемся
                // в порт отправки.
                const srcPortProv = provinceList[ship.transportSrcPortId];
                const srcPort = srcPortProv && srcPortProv.port;
                let fromX = -1, fromY = -1;
                if (destProv && destProv.port && destProv.port.vx >= 0) {
                    fromX = destProv.port.vx;
                    fromY = destProv.port.vy;
                } else if (destProv) {
                    const landPos = findPortVisualPosition(destProv);
                    if (landPos) {
                        fromX = landPos.vx;
                        fromY = landPos.vy;
                    }
                }
                if (srcPort && srcPort.vx >= 0 && fromX >= 0) {
                    const backPath = findWaterPath(fromX, fromY, srcPort.vx, srcPort.vy);
                    if (backPath) {
                        ship.path = backPath;
                        ship.pathIndex = 0;
                        ship.progress = 0;
                        ship.targetProvinceId = ship.transportSrcPortId;
                        ship.transportSrcPortId = null;
                        // Корабль вернётся в порт, чей счётчик был уменьшен при отплытии
                        ship.returningHome = true;
                        continue;
                    }
                }
                // Нет пути обратно — корабль потерян вместе с грузом.
                ship.state = 'used';
                ship.payload = 0;
                ship.path = null;
                ship.targetProvinceId = null;
                ship.transportSrcPortId = null;
                continue;
            }

            ship.state = 'idle';
            ship.path = null;
            if (destId != null) {
                const prevPort = provinceList[ship.portProvinceId];
                ship.portProvinceId = destId;
                const newPort = provinceList[ship.portProvinceId];
                // Док разрешён только в порт, всё ещё принадлежащий владельцу корабля
                // (порт мог быть захвачен за время рейса — «докование» к врагу дало бы
                // ему бесплатный корабль).
                const portStillMine = newPort && newPort.cells > 0 &&
                    findCountryOfProvince(newPort.id) === ship.ownerCid;
                if (newPort && newPort.port && newPort.port.built && portStillMine &&
                    (prevPort !== newPort || ship.returningHome)) {
                    // +1 при прибытии в любой свой порт, включая возврат домой (returningHome)
                    newPort.port.ships = Math.min(newPort.port.ships + 1, G.params.maxShipsPerPort);
                    // Вернувшийся транспорт привозит войска домой, если цель рейса была потеряна
                    if (ship.payload > 0) {
                        newPort.army = (newPort.army || 0) + ship.payload;
                        if (typeof addGameLog === 'function') {
                            addGameLog('Транспорт вернулся с войсками в P' + newPort.id + ' (+' + ship.payload + ')');
                        }
                        ship.payload = 0;
                    }
                } else if (newPort && newPort.port && newPort.port.built && !portStillMine) {
                    // Родной порт захвачен врагом — корабль потерян вместе с грузом.
                    ship.state = 'used';
                    ship.payload = 0;
                    if (typeof addGameLog === 'function') {
                        addGameLog('Ship lost: port P' + newPort.id + ' captured during voyage');
                    }
                }
                if (ship.returningHome) ship.returningHome = false;
            }
            const portProv = provinceList[ship.portProvinceId];
            if (portProv && portProv.port && portProv.port.vx >= 0) {
                ship.x = portProv.port.vx * pixelSize + pixelSize / 2;
                ship.y = portProv.port.vy * pixelSize + pixelSize / 2;
            }
            continue;
        }
        const segIdx = Math.min(Math.floor(ship.progress * totalSegs), totalSegs - 1);
        ship.pathIndex = segIdx;
        const segProgress = (ship.progress * totalSegs) - segIdx;
        const p0 = ship.path[segIdx];
        const p1 = ship.path[Math.min(segIdx + 1, ship.path.length - 1)];
        ship.x = p0.x + (p1.x - p0.x) * segProgress;
        ship.y = p0.y + (p1.y - p0.y) * segProgress;
    }
}

function findPortVisualPosition(province) {
    if (!province.cellIndices || !province.isCoastal) return null;
    const coastalCells = [];
    for (const idx of province.cellIndices) {
        const x = idx % COLS, y = (idx / COLS) | 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            if (heightMap[ny][nx] <= 0.5) { coastalCells.push({ wx: nx, wy: ny }); break; }
        }
    }
    if (coastalCells.length === 0) return null;
    return { vx: coastalCells[0].wx, vy: coastalCells[0].wy };
}

const AUTOSAVE_VERSION = 2;
const AUTOSAVE_KEY = 'eapo_autosave_v1';

// Полный снимок состояния для автосохранения.
// Карты/провинции/страны/войны/договоры/письма/корабли/счётчики/LLM-конфиг.
// apiKey НЕ сохраняется (секрет) — при загрузке подтянется из localStorage.
function saveFullGameState(storage) {
    try {
        const st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        const save = {
            _meta: { version: AUTOSAVE_VERSION, savedAt: Date.now(), turnNumber: G.turnNumber },
            map: {
                ROWS: ROWS,
                COLS: COLS,
                seed: (typeof seed !== 'undefined') ? seed : null,
                heightMap: heightMap,
                moistMap: moistMap,
                latMap: latMap,
                provinceOf: Array.from(provinceOf)
            },
            provinces: provinceList.map(p => ({
                id: p.id,
                cells: p.cells,
                cx: p.cx,
                cy: p.cy,
                sumX: p.sumX,
                sumY: p.sumY,
                neighbors: [...(p.neighbors || [])],
                population: p.population,
                infrastructure: p.infrastructure,
                army: p.army,
                biome: p.biome,
                port: p.port ? { built: !!p.port.built, ships: p.port.ships || 0, buildTimer: p.port.buildTimer || 0, vx: p.port.vx, vy: p.port.vy, waterRegionId: p.port.waterRegionId } : null
            })),
            countries: countryList.map(c => ({
                id: c.id,
                name: c.name,
                capital: c.capital,
                provinces: (c.provinces || []).slice(),
                labelX: c.labelX,
                labelY: c.labelY,
                treasury: c.treasury || 0,
                treasuryHistory: c.treasuryHistory || [c.treasury || 0],
                crisisTurns: c.crisisTurns || 0,
                relations: c.relations || {},
                reputation: c.reputation || 0,
                warExhaustion: c.warExhaustion || 0,
                peaceGracePeriod: c.peaceGracePeriod || 0,
                gracePeriod: c.gracePeriod || 0,
                llmMemory: c.llmMemory || null
            })),
            G: {
                playerCountryId: G.playerCountryId,
                turnNumber: G.turnNumber,
                tickCount: G.tickCount,
                params: G.params,
                _treatyIdCounter: G._treatyIdCounter || 0,
                _proposalIdCounter: G._proposalIdCounter || 0,
                _letterIdCounter: G._letterIdCounter || 0
            },
            wars: [...(G.wars || [])].map(([k, w]) => ({
                a: w.a, b: w.b,
                heat: w.heat, lastCombatTurn: w.lastCombatTurn, warStartTurn: w.warStartTurn,
                provincesAtStart: w.provincesAtStart
            })),
            treaties: (G.treaties || []).map(t => ({
                id: t.id, type: t.type, a: t.a, b: t.b,
                terms: Object.assign({}, t.terms),
                turnSigned: t.turnSigned, turnExpires: t.turnExpires,
                status: t.status, brokenBy: t.brokenBy || null, brokenTurn: t.brokenTurn || null,
                executed: !!t.executed
            })),
            treatyProposals: (G.treatyProposals || []).map(p => ({
                id: p.id, type: p.type, from: p.from, to: p.to,
                lastOfferBy: p.lastOfferBy, terms: Object.assign({}, p.terms),
                turnProposed: p.turnProposed, status: p.status, counterCount: p.counterCount
            })),
            letterQueue: (G.letterQueue || []).map(l => ({
                id: l.id, fromCountryId: l.fromCountryId, toCountryId: l.toCountryId,
                text: l.text, sentRound: l.sentRound, read: !!l.read
            })),
            ships: (G.ships || []).map(s => ({
                id: s.id, ownerCid: s.ownerCid, homeProvinceId: s.homeProvinceId,
                portProvinceId: s.portProvinceId, targetProvinceId: s.targetProvinceId,
                x: s.x, y: s.y, targetX: s.targetX, targetY: s.targetY,
                path: s.path, pathIndex: s.pathIndex || 0, progress: s.progress || 0,
                state: s.state, speed: s.speed, payload: s.payload, transportSrcPortId: s.transportSrcPortId
            })),
            llm: G.llm ? {
                enabled: !!G.llm.enabled,
                roundTicks: G.llm.roundTicks, deadlineMs: G.llm.deadlineMs,
                maxTokens: G.llm.maxTokens, temperature: G.llm.temperature,
                countries: (() => {
                    const out = {};
                    for (const cid in (G.llm.countries || {})) {
                        const cfg = G.llm.countries[cid];
                        if (!cfg) continue;
                        out[cid] = {
                            mode: cfg.mode, endpoint: cfg.endpoint, model: cfg.model,
                            temperature: cfg.temperature, personality: cfg.personality,
                            status: cfg.status ? Object.assign({}, cfg.status) : null
                        };
                    }
                    return out;
                })()
            } : null
        };
        if (st && typeof st.setItem === 'function') {
            st.setItem(AUTOSAVE_KEY, JSON.stringify(save));
        }
        return save;
    } catch (e) {
        return null;
    }
}

// Восстановление автосохранения. version-мисматч => отказ (миграции нет).
function loadFullGameState(json) {
    try {
        const data = typeof json === 'string' ? JSON.parse(json) : json;
        if (!data || !data._meta) return { ok: false, reason: 'parse', msg: 'Повреждённый автосейв' };
        if (data._meta.version !== AUTOSAVE_VERSION) {
            return { ok: false, reason: 'version', msg: 'Автосейв устарел, начните новую игру' };
        }
        const m = data.map;
        if (!m || !m.heightMap || !m.provinceOf) return { ok: false, reason: 'parse', msg: 'Повреждённый автосейв' };
        if (m.ROWS !== ROWS || m.COLS !== COLS) {
            // Сейв может быть от карты другого размера — принимаем его размеры
            COLS = m.COLS;
            ROWS = m.ROWS;
            const mw = typeof document !== 'undefined' ? document.getElementById('mapWidth') : null;
            const mh = typeof document !== 'undefined' ? document.getElementById('mapHeight') : null;
            if (mw) { mw.value = COLS; }
            if (mh) { mh.value = ROWS; }
            const mwv = typeof document !== 'undefined' ? document.getElementById('mapWidthVal') : null;
            const mhv = typeof document !== 'undefined' ? document.getElementById('mapHeightVal') : null;
            if (mwv) mwv.textContent = COLS;
            if (mhv) mhv.textContent = ROWS;
            if (typeof setCanvasSize === 'function') setCanvasSize();
        }
        // Массивы мутируем на месте (не переприсваиваем): внешние ссылки
        // (тесты, обработчики) должны видеть обновлённые данные.
        const setRows = (target, rows) => {
            target.length = 0;
            for (const r of rows) target.push(r.slice ? r.slice() : r);
        };
        setRows(heightMap, m.heightMap);
        setRows(moistMap, m.moistMap);
        setRows(latMap, m.latMap);
        if (typeof seed !== 'undefined' && m.seed != null) seed = m.seed;
        // При другом размере карты длина иная — переприсваиваем
        // (rebuildCountryMap в конце обновит provinceMap)
        if (provinceOf.length !== m.provinceOf.length) {
            provinceOf = new Int16Array(m.provinceOf);
        } else {
            provinceOf.set(new Int16Array(m.provinceOf));
        }

        const newProvinces = data.provinces.map(p => {
            const port = p.port ? { built: p.port.built, ships: p.port.ships, buildTimer: p.port.buildTimer, vx: p.port.vx, vy: p.port.vy, waterRegionId: p.port.waterRegionId } : { built: false, ships: 0, buildTimer: 0, vx: -1, vy: -1 };
            return {
                id: p.id,
                cells: p.cells,
                sumX: p.sumX != null ? p.sumX : p.cx * p.cells,
                sumY: p.sumY != null ? p.sumY : p.cy * p.cells,
                cx: p.cx,
                cy: p.cy,
                neighbors: new Set(p.neighbors || []),
                population: p.population || Math.max(10, Math.round(p.cells * 2)),
                infrastructure: p.infrastructure || 50,
                army: p.army || Math.max(10, Math.round(p.cells / 50)),
                port,
                biome: p.biome || getBiomeName(heightMap[p.cy | 0][p.cx | 0], moistMap[p.cy | 0][p.cx | 0], latMap[p.cy | 0][p.cx | 0]),
                captureProgress: [],
                cellIndices: [],
                seaZones: new Set()
            };
        });
        provinceList.length = 0;
        for (const pr of newProvinces) provinceList.push(pr);

        const newCountries = data.countries.map(c => ({
            id: c.id,
            name: c.name,
            capital: c.capital,
            provinces: [...c.provinces],
            labelX: c.labelX,
            labelY: c.labelY,
            treasury: c.treasury || 0,
            treasuryHistory: c.treasuryHistory || [c.treasury || 0],
            crisisTurns: c.crisisTurns || 0,
            relations: c.relations || {},
            reputation: c.reputation || 0,
            // Fallback на старые имена полей (exhaustion/peaceGrace) — сейвы v2
            // до фикса сохраняли warExhaustion/peaceGracePeriod под неверными ключами.
            warExhaustion: c.warExhaustion != null ? c.warExhaustion : (c.exhaustion || 0),
            peaceGracePeriod: c.peaceGracePeriod != null ? c.peaceGracePeriod : (c.peaceGrace || 0),
            gracePeriod: c.gracePeriod || 0,
            llmMemory: c.llmMemory || null
        }));
        countryList.length = 0;
        for (const c of newCountries) countryList.push(c);

        for (let i = 0; i < COLS * ROWS; i++) {
            const pid = provinceOf[i];
            if (pid >= 0 && provinceList[pid]) provinceList[pid].cellIndices.push(i);
        }
        for (const pr of provinceList) {
            if (pr.cellIndices.length > 1) {
                pr.cellIndices.sort((a, b) => {
                    const ax = a % COLS, ay = (a / COLS) | 0;
                    const bx = b % COLS, by = (b / COLS) | 0;
                    const da = (ax - pr.cx) * (ax - pr.cx) + (ay - pr.cy) * (ay - pr.cy);
                    const db = (bx - pr.cx) * (bx - pr.cx) + (by - pr.cy) * (by - pr.cy);
                    return db - da;
                });
            }
        }

        const g = data.G || {};
        G.playerCountryId = g.playerCountryId != null ? g.playerCountryId : -1;
        G.turnNumber = g.turnNumber || 0;
        G.tickCount = g.tickCount || 0;
        if (g.params) Object.assign(G.params, g.params);
        G._treatyIdCounter = g._treatyIdCounter || 0;
        G._proposalIdCounter = g._proposalIdCounter || 0;
        G._letterIdCounter = g._letterIdCounter || 0;
        G.captures = [];
        G.fleetAnims = [];
        G.playerProvinceSet = new Set();
        G.isPaused = false;
        G.isPlayerSelectPhase = false;
        G.diplomacyInitialized = true;

        G.wars = new Map();
        for (const w of (data.wars || [])) {
            const k = typeof warKey === 'function' ? warKey(w.a, w.b) : (w.a < w.b ? w.a + ':' + w.b : w.b + ':' + w.a);
            G.wars.set(k, { a: w.a, b: w.b, heat: w.heat, lastCombatTurn: w.lastCombatTurn, warStartTurn: w.warStartTurn, provincesAtStart: w.provincesAtStart });
        }
        G.treaties = (data.treaties || []).map(t => ({
            id: t.id, type: t.type, a: t.a, b: t.b,
            terms: Object.assign({}, t.terms),
            turnSigned: t.turnSigned, turnExpires: t.turnExpires,
            status: t.status, brokenBy: t.brokenBy || null, brokenTurn: t.brokenTurn || null,
            executed: !!t.executed
        }));
        G.treatyProposals = (data.treatyProposals || []).map(p => ({
            id: p.id, type: p.type, from: p.from, to: p.to,
            lastOfferBy: p.lastOfferBy, terms: Object.assign({}, p.terms),
            turnProposed: p.turnProposed, status: p.status, counterCount: p.counterCount
        }));
        G.letterQueue = (data.letterQueue || []).map(l => ({
            id: l.id, fromCountryId: l.fromCountryId, toCountryId: l.toCountryId,
            text: l.text, sentRound: l.sentRound, read: !!l.read
        }));
        G.ships = (data.ships || []).map(s => ({
            id: s.id, ownerCid: s.ownerCid, homeProvinceId: s.homeProvinceId,
            portProvinceId: s.portProvinceId, targetProvinceId: s.targetProvinceId,
            x: s.x, y: s.y, targetX: s.targetX, targetY: s.targetY,
            path: s.path, pathIndex: s.pathIndex || 0, progress: s.progress || 0,
            state: s.state, speed: s.speed, payload: s.payload, transportSrcPortId: s.transportSrcPortId
        }));
        shipIdCounter = (data.ships || []).reduce((mx, s) => Math.max(mx, (s.id || 0) + 1), 0);

        if (data.llm && G.llm) {
            G.llm.enabled = !!data.llm.enabled;
            if (data.llm.roundTicks != null) G.llm.roundTicks = data.llm.roundTicks;
            if (data.llm.deadlineMs != null) G.llm.deadlineMs = data.llm.deadlineMs;
            if (data.llm.maxTokens != null) G.llm.maxTokens = data.llm.maxTokens;
            if (data.llm.temperature != null) G.llm.temperature = data.llm.temperature;
            G.llm.countries = {};
            for (const cid in (data.llm.countries || {})) {
                const cfg = data.llm.countries[cid];
                const base = typeof llmCountryConfig === 'function' ? llmCountryConfig(parseInt(cid)) : {};
                G.llm.countries[cid] = Object.assign(base, cfg, { status: cfg.status ? Object.assign({}, cfg.status) : null });
            }
        }

        lightMap = null;
        _mapDirty = true;
        if (typeof rebuildCountryMap === 'function') rebuildCountryMap();
        if (typeof cacheCoastalProvinces === 'function') cacheCoastalProvinces();
        if (typeof rebuildWaterRegions === 'function') rebuildWaterRegions();
        if (typeof cacheCoastalWaterAccess === 'function') cacheCoastalWaterAccess();
        if (typeof rebuildPlayerProvinceSet === 'function') rebuildPlayerProvinceSet();
        if (typeof render === 'function') render();
        if (typeof updateCountryPanel === 'function') updateCountryPanel();
        if (typeof refreshTreatiesUI === 'function') refreshTreatiesUI();
        if (typeof updatePlayerLettersUI === 'function') updatePlayerLettersUI();
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'error', msg: 'Ошибка загрузки автосейва: ' + e.message };
    }
}
