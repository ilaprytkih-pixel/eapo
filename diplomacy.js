const WAR_EXHAUSTION_PER_TURN = 5;
const WAR_EXHAUSTION_LOST_PROVINCE = 20;
const PEACE_RELATION_RESET = 10;
const PEACE_GRACE_PERIOD = 10;
const WAR_LENGTH_FOR_PEACE = 10;
const PROVINCE_LOSS_FOR_PEACE = 0.3;
const TREASURY_CRISIS_FOR_PEACE = 3;
const ARMY_RATIO_FOR_PEACE = 0.25;
const ARMY_RATIO_TO_DECLARE_WAR = 1.2;

function warKey(a, b) {
    return a < b ? a + ':' + b : b + ':' + a;
}

function isAtWar(a, b) {
    if (!G.wars) G.wars = new Map();
    return G.wars.has(warKey(a, b));
}

function getWar(a, b) {
    if (!G.wars) G.wars = new Map();
    return G.wars.get(warKey(a, b)) || null;
}

// Число активных войн страны (защита игрока от войны «все против одного»).
function countWarsFor(cid) {
    let n = 0;
    for (const [k, w] of (G.wars || [])) {
        if (w.a === cid || w.b === cid) n++;
    }
    return n;
}

function _createWarPair(a, b) {
    if (!G.wars) G.wars = new Map();
    const k = warKey(a, b);
    if (G.wars.has(k)) return false;
    G.wars.set(k, {
        a, b,
        heat: 10,
        lastCombatTurn: G.turnNumber,
        warStartTurn: G.turnNumber,
        provincesAtStart: {
            a: countryList[a] ? countryList[a].provinces.length : 0,
            b: countryList[b] ? countryList[b].provinces.length : 0
        }
    });
    return true;
}

function cname(cid) {
    return countryList[cid] ? countryList[cid].name : '?';
}

// Активные союзники (включая саму страну): все партнёры по alliance-договорам.
function getDefensiveAllies(cid) {
    const allies = new Set([cid]);
    for (const t of (G.treaties || [])) {
        if (t.status !== 'active' || t.type !== 'alliance') continue;
        if (t.a === cid) allies.add(t.b);
        else if (t.b === cid) allies.add(t.a);
    }
    return allies;
}

// Гаранты страны: по конвенции createTreatyProposal t.a (гарант) гарантирует t.b.
function getGuarantors(cid) {
    const out = new Set();
    for (const t of (G.treaties || [])) {
        if (t.status !== 'active' || t.type !== 'guarantee') continue;
        if (t.b === cid) out.add(t.a);
    }
    return out;
}

function startWar(a, b) {
    if (!G.wars) G.wars = new Map();
    if (_createWarPair(a, b)) {
        if (typeof addGameLog === 'function') {
            addGameLog('War: ' + cname(a) + ' vs ' + cname(b));
        }
        if (countryList[a]) { countryList[a].warExhaustion = (countryList[a].warExhaustion || 0) + 5; }
        if (countryList[b]) { countryList[b].warExhaustion = (countryList[b].warExhaustion || 0) + 5; }
        if (typeof recordLlmEvent === 'function') {
            recordLlmEvent(a, 'Declared war on ' + cname(b));
            recordLlmEvent(b, 'War declared by ' + cname(a));
        }
    }

    // Каскад: союзники и гаранты сторон втягиваются в конфликт.
    // Только прямые связи (союзник союзника НЕ втягивается — иначе один пакт
    // затянет всю карту); мёртвые страны пропускаются; canDeclareWar к втянутым
    // не применяется (принудительное вступление по договору).
    const sideA = new Set([a]);
    const sideB = new Set([b]);
    for (const ally of getDefensiveAllies(a)) sideA.add(ally);
    for (const ally of getDefensiveAllies(b)) sideB.add(ally);
    for (const g of getGuarantors(a)) sideA.add(g);
    for (const g of getGuarantors(b)) sideB.add(g);
    for (const cid of [...sideA]) {
        if (!countryList[cid] || countryList[cid].provinces.length === 0) sideA.delete(cid);
    }
    for (const cid of [...sideB]) {
        if (!countryList[cid] || countryList[cid].provinces.length === 0) sideB.delete(cid);
    }
    for (const ca of sideA) {
        for (const cb of sideB) {
            if (ca === cb) continue;
            if (G.wars.has(warKey(ca, cb))) continue;
            // Действующий пакт о ненападении/перемирие между парой сильнее
            // альянса — такую пару в войну не втягиваем.
            if (treatiesBlockWar(ca, cb)) {
                if (typeof addGameLog === 'function') {
                    addGameLog('Alliance war blocked by treaty: ' + cname(ca) + ' vs ' + cname(cb));
                }
                continue;
            }
            if (_createWarPair(ca, cb)) {
                if (typeof addGameLog === 'function') {
                    addGameLog('Alliance/guarantee: ' + cname(ca) + ' joins war vs ' + cname(cb));
                }
                if (typeof recordLlmEvent === 'function') {
                    recordLlmEvent(ca, 'Pulled into war vs ' + cname(cb) + ' (alliance/guarantee)');
                    recordLlmEvent(cb, 'War with ' + cname(ca) + ' (alliance/guarantee)');
                }
            }
        }
    }
}

function recordCombat(a, b) {
    const k = warKey(a, b);
    const w = G.wars.get(k);
    if (w) {
        w.heat = 10;
        w.lastCombatTurn = G.turnNumber;
    }
}

function makePeace(countryA, countryB) {
    const k = warKey(countryA, countryB);
    const war = G.wars.get(k);
    if (!war) return false;

    const a = countryList[countryA];
    const b = countryList[countryB];
    if (!a || !b) return false;

    G.wars.delete(k);

    a.relations = a.relations || {};
    b.relations = b.relations || {};
    a.relations[countryB] = PEACE_RELATION_RESET;
    b.relations[countryA] = PEACE_RELATION_RESET;

    a.warExhaustion = Math.max(0, (a.warExhaustion || 0) - 30);
    b.warExhaustion = Math.max(0, (b.warExhaustion || 0) - 30);

    a.peaceGracePeriod = PEACE_GRACE_PERIOD;
    b.peaceGracePeriod = PEACE_GRACE_PERIOD;

    if (typeof addGameLog === 'function') {
        addGameLog('Peace: ' + a.name + ' vs ' + b.name);
    }
    if (typeof recordLlmEvent === 'function') {
        recordLlmEvent(countryA, 'Peace with ' + b.name);
        recordLlmEvent(countryB, 'Peace with ' + a.name);
    }
    // Мир заключён — взаимные мирные предложения больше не актуальны
    removePeaceProposal(countryA, countryB);
    removePeaceProposal(countryB, countryA);
    return true;
}

function getCountryArmy(countryId) {
    const c = countryList[countryId];
    if (!c) return 0;
    return c.provinces.reduce((s, pid) => s + (provinceList[pid] ? provinceList[pid].army : 0), 0);
}

function getCountryProvinceCount(countryId) {
    const c = countryList[countryId];
    return c ? c.provinces.length : 0;
}

function shouldBotWantPeace(countryId, enemyId) {
    const country = countryList[countryId];
    const enemy = countryList[enemyId];
    if (!country || !enemy) return false;

    const war = getWar(countryId, enemyId);
    if (!war) return false;

    const warLength = G.turnNumber - war.warStartTurn;
    if (warLength < WAR_LENGTH_FOR_PEACE) return false;

    const myProvCount = country.provinces.length;
    const enemyProvCount = enemy.provinces.length;
    const provsAtStart = war.provincesAtStart || { a: myProvCount, b: enemyProvCount };
    const myStartCount = countryId === war.a ? provsAtStart.a : provsAtStart.b;

    const myProvLost = Math.max(0, myStartCount - myProvCount);
    if (myStartCount > 0 && myProvLost / myStartCount > PROVINCE_LOSS_FOR_PEACE) return true;

    if ((country.crisisTurns || 0) >= TREASURY_CRISIS_FOR_PEACE) return true;

    const myArmy = getCountryArmy(countryId);
    const enemyArmy = getCountryArmy(enemyId);
    if (enemyArmy > 0 && myArmy > 0 && enemyArmy / myArmy > 1 / ARMY_RATIO_FOR_PEACE) return true;

    if ((country.warExhaustion || 0) >= 40) return true;

    return false;
}

const TREATY_TYPES = ['non_aggression', 'alliance', 'guarantee', 'tribute', 'ceasefire', 'province_transfer'];
const TREATY_DEFAULT_DURATION = 10;
const TREATY_PROPOSAL_TTL_TURNS = 6;
const TREATY_REPUTATION_SIGN = 15;
const TREATY_REPUTATION_BREAK = 30;
const TREATY_MAX_COUNTERS = 2;

function treatyTypeLabel(type) {
    const labels = {
        non_aggression: 'пакт о ненападении',
        alliance: 'альянс (взаимная оборона)',
        guarantee: 'гарантия (односторонняя защита)',
        tribute: 'дань (золото в ход)',
        ceasefire: 'перемирие',
        province_transfer: 'передача провинции'
    };
    return labels[type] || type;
}

function getTreatyById(id) {
    return (G.treaties || []).find(t => t.id === id) || null;
}

function getProposalById(id) {
    return (G.treatyProposals || []).find(p => p.id === id) || null;
}

function getActiveTreatyBetween(a, b, type) {
    return (G.treaties || []).find(t => t.status === 'active' && t.type === type &&
        ((t.a === a && t.b === b) || (t.a === b && t.b === a))) || null;
}

function getActiveTreatiesFor(cid) {
    return (G.treaties || []).filter(t => t.status === 'active' && (t.a === cid || t.b === cid));
}

function getIncomingProposals(cid) {
    return (G.treatyProposals || []).filter(p => p.status === 'pending' &&
        ((p.to === cid && p.lastOfferBy === p.from) || (p.from === cid && p.lastOfferBy === p.to)));
}

function hasNonAggressionPact(a, b) {
    return !!getActiveTreatyBetween(a, b, 'non_aggression');
}

function hasCeasefire(a, b) {
    return !!getActiveTreatyBetween(a, b, 'ceasefire');
}

function treatiesBlockWar(a, b) {
    return hasNonAggressionPact(a, b) || hasCeasefire(a, b);
}

function validTreatyTerms(type, terms) {
    const t = terms || {};
    const duration = parseInt(t.duration);
    if (isFinite(duration) && duration >= 1) t.duration = Math.min(duration, 60);
    else t.duration = TREATY_DEFAULT_DURATION;
    if (type === 'tribute') {
        const gold = parseInt(t.gold_per_turn);
        if (!isFinite(gold) || gold < 1) return null;
        t.gold_per_turn = Math.min(gold, 1000);
    }
    if (type === 'province_transfer') {
        const pid = parseInt(t.province_id);
        if (isNaN(pid) || !provinceList[pid]) return null;
        t.province_id = pid;
    }
    return t;
}

function createTreatyProposal(fromCid, toCid, type, terms) {
    if (!countryList[fromCid] || !countryList[toCid]) return null;
    if (fromCid === toCid) return null;
    if (!TREATY_TYPES.includes(type)) return null;
    const atWar = isAtWar(fromCid, toCid);
    if (type === 'ceasefire') {
        if (!atWar) return null;
    } else {
        if (atWar) return null;
        if (getActiveTreatyBetween(fromCid, toCid, type)) return null;
    }
    const t = validTreatyTerms(type, terms);
    if (!t) return null;
    if (type === 'province_transfer') {
        const p = provinceList[t.province_id];
        if (!countryList[fromCid].provinces.includes(p.id)) return null;
        if (p.id === countryList[fromCid].capital) return null;
        const underAttack = (G.captures || []).some(c => c.isActive && c.targetProvinceId === p.id);
        if (underAttack) return null;
    }
    if (!G._proposalIdCounter) G._proposalIdCounter = 0;
    G.treatyProposals = G.treatyProposals || [];
    const prop = {
        id: ++G._proposalIdCounter,
        type,
        from: fromCid,
        to: toCid,
        lastOfferBy: fromCid,
        terms: t,
        turnProposed: G.turnNumber,
        status: 'pending',
        counterCount: 0
    };
    G.treatyProposals.push(prop);
    if (typeof recordLlmEvent === 'function') {
        recordLlmEvent(fromCid, 'Proposed ' + treatyTypeLabel(type) + ' to ' + countryList[toCid].name);
    }
    if (toCid === G.playerCountryId && typeof addGameLog === 'function') {
        addGameLog(countryList[fromCid].name + ' предлагает вам договор: ' + treatyTypeLabel(type) + ' (LLM → Договоры)');
    }
    return prop;
}

function counterTreatyProposal(proposalId, byCid, terms) {
    const prop = getProposalById(proposalId);
    if (!prop || prop.status !== 'pending') return null;
    if (byCid !== prop.from && byCid !== prop.to) return null;
    if (byCid === prop.lastOfferBy) return null;
    if (prop.counterCount >= TREATY_MAX_COUNTERS) return null;
    const t = validTreatyTerms(prop.type, terms);
    if (!t) return null;
    prop.terms = t;
    prop.lastOfferBy = byCid;
    prop.counterCount++;
    if (typeof recordLlmEvent === 'function') {
        recordLlmEvent(byCid, 'Counter-offer on ' + treatyTypeLabel(prop.type) + ' to ' + countryList[prop.lastOfferBy === prop.from ? prop.to : prop.from].name);
    }
    return prop;
}

// Фактическая передача провинции по договору province_transfer.
// t.a — даритель, t.b — получатель (конвенция createTreatyProposal: даёт from).
function executeProvinceTransfer(treaty) {
    const giverC = countryList[treaty.a];
    const receiverC = countryList[treaty.b];
    const pid = treaty.terms.province_id;
    const p = provinceList[pid];
    if (!giverC || !receiverC || !p || p.cells <= 0) return false;
    if (!giverC.provinces.includes(pid)) return false;      // провинция потеряна за время переговоров
    if (pid === giverC.capital) return false;               // столицу отдать нельзя
    if ((G.captures || []).some(c => c.isActive && c.targetProvinceId === pid)) return false;

    const gi = giverC.provinces.indexOf(pid);
    if (gi >= 0) giverC.provinces.splice(gi, 1);
    if (!receiverC.provinces.includes(pid)) receiverC.provinces.push(pid);
    p.army = Math.max(1, Math.round(p.army || 0));

    if (typeof rebuildCountryMap === 'function') rebuildCountryMap();
    if (typeof rebuildPlayerProvinceSet === 'function' &&
        (treaty.a === G.playerCountryId || treaty.b === G.playerCountryId)) {
        rebuildPlayerProvinceSet();
    }

    if (typeof addGameLog === 'function') {
        addGameLog(giverC.name + ' передал провинцию P' + pid + ' стране ' + receiverC.name);
    }
    if (typeof recordLlmEvent === 'function') {
        recordLlmEvent(treaty.a, 'Transferred province P' + pid + ' to ' + receiverC.name);
        recordLlmEvent(treaty.b, 'Received province P' + pid + ' from ' + giverC.name);
    }
    return true;
}

function acceptTreatyProposal(proposalId, byCid) {
    const prop = getProposalById(proposalId);
    if (!prop || prop.status !== 'pending') return false;
    if (byCid !== prop.from && byCid !== prop.to) return false;
    if (byCid === prop.lastOfferBy) return false;
    if (prop.type === 'province_transfer') {
        // Валидация до создания договора: провинция должна всё ещё быть у дарителя.
        const pid = prop.terms.province_id;
        const giverC = countryList[prop.from];
        const p = provinceList[pid];
        if (!giverC || !p || !giverC.provinces.includes(pid) || pid === giverC.capital ||
            (G.captures || []).some(c => c.isActive && c.targetProvinceId === pid)) {
            if (typeof addGameLog === 'function') addGameLog('Передача провинции невозможна — договор не подписан');
            return false;
        }
    }
    prop.status = 'accepted';
    if (!G._treatyIdCounter) G._treatyIdCounter = 0;
    const treaty = {
        id: ++G._treatyIdCounter,
        type: prop.type,
        a: prop.from,
        b: prop.to,
        terms: Object.assign({}, prop.terms),
        turnSigned: G.turnNumber,
        turnExpires: G.turnNumber + (prop.terms.duration || TREATY_DEFAULT_DURATION),
        status: 'active',
        brokenBy: null,
        executed: false
    };
    G.treaties = G.treaties || [];
    G.treaties.push(treaty);
    const idx = G.treatyProposals.indexOf(prop);
    if (idx >= 0) G.treatyProposals.splice(idx, 1);
    for (const cid of [prop.from, prop.to]) {
        const c = countryList[cid];
        if (c) {
            c.reputation = Math.min(100, (c.reputation || 0) + TREATY_REPUTATION_SIGN);
            if (!c.relations) c.relations = {};
            const other = cid === prop.from ? prop.to : prop.from;
            c.relations[other] = Math.max(-100, Math.min(100, (c.relations[other] || 0) + 20));
        }
    }
    if (typeof addGameLog === 'function') {
        addGameLog('Treaty signed: ' + countryList[prop.from].name + ' ↔ ' + countryList[prop.to].name + ' (' + treatyTypeLabel(prop.type) + ')');
    }
    if (typeof recordLlmEvent === 'function') {
        recordLlmEvent(prop.from, 'Signed ' + treatyTypeLabel(prop.type) + ' with ' + countryList[prop.to].name);
        recordLlmEvent(prop.to, 'Signed ' + treatyTypeLabel(prop.type) + ' with ' + countryList[prop.from].name);
    }
    if (prop.type === 'province_transfer') {
        treaty.executed = executeProvinceTransfer(treaty);
    }
    return true;
}

function rejectTreatyProposal(proposalId, byCid) {
    const prop = getProposalById(proposalId);
    if (!prop || prop.status !== 'pending') return false;
    if (byCid !== prop.from && byCid !== prop.to) return false;
    if (byCid === prop.lastOfferBy) return false;
    prop.status = 'declined';
    const idx = G.treatyProposals.indexOf(prop);
    if (idx >= 0) G.treatyProposals.splice(idx, 1);
    if (typeof addGameLog === 'function') {
        addGameLog(countryList[byCid].name + ' declined treaty from ' + countryList[prop.lastOfferBy].name);
    }
    if (typeof recordLlmEvent === 'function') {
        recordLlmEvent(prop.lastOfferBy, countryList[byCid].name + ' declined ' + treatyTypeLabel(prop.type));
    }
    return true;
}

function terminateTreaty(treatyId, byCid) {
    const treaty = getTreatyById(treatyId);
    if (!treaty || treaty.status !== 'active') return false;
    if (treaty.a !== byCid && treaty.b !== byCid) return false;
    treaty.status = 'broken';
    treaty.brokenBy = byCid;
    treaty.brokenTurn = G.turnNumber;
    const other = treaty.a === byCid ? treaty.b : treaty.a;
    const breaker = countryList[byCid];
    const partner = countryList[other];
    if (breaker) breaker.reputation = Math.max(-100, (breaker.reputation || 0) - TREATY_REPUTATION_BREAK);
    for (const cid of [byCid, other]) {
        const c = countryList[cid];
        if (!c) continue;
        if (!c.relations) c.relations = {};
        c.relations[other] = Math.max(-100, (c.relations[other] || 0) - 40);
    }
    if (typeof addGameLog === 'function') {
        addGameLog((breaker ? breaker.name : '?') + ' broke the ' + treatyTypeLabel(treaty.type) + ' with ' + (partner ? partner.name : '?'));
    }
    if (typeof recordLlmEvent === 'function') {
        recordLlmEvent(byCid, 'Broke ' + treatyTypeLabel(treaty.type) + ' with ' + (partner ? partner.name : '?'));
        recordLlmEvent(other, (breaker ? breaker.name : '?') + ' broke ' + treatyTypeLabel(treaty.type));
    }
    return true;
}

function processDiplomacyTurn() {

    if (!G.wars) G.wars = new Map();

    // --- Договоры: дань, истечение, старение предложений, репутация ---
    if (G.treaties) {
        for (const t of G.treaties) {
            if (t.status !== 'active') continue;
            if (t.turnExpires <= G.turnNumber) {
                t.status = 'expired';
                if (typeof addGameLog === 'function') {
                    addGameLog('Treaty expired: ' + treatyTypeLabel(t.type) + ' (' + countryList[t.a].name + ' ↔ ' + countryList[t.b].name + ')');
                }
                if (typeof recordLlmEvent === 'function') {
                    recordLlmEvent(t.a, treatyTypeLabel(t.type) + ' expired with ' + countryList[t.b].name);
                    recordLlmEvent(t.b, treatyTypeLabel(t.type) + ' expired with ' + countryList[t.a].name);
                }
                continue;
            }
            if (t.type === 'province_transfer' && !t.executed) {
                // Страховка: договор мог быть восстановлен из автосейва до момента
                // исполнения. Выполняем передачу здесь; невалидно — расторгаем.
                if (executeProvinceTransfer(t)) {
                    t.executed = true;
                } else {
                    t.status = 'broken';
                    t.brokenBy = t.a;
                    t.brokenTurn = G.turnNumber;
                    if (typeof addGameLog === 'function') {
                        addGameLog('Провинция не может быть передана — договор расторгнут');
                    }
                }
                continue;
            }
            if (t.type === 'tribute') {
                const gold = parseInt(t.terms.gold_per_turn);
                if (gold > 0) {
                    const payer = countryList[t.a];
                    const receiver = countryList[t.b];
                    if (payer && receiver) {
                        // Клампим снизу нулём: иначе при отрицательной казне
                        // «платёж» отрицателен — плательщик богател, получатель платил.
                        const pay = Math.max(0, Math.min(payer.treasury || 0, gold));
                        payer.treasury -= pay;
                        receiver.treasury += pay;
                    }
                }
            }
        }
        // Разорванные договоры держим 5 ходов (история/отладка), потом удаляем —
        // иначе медленная утечка в долгих играх.
        G.treaties = G.treaties.filter(t =>
            t.status === 'active' ||
            (t.status === 'broken' && G.turnNumber - (t.brokenTurn || G.turnNumber) < 5)
        );
    }

    if (G.treatyProposals) {
        let hasStale = false;
        for (const p of G.treatyProposals) {
            if (p.status === 'pending' && G.turnNumber - p.turnProposed >= TREATY_PROPOSAL_TTL_TURNS) {
                p.status = 'declined';
                hasStale = true;
            }
        }
        if (hasStale) G.treatyProposals = G.treatyProposals.filter(p => p.status === 'pending');
    }

    for (const c of countryList) {
        if (c.reputation > 0) c.reputation = Math.max(0, c.reputation - 0.5);
        else if (c.reputation < 0) c.reputation = Math.min(0, c.reputation + 0.5);
    }

    for (const [k, w] of G.wars) {
        if (G.turnNumber - w.lastCombatTurn >= 5) {
            w.heat--;
        }

        for (const cid of [w.a, w.b]) {
            const c = countryList[cid];
            if (c) c.warExhaustion = (c.warExhaustion || 0) + WAR_EXHAUSTION_PER_TURN;
        }
    }

    const peaceQueue = [];
    const processedPairs = new Set();

    for (const [k, w] of G.wars) {
        const aIsBot = w.a !== G.playerCountryId;
        const bIsBot = w.b !== G.playerCountryId;

        const aWantsPeace = aIsBot ? shouldBotWantPeace(w.a, w.b) : false;
        const bWantsPeace = bIsBot ? shouldBotWantPeace(w.b, w.a) : false;

        if (aWantsPeace && bWantsPeace) {
            peaceQueue.push([w.a, w.b]);
            processedPairs.add(k);
        } else if (aWantsPeace && !bIsBot) {
            addPeaceProposal(G.playerCountryId, w.a);
        } else if (bWantsPeace && !aIsBot) {
            addPeaceProposal(G.playerCountryId, w.b);
        }
    }

    for (const [a, b] of peaceQueue) {
        makePeace(a, b);
    }

    for (const [k, w] of G.wars) {
        if (processedPairs.has(k)) continue;
        if (w.heat <= 0) {
            makePeace(w.a, w.b);
        }
    }

    // Очередь писем не должна расти бесконечно: держим непрочитанные
    // и прочитанные за последние 20 ходов (последние 10 видны в UI).
    if (G.letterQueue && G.letterQueue.length > 0) {
        G.letterQueue = G.letterQueue.filter(l => !l.read || l.sentRound >= G.turnNumber - 20);
        if (G.letterQueue.length > 400) G.letterQueue = G.letterQueue.slice(-400);
    }
}

function acceptPeace(enemyId) {
    const playerCid = G.playerCountryId;
    if (playerCid < 0) return false;
    if (!isAtWar(playerCid, enemyId)) return false;
    return makePeace(playerCid, enemyId);
}

// ---------- Мирные предложения: очередь вместо одного слота ----------
// Раньше _peaceProposalFrom был одним значением — при двух желающих мира
// последний перезаписывал первого. Теперь очередь + автоочистка невалидных.
function addPeaceProposal(toCid, fromCid) {
    const c = countryList[toCid];
    if (!c || toCid === fromCid || !countryList[fromCid]) return;
    if (!Array.isArray(c._peaceProposalsFrom)) c._peaceProposalsFrom = [];
    if (!c._peaceProposalsFrom.includes(fromCid)) c._peaceProposalsFrom.push(fromCid);
}
function removePeaceProposal(toCid, fromCid) {
    const c = countryList[toCid];
    if (!c || !Array.isArray(c._peaceProposalsFrom)) return;
    const i = c._peaceProposalsFrom.indexOf(fromCid);
    if (i >= 0) c._peaceProposalsFrom.splice(i, 1);
}
function getPeaceProposals(cid) {
    const c = countryList[cid];
    if (!c) return [];
    if (!Array.isArray(c._peaceProposalsFrom)) c._peaceProposalsFrom = [];
    // Отбрасываем протухшие: нет войны или страна-заявитель мертва
    c._peaceProposalsFrom = c._peaceProposalsFrom.filter(f =>
        countryList[f] && countryList[f].provinces.length > 0 && isAtWar(cid, f));
    return c._peaceProposalsFrom;
}
function rejectPeace(fromCid) {
    const playerCid = G.playerCountryId;
    if (playerCid < 0 || fromCid == null) return;
    removePeaceProposal(playerCid, fromCid);
    if (typeof addGameLog === 'function') addGameLog('Peace proposal rejected');
}

// Шанс, что бот примет мир, предложенный игроком вручную (кнопка в панели стран).
// shouldBotWantPeace — гарантированное согласие; иначе шанс растёт с длительностью
// войны и истощением. Раньше игрок почти не мог выйти из войны по своей инициативе.
function playerPeaceChance(enemyId) {
    const playerCid = G.playerCountryId;
    if (playerCid < 0 || !isAtWar(playerCid, enemyId)) return 0;
    if (shouldBotWantPeace(enemyId, playerCid)) return 1;
    const w = getWar(playerCid, enemyId);
    if (!w) return 0;
    const len = G.turnNumber - w.warStartTurn;
    if (len < 5) return 0;
    const enemy = countryList[enemyId];
    const ex = enemy ? (enemy.warExhaustion || 0) : 0;
    return Math.min(0.85, 0.1 + len * 0.03 + ex * 0.008);
}

function canDeclareWar(attackerId, defenderId) {
    if (isAtWar(attackerId, defenderId)) return false;

    if (treatiesBlockWar(attackerId, defenderId)) return false;

    const attacker = countryList[attackerId];
    if (!attacker) return false;
    if ((attacker.peaceGracePeriod || 0) > 0) return false;

    const defender = countryList[defenderId];
    if (!defender) return false;
    if ((defender.peaceGracePeriod || 0) > 0) return false;

    return true;
}

// ---------- Дипломатия ботов ----------

// Единая точка отправки писем (игрок, LLM, боты — общий счётчик id).
function sendLetter(fromCid, toCid, text) {
    if (!countryList[fromCid] || !countryList[toCid] || fromCid === toCid) return null;
    if (!G._letterIdCounter) G._letterIdCounter = 0;
    G.letterQueue = G.letterQueue || [];
    const letter = {
        id: ++G._letterIdCounter,
        fromCountryId: fromCid,
        toCountryId: toCid,
        text: String(text || '').slice(0, 400),
        sentRound: G.turnNumber,
        read: false
    };
    G.letterQueue.push(letter);
    return letter;
}

// Бот читает входящие письма и реагирует механически (relations + мирные
// инициативы). Раньше письма видел только LLM в снапшоте — переговоры
// с обычными ботами были фикцией.
function botReadLetters(cid) {
    const c = countryList[cid];
    if (!c) return;
    const letters = (G.letterQueue || []).filter(l => l.toCountryId === cid && !l.read);
    for (const l of letters) {
        l.read = true;
        if (!countryList[l.fromCountryId]) continue;
        c.relations = c.relations || {};
        const txt = String(l.text || '').toLowerCase();
        const cur = c.relations[l.fromCountryId] || 0;
        if (/мир|переговор|договор|пакт|союз|альянс/i.test(txt)) {
            c.relations[l.fromCountryId] = Math.min(100, cur + 12);
            if (isAtWar(cid, l.fromCountryId) && /мир|переговор/i.test(txt)) {
                addPeaceProposal(cid, l.fromCountryId);
            }
        } else if (/войн|уничтож|атак|напад/i.test(txt)) {
            c.relations[l.fromCountryId] = Math.max(-100, cur - 20);
        } else if (/дан|уступай|сдавай/i.test(txt)) {
            c.relations[l.fromCountryId] = Math.max(-100, cur - 10);
        } else {
            c.relations[l.fromCountryId] = Math.min(100, Math.max(-100, cur + 2));
        }
    }
}

// Бот отвечает на предложение мира (PROPOSE_PEACE от LLM/игрока).
// Раньше _peaceProposalFrom читали только снапшот LLM и игрок.
function botRespondToPeace(cid) {
    const c = countryList[cid];
    if (!c) return;
    for (const from of getPeaceProposals(cid).slice()) {
        if (!countryList[from] || !isAtWar(cid, from)) { removePeaceProposal(cid, from); continue; }
        const war = getWar(cid, from);
        const warLen = war ? G.turnNumber - war.warStartTurn : 0;
        let accept = shouldBotWantPeace(cid, from);
        if (!accept && warLen >= 5) {
            if ((c.warExhaustion || 0) >= 30) accept = true;
            else if (((c.relations && c.relations[from]) || 0) >= 10) accept = true;
            else if (Math.random() < 0.2) accept = true;
        }
        if (accept) {
            if (makePeace(cid, from)) {
                addGameLog(countryList[cid].name + ' принял мир с ' + countryList[from].name);
            }
        } else {
            addGameLog(countryList[cid].name + ' отклонил мир с ' + countryList[from].name);
        }
        removePeaceProposal(cid, from);
    }
}

// Бот сам пишет письма: мир при истощении, союз дружественному соседу.
function botSendLetters(cid) {
    if (Math.random() > 0.07) return;
    const c = countryList[cid];
    if (!c) return;
    if ((c.warExhaustion || 0) >= 30) {
        for (const [k, w] of (G.wars || [])) {
            const other = w.a === cid ? w.b : w.a;
            if (countryList[other] && countryList[other].provinces.length > 0 && Math.random() < 0.6) {
                sendLetter(cid, other, 'Предлагаю мир и переговоры.');
                addGameLog(c.name + ' предлагает мир стране ' + countryList[other].name);
                return;
            }
        }
        return;
    }
    for (const oc of countryList) {
        if (!oc || oc.id === cid || oc.provinces.length === 0) continue;
        if (isAtWar(cid, oc.id)) continue;
        const rel = (c.relations && c.relations[oc.id]) || 0;
        if (rel > 30 && !getActiveTreatyBetween(cid, oc.id, 'alliance') && Math.random() < 0.5) {
            sendLetter(cid, oc.id, 'Предлагаю союз и совместную оборону.');
            addGameLog(c.name + ' предлагает союз стране ' + oc.name);
            return;
        }
    }
}

function bordersCountry(a, b) {
    for (const pid of countryList[a].provinces) {
        const p = provinceList[pid];
        if (!p || p.cells <= 0) continue;
        for (const nbId of p.neighbors) {
            if (findCountryOfProvince(nbId) === b) return true;
        }
    }
    return false;
}

function botTreatyValue(cid, prop) {
    const c = countryList[cid];
    const other = prop.from === cid ? prop.to : prop.from;
    const oc = countryList[other];
    if (!c || !oc) return 0;
    const myArmy = getCountryArmy(cid);
    const enemyArmy = getCountryArmy(other);
    const myStr = myArmy + c.treasury * 0.5;
    const enemyStr = enemyArmy + oc.treasury * 0.5;
    const ratio = enemyStr > 0 ? myStr / enemyStr : 2;
    const border = bordersCountry(cid, other);
    const relation = (c.relations && c.relations[other]) || 0;

    let value = 0;
    switch (prop.type) {
        case 'non_aggression':
            if (isAtWar(cid, other)) value = -1;
            else if (!border) value = 1;
            else if (relation < -20) value = -5;
            else if (ratio < 0.7) value = 12;      // слабее соседа — выгодно
            else if (relation > 10) value = 6;
            else value = -3;
            break;
        case 'ceasefire':
            value = isAtWar(cid, other) ? 10 : -5;
            break;
        case 'tribute': {
            const gold = parseInt(prop.terms.gold_per_turn) || 0;
            const wePay = prop.from === cid;
            if (wePay) {
                if (ratio > 1.3 && relation > -10) value = -8;  // не платим сильному соседу без угрозы
                else if (ratio < 0.75 || relation < -20) value = 10; // слабый/под угрозой — откупаемся
                else value = 2;
            } else {
                value = ratio > 1.15 ? 8 : -4;       // берём дань у слабого
            }
            break;
        }
        case 'alliance':
            if (isAtWar(cid, other)) value = -1;
            else if (!border) value = -2;
            else if (relation < -30) value = -8;
            else if (ratio < 0.6) value = 9;
            else value = 1;
            break;
        case 'guarantee': {
            const weGuarantee = prop.from === cid;
            if (weGuarantee && ratio > 1.1) value = 5;
            else if (weGuarantee) value = -5;
            else if (ratio < 0.6 || relation > 20) value = 6;
            else value = -2;
            break;
        }
        case 'province_transfer': {
            // Боты не раздают провинции, но бесплатную провинцию получают охотно.
            if (prop.from === cid) value = -8;
            else {
                const p = provinceList[prop.terms.province_id];
                value = (!p || p.cells <= 0) ? -5 : 6 + Math.min(6, Math.round((p.population || 0) * 0.002));
            }
            break;
        }
        default:
            value = 0;
    }
    // Репутация: нарушителям договоров не доверяют, примерные страны — наоборот.
    const rep = c.reputation || 0;
    if (rep < 0) value -= Math.min(8, -rep * 0.2);
    else if (rep > 25) value += 2;
    return value;
}

function botRespondToProposals(cid) {
    if (!G.treatyProposals) return;
    for (const prop of G.treatyProposals.slice()) {
        if (prop.status !== 'pending') continue;
        if (prop.from !== cid && prop.to !== cid) continue; // чужие оферты не оцениваем
        if (prop.lastOfferBy === cid) continue;
        const value = botTreatyValue(cid, prop);
        if (value >= 6) {
            acceptTreatyProposal(prop.id, cid);
        } else if (value <= -4) {
            rejectTreatyProposal(prop.id, cid);
        }
    }
}

function botProposeTreaties(cid) {
    if (Math.random() > 0.12) return; // не спамить офертами
    const c = countryList[cid];
    if (!c) return;
    if ((c.reputation || 0) < -50) return; // изгоям никто не верит — оферты бессмысленны
    for (const oc of countryList) {
        if (oc.id === cid) continue; // игроку тоже предлагаем (перемирие/пакты/дань)
        if (oc.provinces.length === 0) continue;
        if (isAtWar(cid, oc.id)) {
            const w = getWar(cid, oc.id);
            if (!w || G.turnNumber - w.warStartTurn < 8) continue;
            if (!getActiveTreatyBetween(cid, oc.id, 'ceasefire')) {
                createTreatyProposal(cid, oc.id, 'ceasefire', { duration: 6 });
            }
            break;
        }
        if (Math.random() > 0.5) continue;
        if (treatiesBlockWar(cid, oc.id) || getActiveTreatyBetween(cid, oc.id, 'tribute')) continue;
        if (!bordersCountry(cid, oc.id)) continue;
        const myArmy = getCountryArmy(cid);
        const enemyArmy = getCountryArmy(oc.id);
        const myStr = myArmy + c.treasury * 0.5;
        const enemyStr = enemyArmy + oc.treasury * 0.5;
        const ratio = enemyStr > 0 ? myStr / enemyStr : 2;
        if (ratio < 0.75) {
            createTreatyProposal(cid, oc.id, 'non_aggression', { duration: 8 + ((Math.random() * 8) | 0) });
        } else if (ratio > 1.25) {
            createTreatyProposal(cid, oc.id, 'tribute', { duration: 8, gold_per_turn: Math.max(20, Math.round(oc.treasury * 0.03)) });
        }
        break;
    }
}

function botDiplomacy(cid) {
    if (!countryList[cid]) return;
    botReadLetters(cid);
    botRespondToPeace(cid);
    botRespondToProposals(cid);
    botProposeTreaties(cid);
    botSendLetters(cid);
}
