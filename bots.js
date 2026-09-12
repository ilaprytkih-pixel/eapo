//================================================================
// FILE: bots.js
// Улучшенная логика ботов: оборона, оценка целей, экономика,
// флот, перераспределение войск, поддержка LLM-fallback.
//================================================================

// Установить враждебные отношения после атаки.
function botSetHostile(cid, other) {
    const a = countryList[cid];
    const b = countryList[other];

    if (a) {
        a.relations = a.relations || {};
        a.relations[other] = -100;
    }

    if (b) {
        b.relations = b.relations || {};
        b.relations[cid] = -100;
    }
}

// Постройка порта ботом.
function botBuildPort(country, pr) {
    if (!pr || !pr.isCoastal) return false;
    if (pr.port && pr.port.built) return false;
    if (country.treasury < G.params.portCost * 1.2) return false;

    const pos = (typeof findPortVisualPosition === 'function')
        ? findPortVisualPosition(pr)
        : null;

    if (!pos) return false;

    const region = (G.waterRegionOf)
        ? G.waterRegionOf[idxOf(pos.vx, pos.vy)]
        : -1;

    if (region < 0) return false;
    if (G.waterIsOcean && G.waterIsOcean[region] === false) return false;

    country.treasury -= G.params.portCost;

    pr.port = {
        built: true,
        ships: 0,
        buildTimer: 0,
        vx: pos.vx,
        vy: pos.vy,
        waterRegionId: region
    };

    addGameLog('Бот ' + country.name + ': построил порт в провинции ' + pr.id);
    return true;
}

// Постройка корабля ботом.
function botBuildShip(country, pr) {
    if (!pr || !pr.port || !pr.port.built) return false;
    if (pr.port.vx < 0 || pr.port.vy < 0) return false;
    if (pr.port.ships >= G.params.maxShipsPerPort) return false;
    if (country.treasury < G.params.shipCost * 1.1) return false;

    country.treasury -= G.params.shipCost;
    pr.port.ships++;

    G.ships.push({
        id: shipIdCounter++,
        ownerCid: country.id,
        homeProvinceId: pr.id,
        portProvinceId: pr.id,
        targetProvinceId: null,
        x: pr.port.vx * pixelSize + pixelSize / 2,
        y: pr.port.vy * pixelSize + pixelSize / 2,
        targetX: -1,
        targetY: -1,
        path: null,
        pathIndex: 0,
        progress: 0,
        state: 'idle',
        speed: G.params.shipMoveSpeed
    });

    return true;
}

// Оценка привлекательности цели.
function botTargetScore(cid, ownerId, targetProv) {
    let score = 0;

    // Слабая цель лучше.
    score -= (targetProv.army || 0) * 1.5;

    // Богатая цель лучше.
    score += (targetProv.population || 0) * 0.005;
    score += (targetProv.infrastructure || 0) * 0.2;

    // Если уже воюем, цель более приоритетна.
    if (isAtWar(cid, ownerId)) {
        score += 50;
    } else {
        score -= 10;
    }

    // Если договор мешает войне, цель почти не рассматривается.
    if (typeof treatiesBlockWar === 'function' && treatiesBlockWar(cid, ownerId)) {
        score -= 1000;
    }

    // Плохие отношения повышают агрессию.
    const rel = (countryList[cid].relations && countryList[cid].relations[ownerId]) || 0;
    score -= rel * 0.2;

    // Если враг почти уничтожен, добиваем.
    if (countryList[ownerId] && countryList[ownerId].provinces.length <= 1) {
        score += 20;
    }

    // Цель отвлечена войной с кем-то ещё — удар вероятнее (к игроку не применяется).
    if (ownerId !== G.playerCountryId && typeof isAnyWarFor === 'function' && isAnyWarFor(ownerId)) {
        score += 15;
    }

    // Атака на страну с сильными союзниками/гарантами рискованна:
    // они втянутся в войну (startWar-каскад).
    if (!isAtWar(cid, ownerId)) {
        let allyArmy = 0;
        if (typeof getDefensiveAllies === 'function') {
            for (const ally of getDefensiveAllies(ownerId)) {
                if (ally !== ownerId) allyArmy += getCountryArmy(ally);
            }
        }
        if (typeof getGuarantors === 'function') {
            for (const g of getGuarantors(ownerId)) allyArmy += getCountryArmy(g);
        }
        if (allyArmy > 0) score -= Math.min(300, allyArmy * 0.03);
    }

    return score;
}

// Стоит ли атаковать конкретную цель.
function botShouldAttack(cid, ownerId, srcProv, tgtProv) {
    if (ownerId < 0 || ownerId === cid) return false;
    const atWar = isAtWar(cid, ownerId);
    if (!atWar) {
        if (typeof canDeclareWar === 'function' && !canDeclareWar(cid, ownerId)) {
            return false;
        }
        // Не объявлять войну игроку, если он уже воюет с двумя и более странами
        // (защита от ощущения «все воюют только со мной»).
        if (ownerId === G.playerCountryId && typeof countWarsFor === 'function' &&
            countWarsFor(ownerId) >= 2) {
            return false;
        }
        const myArmy = getCountryArmy(cid);
        const enemyArmy = getCountryArmy(ownerId);
        // Цель отвлечена другой войной — порог превосходства ниже (только не против игрока).
        const enemyBusy = ownerId !== G.playerCountryId &&
            typeof isAnyWarFor === 'function' && isAnyWarFor(ownerId);
        const ratioNeed = enemyBusy ? 1.0 : 1.25;
        if (enemyArmy > 0 && myArmy / enemyArmy < ratioNeed) {
            return false;
        }
        const rel = (countryList[cid].relations && countryList[cid].relations[ownerId]) || 0;
        if (rel > 40 && Math.random() < 0.7) {
            return false;
        }
    }
    // Не атакуем, если гарнизон цели слишком сильный.
    if ((tgtProv.army || 0) >= (srcProv.army || 0) * 0.8) {
        return false;
    }
    // Столицу атакуем только при хорошем перевесе.
    const enemyCountry = countryList[ownerId];
    if (enemyCountry && tgtProv.id === enemyCountry.capital) {
        if ((tgtProv.army || 0) >= (srcProv.army || 0) * 0.5) {
            return false;
        }
    }
    // Против отвлечённого войной врага боты воюют смелее (кроме игрока).
    const enemyBusy2 = ownerId !== G.playerCountryId &&
        typeof isAnyWarFor === 'function' && isAnyWarFor(ownerId);
    return Math.random() < (atWar ? 0.55 : (enemyBusy2 ? 0.45 : 0.28));
}

// Оборона: подкрепление атакованных провинций.
function botDefendCountry(cid, country, myProvinces, avgArmy) {
    const underAttack = myProvinces.filter(p =>
        G.captures.some(c => c.isActive && c.targetProvinceId === p.id)
    );

    // Столицу защищаем в первую очередь.
    underAttack.sort((a, b) => {
        const aCapital = (a.id === country.capital) ? -1000 : 0;
        const bCapital = (b.id === country.capital) ? -1000 : 0;
        return (aCapital + a.army) - (bCapital + b.army);
    });

    for (const pr of underAttack) {
        if (pr.army >= avgArmy * 0.7) continue;

        const donors = [...pr.neighbors]
            .map(id => provinceList[id])
            .filter(n => {
                if (!n || n.cells <= 0) return false;
                if (!country.provinces.includes(n.id)) return false;
                if (n.army <= avgArmy * 0.35) return false;
                return !G.captures.some(c =>
                    c.isActive && c.targetProvinceId === n.id
                );
            });

        donors.sort((a, b) => b.army - a.army);

        for (const donor of donors.slice(0, 2)) {
            const pct = Math.min(
                65,
                Math.max(
                    15,
                    Math.floor((donor.army - avgArmy * 0.25) / donor.army * 100)
                )
            );

            if (pct > 10 && donor.army > 5) {
                reinforceProvince(donor, pr, pct);
                break;
            }
        }
    }
}

// Строительство флота и портов.
function botBuildNavy(country, coastalProvs, portProvs) {
    // Строим порт, если казна достаточно большая.
    if (country.treasury > G.params.portCost * 2) {
        const candidate = coastalProvs.find(p => !p.port || !p.port.built);
        if (candidate) {
            botBuildPort(country, candidate);
        }
    }

    // Строим корабли в существующих портах.
    for (const p of portProvs) {
        if (
            country.treasury > G.params.shipCost * 2.5 &&
            p.port.ships < G.params.maxShipsPerPort
        ) {
            botBuildShip(country, p);
        }
    }
}

// Наземные атаки.
function botLandAttacks(cid, country, myProvinces, avgArmy, attacksLeft) {
    for (const prov of myProvinces) {
        if (attacksLeft <= 0) break;

        const underAttack = G.captures.some(c =>
            c.isActive && c.targetProvinceId === prov.id
        );

        if (underAttack) continue;
        if (prov.army < avgArmy * 1.5) continue;
        if (prov.army < 30) continue;

        const targets = [];

        for (const nbId of prov.neighbors) {
            const targetProv = provinceList[nbId];
            if (!targetProv || targetProv.cells <= 0) continue;
            if (country.provinces.includes(nbId)) continue;

            const owner = findCountryOfProvince(nbId);
            if (owner < 0) continue;

            targets.push({
                prov: targetProv,
                owner
            });
        }

        if (!targets.length) continue;

        targets.sort((a, b) =>
            botTargetScore(cid, b.owner, b.prov) -
            botTargetScore(cid, a.owner, a.prov)
        );

        // Пробуем до двух лучших целей: отказ по первой не замораживает провинцию
        let target = null;
        for (const cand of targets.slice(0, 2)) {
            if (botShouldAttack(cid, cand.owner, prov, cand.prov)) { target = cand; break; }
        }
        if (!target) continue;

        const ratio = Math.min(
            85,
            Math.max(
                40,
                Math.round((prov.army / Math.max(1, target.prov.army)) * 25)
            )
        );

        const cap = startCapture(prov, target.prov, ratio);

        if (cap) {
            if (!isAtWar(cid, target.owner)) {
                startWar(cid, target.owner);
                botSetHostile(cid, target.owner);
            }

            recordCombat(cid, target.owner);
            attacksLeft--;

            addGameLog(
                'Бот ' + country.name +
                ': атакует провинцию ' + target.prov.id +
                ' из ' + prov.id +
                ' (' + ratio + '%)'
            );
        }
    }

    return attacksLeft;
}

// Морские атаки.
function botSeaAttacks(cid, country, portProvs, avgArmy, attacksLeft) {
    for (const portProv of portProvs) {
        if (attacksLeft <= 0) break;
        if (!portProv.port || !portProv.port.built) continue;
        if (portProv.port.ships <= 0) continue;
        if (portProv.army < avgArmy * 0.9) continue;

        const targets = [];

        for (const pr of provinceList) {
            if (!pr || pr.cells <= 0) continue;
            if (!pr.isCoastal) continue;
            if (country.provinces.includes(pr.id)) continue;

            const owner = findCountryOfProvince(pr.id);
            if (owner < 0 || owner === country.id) continue;

            if (typeof canSeaTravel !== 'function') continue;
            if (!canSeaTravel(portProv, pr)) continue;

            // Морской десант должен быть против слабых целей.
            if ((pr.army || 0) < portProv.army * 0.65) {
                targets.push({ prov: pr, owner });
            }
        }

        if (!targets.length) continue;

        targets.sort((a, b) =>
            botTargetScore(cid, b.owner, b.prov) -
            botTargetScore(cid, a.owner, a.prov)
        );

        const target = targets[0];
        if (!target) continue;

        if (!botShouldAttack(cid, target.owner, portProv, target.prov)) {
            continue;
        }

        const percent = 70;
        const commit = Math.floor(portProv.army * percent / 100);
        const needed = Math.ceil(commit / G.params.shipCapacity);

        const idleShips = G.ships.filter(s =>
            s.portProvinceId === portProv.id && s.state === 'idle'
        ).length;

        if (idleShips < needed) continue;

        const cap = startCapture(portProv, target.prov, percent, { isSea: true });

        if (cap) {
            if (!isAtWar(cid, target.owner)) {
                startWar(cid, target.owner);
                botSetHostile(cid, target.owner);
            }

            recordCombat(cid, target.owner);
            attacksLeft--;

            addGameLog(
                'Бот ' + country.name +
                ': морской десант из ' + portProv.id +
                ' на ' + target.prov.id
            );
        }
    }

    return attacksLeft;
}

// Перераспределение войск к фронту.
function botRedistributeArmy(cid, country, myProvinces, avgArmy) {
    const frontSet = new Set();

    for (const p of myProvinces) {
        for (const nbId of p.neighbors) {
            const owner = findCountryOfProvince(nbId);
            if (owner >= 0 && owner !== cid) {
                frontSet.add(p.id);
                break;
            }
        }
    }

    const donors = myProvinces.filter(p => {
        if (frontSet.has(p.id)) return false;
        if (p.army <= avgArmy * 1.4) return false;
        return !G.captures.some(c =>
            c.isActive && c.targetProvinceId === p.id
        );
    });

    for (const donor of donors) {
        const target = myProvinces.find(p => {
            if (!frontSet.has(p.id)) return false;
            if (p.army >= avgArmy * 0.8) return false;

            return donor.neighbors instanceof Set
                ? donor.neighbors.has(p.id)
                : donor.neighbors.includes(p.id);
        });

        if (target) {
            reinforceProvince(donor, target, 25);
        }
    }
}

// Главная функция хода бота.
function processBotTurn(countryId) {
    if (countryId === G.playerCountryId || G.isPlayerSelectPhase) return;
    if (!provinceList || !countryList) return;
    if (countryId < 0 || countryId >= countryList.length) return;

    const country = countryList[countryId];
    if (!country || country.provinces.length === 0) return;

    // Если LLM уже действовал в этом ходу, не дублируем.
    if (country._llmHandledTurn === G.turnNumber) return;

    // Если LLM-страна сейчас ждет ответа, только инерционная оборона.
    if (typeof isLlmCollecting === 'function' && isLlmCollecting(countryId)) {
        if (typeof processInertialTurn === 'function') {
            processInertialTurn(countryId);
        }
        return;
    }

    if (country.gracePeriod > 0) {
        country.gracePeriod--;
        return;
    }

    if ((country.peaceGracePeriod || 0) > 0) {
        country.peaceGracePeriod--;
    }

    // Дипломатия ботов.
    if (typeof botDiplomacy === 'function') {
        botDiplomacy(countryId);
    }

    const myProvinces = country.provinces
        .map(pid => provinceList[pid])
        .filter(p => p && p.cells > 0);

    if (!myProvinces.length) return;

    const totalArmy = myProvinces.reduce((s, p) => s + (p.army || 0), 0);
    const avgArmy = totalArmy / myProvinces.length || 1;

    const coastalProvs = myProvinces.filter(p => p.isCoastal);
    const portProvs = coastalProvs.filter(p => p.port && p.port.built);

    // 1. Оборона.
    botDefendCountry(countryId, country, myProvinces, avgArmy);

    // 2. Флот и порты.
    botBuildNavy(country, coastalProvs, portProvs);

    // 3. Атаки.
    let attacksLeft = 2;
    attacksLeft = botLandAttacks(countryId, country, myProvinces, avgArmy, attacksLeft);
    attacksLeft = botSeaAttacks(countryId, country, portProvs, avgArmy, attacksLeft);

    // 4. Стягивание войск к фронту.
    botRedistributeArmy(countryId, country, myProvinces, avgArmy);
}
