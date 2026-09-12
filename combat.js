let captureIdCounter = 0;

function findCountryOfProvince(pid) {
    if (pid < 0 || pid >= provinceList.length) return -1;
    if (typeof _countryOfProv !== 'undefined' && _countryOfProv) return _countryOfProv[pid];
    for (const c of countryList) {
        if (c.provinces.includes(pid)) return c.id;
    }
    return -1;
}

function provincesAdjacent(a, b) {
    if (!a || !b || !b.id) return false;
    return a.neighbors instanceof Set ? a.neighbors.has(b.id) : a.neighbors.includes(b.id);
}

function findNearestCoastalCell(targetProvince, fromProvince) {
    if (!targetProvince.cellIndices || targetProvince.cellIndices.length === 0) {
        return { x: targetProvince.cx, y: targetProvince.cy };
    }
    let bestCell = null;
    let bestDist = Infinity;
    const fromX = fromProvince.cx, fromY = fromProvince.cy;
    for (const idx of targetProvince.cellIndices) {
        const x = idx % COLS, y = (idx / COLS) | 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            if (heightMap[ny][nx] <= 0.5) {
                const dist = (nx - fromX) ** 2 + (ny - fromY) ** 2;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestCell = { x: nx, y: ny };
                }
            }
        }
    }
    return bestCell || { x: targetProvince.cx, y: targetProvince.cy };
}

function startCapture(attackerProvince, targetProvince, armyPercent, options) {
    if (attackerProvince.army <= 0) return null;
    const commitForce = Math.floor(attackerProvince.army * armyPercent / 100);
    if (commitForce <= 0) return null;

    const defCountry = findCountryOfProvince(targetProvince.id);
    if (defCountry < 0) return null;

    const isSea = options && options.isSea;

    // Защита в глубине: сухопутная атака возможна только по смежной провинции.
    // (UI/боты/LLM проверяют смежность сами, но и здесь не должно быть дыр.)
    if (!isSea && !provincesAdjacent(attackerProvince, targetProvince)) return null;

    let usedShips = [];
    if (isSea) {
        const port = attackerProvince.port;
        if (!port || !port.built) return null;
        if (!canSeaTravel(attackerProvince, targetProvince)) return null;
        const needed = Math.ceil(commitForce / G.params.shipCapacity);
        const idleAtPort = G.ships.filter(s => s.portProvinceId === attackerProvince.id && s.state === 'idle');
        if (idleAtPort.length < needed) return null;
        for (let i = 0; i < needed; i++) {
            idleAtPort[i].state = 'used';
            usedShips.push(idleAtPort[i]);
        }
        port.ships = Math.max(0, port.ships - needed);
    }

    attackerProvince.army -= commitForce;

    let originX = targetProvince.cx, originY = targetProvince.cy;
    const totalCells = targetProvince.cells || targetProvince.cellIndices.length;

    if (isSea && targetProvince.cellIndices && targetProvince.cellIndices.length > 0) {
        const portSeaX = attackerProvince.port ? attackerProvince.port.vx : -1;
        const portSeaY = attackerProvince.port ? attackerProvince.port.vy : -1;
        if (portSeaX >= 0) {
            let closestX = targetProvince.cx, closestY = targetProvince.cy;
            let minDist = Infinity;
            for (const idx of targetProvince.cellIndices) {
                const x = idx % COLS, y = (idx / COLS) | 0;
                let isCoastalCell = false;
                for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && heightMap[ny][nx] <= 0.5) {
                        isCoastalCell = true;
                        break;
                    }
                }
                if (isCoastalCell) {
                    const dist = (x - portSeaX) * (x - portSeaX) + (y - portSeaY) * (y - portSeaY);
                    if (dist < minDist) {
                        minDist = dist;
                        closestX = x;
                        closestY = y;
                    }
                }
            }
            originX = closestX;
            originY = closestY;
        }
    } else if (targetProvince.cellIndices && targetProvince.cellIndices.length > 0) {
        const borderCells = [];
        for (const idx of targetProvince.cellIndices) {
            const x = idx % COLS, y = (idx / COLS) | 0;
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                if (provinceOf[ny * COLS + nx] === attackerProvince.id) {
                    borderCells.push({ x, y });
                    break;
                }
            }
        }
        if (borderCells.length > 0) {
            originX = borderCells.reduce((s, p) => s + p.x, 0) / borderCells.length;
            originY = borderCells.reduce((s, p) => s + p.y, 0) / borderCells.length;
        }
    }

    const sortedCellIndices = targetProvince.cellIndices ?
        [...targetProvince.cellIndices].sort((a, b) => {
            const ax = a % COLS, ay = (a / COLS) | 0;
            const bx = b % COLS, by = (b / COLS) | 0;
            const da = (ax - originX) * (ax - originX) + (ay - originY) * (ay - originY);
            const db = (bx - originX) * (bx - originX) + (by - originY) * (by - originY);
            return da - db;
        }) : null;

const capture = {
        id: captureIdCounter++,
        attackerProvinceId: attackerProvince.id,
        targetProvinceId: targetProvince.id,
        attackerCountryId: findCountryOfProvince(attackerProvince.id),
        defenderCountryId: defCountry,
        attackerArmy: commitForce,
        defenderArmyAtStart: targetProvince.army,
        damageDealt: 0,
        cellsCaptured: 0,
        totalCells: totalCells,
        sortedCellIndices,
        isActive: true,
        status: 'attacking',
        isSea: !!isSea
    };

    G.captures.push(capture);
    targetProvince.captureProgress.push(capture.id);

    if (isSea) {
        startFleetAnim(attackerProvince, targetProvince, capture);
    }

    return capture;
}

function processCaptureTick(capture, ms) {
    if (!capture.isActive) return;
    const targetProv = provinceList[capture.targetProvinceId];
    if (!targetProv) { capture.isActive = false; return; }

    const dt = ms / 1000;
    const garrison = Math.max(0, targetProv.army);
    if (garrison <= 0) return;

    let defMult = 1;
    if (G.params.flankDefensePenalty > 0) {
        const fronts = new Set([capture.attackerProvinceId]);
        for (const c of G.captures) {
            if (c.isActive && c.targetProvinceId === capture.targetProvinceId) fronts.add(c.attackerProvinceId);
        }
        const F = Math.min(fronts.size, G.params.flankMaxFronts || 5);
        if (F >= 2) defMult = Math.max(0, 1 - G.params.flankDefensePenalty * (F - 1));
    }

    const attackerLoss = garrison * G.params.defenseRate * dt * defMult;
    const defenderLoss = capture.attackerArmy * G.params.attackRate * dt;

    capture.attackerArmy = Math.max(0, capture.attackerArmy - attackerLoss);
    targetProv.army = Math.max(0, garrison - defenderLoss);
    capture.damageDealt += defenderLoss;

    if (capture.defenderArmyAtStart > 0) {
        capture.cellsCaptured = Math.min(capture.totalCells,
            (capture.damageDealt / capture.defenderArmyAtStart) * capture.totalCells);
    }

    if (capture.attackerArmy <= 0) {
        capture.isActive = false;
        capture.status = 'defeated';
        const idx = targetProv.captureProgress.indexOf(capture.id);
        if (idx >= 0) targetProv.captureProgress.splice(idx, 1);
    }
}

function resolveProvinceCombat(provinceId) {
    const targetProv = provinceList[provinceId];
    if (!targetProv) return;

    const attacks = G.captures.filter(c =>
        c.targetProvinceId === provinceId && (c.isActive || c.damageDealt > 0)
    );
    if (attacks.length === 0) return;

    let winner = attacks[0];
    for (const a of attacks) {
        if (a.damageDealt > winner.damageDealt) winner = a;
    }

    const newOwner = winner.attackerCountryId;
    const oldOwnerId = findCountryOfProvince(provinceId);

    if (oldOwnerId >= 0 && oldOwnerId < countryList.length) {
        const idx = countryList[oldOwnerId].provinces.indexOf(provinceId);
        if (idx >= 0) countryList[oldOwnerId].provinces.splice(idx, 1);
    }
    if (newOwner >= 0 && newOwner < countryList.length) {
        if (!countryList[newOwner].provinces.includes(provinceId)) {
            countryList[newOwner].provinces.push(provinceId);
        }
    }

    targetProv.army = Math.max(1, Math.round(winner.attackerArmy));
    targetProv.population = Math.max(1, Math.round(targetProv.population * 0.85));
    targetProv.infrastructure = Math.max(0, Math.round(targetProv.infrastructure * 0.7));
    if (targetProv.port) {
        targetProv.port.buildTimer = 0;
        // Флот в захваченном порту переходит победителю. Иначе корабли остаются
        // со старым ownerCid: новый владелец может их отправить, но войска
        // «сгорят» в пункте назначения (несовпадение владельца), а корабли
        // потеряются при возврате. Корабли в море (state !== 'idle') доходят
        // свой рейс под старым владельцем.
        let shipsAtPort = 0;
        for (const s of G.ships) {
            if (s.portProvinceId === provinceId && s.state === 'idle') {
                s.ownerCid = newOwner;
                s.homeProvinceId = provinceId;
                shipsAtPort++;
            }
        }
        targetProv.port.ships = Math.min(shipsAtPort, G.params.maxShipsPerPort);
    }
    rebuildCountryMap();

    if (typeof recordLlmEvent === 'function') {
        const oldName = oldOwnerId >= 0 && countryList[oldOwnerId] ? countryList[oldOwnerId].name : '?';
        const newName = newOwner >= 0 && countryList[newOwner] ? countryList[newOwner].name : '?';
        if (oldOwnerId >= 0) recordLlmEvent(oldOwnerId, 'Lost province P' + provinceId + ' to ' + newName);
        if (newOwner >= 0) recordLlmEvent(newOwner, 'Captured province P' + provinceId + ' from ' + oldName);
    }

    for (const a of attacks) {
        a.isActive = false;
        if (a.id === winner.id) {
            a.status = 'won';
        } else {
            a.status = 'cancelled';
            const srcProv = provinceList[a.attackerProvinceId];
            if (srcProv && findCountryOfProvince(srcProv.id) === a.attackerCountryId) {
                srcProv.army += a.attackerArmy;
            }
        }
        const idx = targetProv.captureProgress.indexOf(a.id);
        if (idx >= 0) targetProv.captureProgress.splice(idx, 1);
    }
    for (const a of attacks) {
        const animIdx = G.fleetAnims.findIndex(f => f.captureId === a.id);
        if (animIdx >= 0) G.fleetAnims[animIdx].state = 'returning';
    }

    // Если проигравшая страна полностью уничтожена — завершаем все её войны автоматически
    if (oldOwnerId >= 0 && oldOwnerId < countryList.length) {
        const loser = countryList[oldOwnerId];
        if (loser && loser.provinces.length === 0 && typeof makePeace === 'function') {
            for (const [k, w] of [...G.wars]) {
                if (w.a === oldOwnerId || w.b === oldOwnerId) {
                    makePeace(w.a, w.b);
                }
            }
            addGameLog(loser.name + ' eliminated!');
        }
    }
}

function reinforceProvince(fromProvince, toProvince, armyPercent) {
    if (fromProvince.army <= 0) return false;
    const transfer = Math.floor(fromProvince.army * armyPercent / 100);
    if (transfer <= 0) return false;
    fromProvince.army -= transfer;
    toProvince.army += transfer;
    return true;
}

function getCaptureProgress(provinceId) {
    const result = [];
    for (const cap of G.captures) {
        if (cap.targetProvinceId === provinceId && cap.isActive) {
            result.push(cap);
        }
    }
    return result;
}

function startFleetAnim(srcProv, targetProv, capture) {
    const port = srcProv.port;
    if (!port || !port.built || port.vx === undefined || port.vx < 0 || port.vy === undefined) return;

    const fromX = port.vx, fromY = port.vy;
    const to = findNearestCoastalCell(targetProv, srcProv);
    if (fromX === to.x && fromY === to.y) return;

    const path = findWaterPath(fromX, fromY, to.x, to.y);
    if (!path || path.length < 2) return;

    G.fleetAnims.push({
        id: capture.id,
        fromProvinceId: srcProv.id,
        targetProvinceId: targetProv.id,
        path: path,
        pathIndex: 0,
        progress: 0,
        state: 'sailing',
        countryId: capture.attackerCountryId,
        captureId: capture.id
    });
}

function updateFleetAnims(frameDt) {
    if (!G.fleetAnims || G.fleetAnims.length === 0) return;
    const travelMs = G.params.fleetTravelMs || 2600;

    for (let i = G.fleetAnims.length - 1; i >= 0; i--) {
        const anim = G.fleetAnims[i];
        const capture = G.captures.find(c => c.id === anim.captureId && c.isActive);

        if (anim.state === 'sailing') {
            if (!anim.path || anim.path.length < 2) { G.fleetAnims.splice(i, 1); continue; }
            const capture = G.captures.find(c => c.id === anim.captureId && c.isActive);
            if (!capture) {
                // Захват отменён/завершён — флот разворачивается домой, а не исчезает
                anim.state = 'returning';
            } else {
                anim.progress += frameDt / travelMs;
                if (anim.progress >= 1) {
                    anim.progress = 1;
                    anim.state = 'arrived';
                    anim.arrivedTimer = 800;
                }
            }
        } else if (anim.state === 'arrived') {
            anim.arrivedTimer -= frameDt;
            if (!capture || anim.arrivedTimer <= 0) {
                anim.state = 'returning';
                anim.progress = 1;
            }
        } else if (anim.state === 'returning') {
            anim.progress -= frameDt / travelMs;
            if (anim.progress <= 0) {
                anim.progress = 0;
                G.fleetAnims.splice(i, 1);
            }
        }
    }
}

function getAnimPosition(anim) {
    if (!anim.path || anim.path.length < 2) return null;
    const totalSegs = anim.path.length - 1;
    const segIdx = Math.min(Math.floor(anim.progress * totalSegs), totalSegs - 1);
    const segProgress = (anim.progress * totalSegs) - segIdx;
    const p0 = anim.path[segIdx];
    const p1 = anim.path[Math.min(segIdx + 1, anim.path.length - 1)];
    return {
        x: p0.x + (p1.x - p0.x) * segProgress,
        y: p0.y + (p1.y - p0.y) * segProgress
    };
}
