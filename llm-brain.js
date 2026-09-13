// ============================================================
// llm-brain.js — «мозг» LLM-противников.
//
// Корень проблемы со старым LLM-агентом: модель получала сырой снапшот и
// должна была САМА посчитать смежность, баланс сил, шанс победы и стоимость.
// Локальные модели (DeepSeek/GLM/Qwen на своих портах) это делают плохо:
// галлюцинируют ID провинций, идут в самоубийственные атаки, выдают
// невалидный JSON. Отсюда и ощущение «шлака».
//
// Здесь вся арифметика считается игрой ЗАРАНЕЕ и отдаётся модели готовой:
//   1) combatForecast  — точный прогноз боя по реальной боевой модели;
//   2) buildLegalMoves — только легальные ходы, с готовыми параметрами
//                        и оценкой (grounding: модель выбирает, а не выдумывает);
//   3) assessThreats   — где нас съедят, если ничего не делать;
//   4) llmObserveWorld — авто-память: факты о мире пишутся игрой, а не моделью;
//   5) parseLlmJson    — терпеливый парсер «грязного» JSON;
//   6) характер — это не только текст в промпте, но и веса в оценке ходов.
// ============================================================

// ---------- Характер: механические веса (а не только промпт) ----------

const LLM_PERSONALITY_WEIGHTS = {
    // attack  — насколько агрессивно выбирает цели
    // risk    — готовность терять войска и оголять тылы
    // safety  — требуемый запас сил сверх порога победы
    // diplo   — тяга к договорам, peace — готовность мириться
    // greed   — вес ценности провинции, warEager — готовность объявлять войну
    aggressive:  { attack: 1.35, risk: 1.30, safety: 1.08, diplo: 0.55, peace: 0.45, build: 0.85, greed: 1.25, warEager: 1.35 },
    defensive:   { attack: 0.55, risk: 0.55, safety: 1.90, diplo: 1.00, peace: 1.55, build: 1.35, greed: 0.70, warEager: 0.50 },
    diplomatic:  { attack: 0.75, risk: 0.80, safety: 1.25, diplo: 1.65, peace: 1.60, build: 1.15, greed: 0.85, warEager: 0.60 },
    opportunist: { attack: 1.05, risk: 1.00, safety: 1.05, diplo: 1.05, peace: 1.00, build: 1.00, greed: 1.10, warEager: 1.00 }
};

const LLM_MOVE_LIMITS = { attacks: 8, sea: 3, reinforces: 4, diplo: 8, builds: 3 };
const LLM_SYS_EVENTS_CAP = 20;

function llmWeights(personality) {
    return LLM_PERSONALITY_WEIGHTS[personality] || LLM_PERSONALITY_WEIGHTS.opportunist;
}

// ---------- 1. Точный прогноз боя ----------
//
// Боевая модель игры (combat.js, processCaptureTick) детерминирована:
//   dA/dt = -k*D,  dD/dt = -ar*A,   где k = defenseRate * defMult(фланги)
// Инвариант:  ar*A^2 - k*D^2 = const
// => атакующий побеждает, если A0 > D0*sqrt(k/ar), и сохраняет
//    sqrt(A0^2 - (k/ar)*D0^2) войск. Никакой случайности — значит
//    результат можно посчитать точно и показать модели.

function combatForecast(attacker, garrison, extraFronts) {
    const ar = (G && G.params && G.params.attackRate) || 0.05;
    const dr = (G && G.params && G.params.defenseRate) || 0.03;
    const fp = (G && G.params && G.params.flankDefensePenalty) || 0;
    const maxFronts = (G && G.params && G.params.flankMaxFronts) || 5;

    const A = Math.max(0, Math.round(attacker || 0));
    const D = Math.max(0, Math.round(garrison || 0));
    const F = Math.min(Math.max(1, 1 + (extraFronts || 0)), maxFronts);
    const defMult = (fp > 0 && F >= 2) ? Math.max(0, 1 - fp * (F - 1)) : 1;
    const k = dr * defMult;

    if (D <= 0) return { win: true, attackerLeft: A, defenderLeft: 0, need: 0, marginPct: 100, fronts: F, defMult, seconds: 0 };
    if (A <= 0) return { win: false, attackerLeft: 0, defenderLeft: D, need: Infinity, marginPct: -100, fronts: F, defMult, seconds: Infinity };
    if (k <= 0) return { win: true, attackerLeft: A, defenderLeft: 0, need: 0, marginPct: 100, fronts: F, defMult: 0, seconds: 0 };

    const need = D * Math.sqrt(k / ar);          // порог победы атакующего
    const omega = Math.sqrt(ar * k);
    const marginPct = Math.round((A / need - 1) * 100);

    let win, attackerLeft, defenderLeft, seconds;
    if (A > need) {
        win = true;
        attackerLeft = Math.round(Math.sqrt(Math.max(0, A * A - (k / ar) * D * D)));
        defenderLeft = 0;
        const x = (D * omega) / (ar * A);
        seconds = (x > 0 && x < 1) ? Math.atanh(x) / omega : Infinity;
    } else {
        win = false;
        attackerLeft = 0;
        defenderLeft = Math.round(Math.sqrt(Math.max(0, D * D - (ar / k) * A * A)));
        const x = (A * omega) / (k * D);
        seconds = (x > 0 && x < 1) ? Math.atanh(x) / omega : Infinity;
    }
    return { win, attackerLeft, defenderLeft, need: Math.round(need), marginPct, fronts: F, defMult, seconds };
}

// Сколько % гарнизона нужно отдать, чтобы гарантированно взять провинцию.
function recommendedAttackPct(fromArmy, garrison, extraFronts, safety) {
    if (!fromArmy || fromArmy <= 0) return 0;
    const fc = combatForecast(fromArmy, garrison, extraFronts);
    if (!isFinite(fc.need)) return 0;
    const want = fc.need * (safety || 1.05) + 1;
    const pct = Math.ceil(want / fromArmy * 100);
    return Math.max(10, Math.min(100, pct));
}

// ---------- 2. Ценность целей и сила стран ----------

function llmProvinceValue(p) {
    if (!p) return 0;
    let v = (p.population || 0) / 100 + (p.infrastructure || 0) * 0.6 + (p.cells || 0) * 0.05;
    if (p.port && p.port.built) v += 40 + (p.port.ships || 0) * 6;
    return v;
}

function llmCountryPower(cid) {
    const c = countryList[cid];
    if (!c) return 0;
    const provs = c.provinces.map(pid => provinceList[pid]).filter(p => p && p.cells > 0);
    const army = provs.reduce((s, p) => s + (p.army || 0), 0);
    const value = provs.reduce((s, p) => s + llmProvinceValue(p), 0);
    return army * 1.0 + value * 1.2 + Math.max(0, c.treasury || 0) * 0.05;
}

// Сколько соседних провинций врага могут одновременно бить по pid (фланги).
function llmFrontsAgainst(pid, attackerCountryId) {
    const p = provinceList[pid];
    if (!p) return 1;
    let n = 0;
    for (const nbId of p.neighbors) {
        const nb = provinceList[nbId];
        if (!nb || nb.cells <= 0) continue;
        if (findCountryOfProvince(nb.id) === attackerCountryId) n++;
    }
    return Math.max(1, n);
}

// ---------- 3. Генератор легальных ходов ----------

function buildLegalMoves(cid) {
    const c = countryList[cid];
    const cfg = (typeof llmCountryConfig === 'function') ? llmCountryConfig(cid) : { personality: 'opportunist', status: {} };
    const W = llmWeights(cfg.personality);
    const out = { attacks: [], sea: [], reinforces: [], diplo: [], builds: [], byId: {}, threats: [] };
    if (!c || !c.provinces || c.provinces.length === 0) return out;

    const myProvs = c.provinces.map(pid => provinceList[pid]).filter(p => p && p.cells > 0);
    const myIds = new Set(myProvs.map(p => p.id));
    const myArmy = myProvs.reduce((s, p) => s + (p.army || 0), 0);
    const avgArmy = myProvs.length ? myArmy / myProvs.length : 0;

    const reg = (kind, action, line, score, note) => {
        const prefix = { attack: 'A', sea: 'S', reinforce: 'R', diplo: 'D', build: 'B' }[kind] || 'X';
        const bucket = kind === 'attack' ? 'attacks' : (kind === 'sea' ? 'sea' : (kind === 'reinforce' ? 'reinforces' : (kind === 'diplo' ? 'diplo' : 'builds')));
        const id = prefix + (out[bucket].length + 1);
        const mv = { id, kind, action, line, score: Math.round(score), note: note || null };
        out[bucket].push(mv);
        out.byId[id] = mv;
        return mv;
    };

    // --- Атака: нужен ли акт войны ---
    const warCost = (ocid) => {
        if (isAtWar(cid, ocid)) return 0;
        if (!canDeclareWar(cid, ocid)) return Infinity;
        let penalty = 18 * (2 - W.warEager);
        const oc = countryList[ocid];
        if (oc) {
            for (const ally of getDefensiveAllies(ocid)) if (ally !== ocid) penalty += Math.min(35, getCountryArmy(ally) * 0.03);
            for (const g of getGuarantors(ocid)) penalty += Math.min(35, getCountryArmy(g) * 0.03);
            if (ocid === G.playerCountryId) penalty += 15; // игрок — не «магнит для войн»
        }
        return penalty;
    };

    // --- Сухопутные атаки ---
    for (const from of myProvs) {
        if (from.army <= 0) continue;
        for (const nbId of from.neighbors) {
            const to = provinceList[nbId];
            if (!to || to.cells <= 0) continue;
            const ocid = findCountryOfProvince(to.id);
            if (ocid < 0 || ocid === cid) continue;
            const wCost = warCost(ocid);
            if (!isFinite(wCost)) continue;                       // пакт/перемирие — ход невозможен

            const fronts = llmFrontsAgainst(to.id, cid);
            const pct = recommendedAttackPct(from.army, to.army, fronts - 1, W.safety);
            const commit = Math.floor(from.army * pct / 100);
            const fc = combatForecast(commit, to.army, fronts - 1);
            const oc = countryList[ocid];
            const distracted = ocid !== G.playerCountryId && oc && (typeof isAnyWarFor === 'function') && isAnyWarFor(ocid) && !isAtWar(cid, ocid);
            const exposes = (from.army - commit) < Math.max(8, avgArmy * 0.25) &&
                [...from.neighbors].some(n => { const q = provinceList[n]; return q && q.cells > 0 && !myIds.has(q.id) && (q.army || 0) > (from.army - commit); });
            const isCapital = oc && to.id === oc.capital;

            let score = llmProvinceValue(to) * 0.35 * W.greed;
            if (isCapital) score += 30;
            if (fc.win) score += 55 + Math.min(25, (fc.attackerLeft / Math.max(1, commit)) * 35);
            else score -= 60 * (2 - W.risk) * 0.7;
            score -= wCost;
            score += (fronts - 1) * 8;
            if (distracted) score += 14 * W.attack;
            if (exposes) score -= 22 * (2 - W.risk);
            score *= W.attack;

            const why = fc.win
                ? 'WIN, you keep ~' + fc.attackerLeft + (fc.seconds < Infinity ? ', ~' + Math.max(1, Math.round(fc.seconds)) + 's' : '')
                : 'LOSE, enemy keeps ~' + fc.defenderLeft;
            const line = 'P' + from.id + '(army ' + Math.round(from.army) + ')->P' + to.id + '[' + (oc ? oc.name : '?') + ']' +
                (isCapital ? '(CAPITAL)' : '') + ' commit ' + commit + '(' + pct + '%) vs garrison ' + Math.round(to.army) +
                (fronts > 1 ? ', ' + fronts + ' fronts' : '') + ' | ' + why +
                ' | gain pop' + Math.round(to.population || 0) + '/infra' + Math.round(to.infrastructure || 0) +
                (isAtWar(cid, ocid) ? '' : ' | NEEDS DECLARE_WAR') +
                (exposes ? ' | EXPOSES P' + from.id : '');
            reg('attack', { type: 'ATTACK', from: from.id, to: to.id, army_pct: pct }, line, score, fc.win ? 'win' : 'lose');
        }
    }

    // --- Морские десанты ---
    const portProvs = myProvs.filter(p => p.port && p.port.built);
    if (portProvs.length) {
        const coastals = [];
        for (const oc of countryList) {
            if (!oc || oc.id === cid || !oc.provinces || oc.provinces.length === 0) continue;
            for (const pid of oc.provinces) {
                const p = provinceList[pid];
                if (p && p.cells > 0 && p.isCoastal) coastals.push({ p, ocid: oc.id });
            }
        }
        for (const from of portProvs) {
            if (from.army <= 0) continue;
            const idle = (G.ships || []).filter(s => s.portProvinceId === from.id && s.state === 'idle').length;
            if (idle <= 0) continue;
            for (const cand of coastals) {
                const to = cand.p, ocid = cand.ocid;
                if (myIds.has(to.id)) continue;
                if (to.id === from.id) continue;
                if (typeof canSeaTravel !== 'function' || !canSeaTravel(from, to)) continue;
                const wCost = warCost(ocid);
                if (!isFinite(wCost)) continue;
                const maxByShips = idle * (G.params.shipCapacity || 1500);
                let pct = recommendedAttackPct(from.army, to.army, 0, W.safety);
                while (pct > 10 && Math.floor(from.army * pct / 100) > maxByShips) pct -= 5;
                const commit = Math.floor(from.army * pct / 100);
                if (commit <= 0 || commit > maxByShips) continue;
                const fc = combatForecast(commit, to.army, 0);
                let score = llmProvinceValue(to) * 0.35 * W.greed;
                if (fc.win) score += 50; else score -= 55 * (2 - W.risk) * 0.7;
                score -= wCost;
                score *= W.attack;
                const oc = countryList[ocid];
                reg('sea',
                    { type: 'SEA_ATTACK', from_port_province: from.id, to: to.id, army_pct: pct },
                    'SEA P' + from.id + '(port,' + idle + ' ships)->P' + to.id + '[' + (oc ? oc.name : '?') + '] commit ' + commit + '(' + pct + '%) vs ' +
                    Math.round(to.army) + ' | ' + (fc.win ? 'WIN, keep ~' + fc.attackerLeft : 'LOSE, enemy keeps ~' + fc.defenderLeft) +
                    (isAtWar(cid, ocid) ? '' : ' | NEEDS DECLARE_WAR'),
                    score, fc.win ? 'win' : 'lose');
            }
        }
    }

    // --- Оборона: кого спасать и чем ---
    const incoming = {};
    for (const cap of (G.captures || [])) {
        if (!cap.isActive) continue;
        if (cap.defenderCountryId !== cid) continue;
        const cur = incoming[cap.targetProvinceId] || { army: 0, fronts: new Set() };
        cur.army += cap.attackerArmy || 0;
        cur.fronts.add(cap.attackerProvinceId);
        incoming[cap.targetProvinceId] = cur;
    }
    for (const pid in incoming) {
        const target = provinceList[parseInt(pid, 10)];
        if (!target || target.cells <= 0) continue;
        const inc = incoming[pid];
        const fcNow = combatForecast(inc.army, target.army, Math.max(0, inc.fronts.size - 1));
        // Ищем лучшего донора среди соседей.
        let best = null;
        for (const nbId of target.neighbors) {
            const nb = provinceList[nbId];
            if (!nb || nb.cells <= 0 || !myIds.has(nb.id)) continue;
            if ((nb.army || 0) < 10) continue;
            if (Object.prototype.hasOwnProperty.call(incoming, nb.id)) continue; // донор сам под атакой
            const pct = 60;
            const moved = Math.floor(nb.army * pct / 100);
            const fcAfter = combatForecast(inc.army, target.army + moved, Math.max(0, inc.fronts.size - 1));
            const gain = (fcAfter.win ? 100 : 0) - (fcNow.win ? 100 : 0) + (fcAfter.defenderLeft - fcNow.defenderLeft) * 0.05;
            if (!best || gain > best.gain) best = { nb, pct, moved, fcAfter, gain };
        }
        const danger = fcNow.win ? 20 : 90;   // «нас возьмут» — приоритет выше любой атаки
        if (best && (best.gain > 0 || danger >= 90)) {
            const line = 'P' + best.nb.id + '->P' + target.id + ' move ' + best.pct + '% (' + best.moved + ' войск): ' +
                (fcNow.win ? 'сейчас ДЕРЖИТСЯ' : 'сейчас ПАДАЕТ') + ' → ' + (best.fcAfter.win ? 'удержим' : 'всё равно падает, но замедлим');
            reg('reinforce', { type: 'REINFORCE', from: best.nb.id, to: target.id, army_pct: best.pct }, line,
                danger + Math.max(0, best.gain) + llmProvinceValue(target) * 0.2, fcNow.win ? 'ok' : 'critical');
        } else {
            out.threats.push({ pid: target.id, win: fcNow.win, incoming: Math.round(inc.army), garrison: Math.round(target.army) });
        }
    }

    // --- Стягивание к фронту (тыл → граница) ---
    for (const from of myProvs) {
        if ((from.army || 0) < avgArmy * 1.6) continue;
        if (from.id === c.capital) continue;
        for (const nbId of from.neighbors) {
            const to = provinceList[nbId];
            if (!to || to.cells <= 0 || !myIds.has(to.id)) continue;
            if ((to.army || 0) > avgArmy * 0.8) continue;
            const enemyNb = [...to.neighbors].some(n => { const q = provinceList[n]; return q && q.cells > 0 && !myIds.has(q.id); });
            if (!enemyNb) continue;
            const pct = 40;
            const line = 'P' + from.id + '->P' + to.id + ' move ' + pct + '% (' + Math.floor(from.army * pct / 100) + ' войск) — усилить границу';
            reg('reinforce', { type: 'REINFORCE', from: from.id, to: to.id, army_pct: pct }, line, 8 + (to.army < avgArmy * 0.4 ? 10 : 0), 'shift');
            break;
        }
    }

    // --- Дипломатия ---
    const diploSeen = new Set();
    for (const oc of countryList) {
        if (!oc || oc.id === cid || !oc.provinces || oc.provinces.length === 0) continue;
        const atWar = isAtWar(cid, oc.id);
        if (atWar) {
            const w = getWar(cid, oc.id);
            const turns = w ? (G.turnNumber - w.warStartTurn) : 0;
            const myPower = llmCountryPower(cid), ocPower = llmCountryPower(oc.id);
            const war = getWar(cid, oc.id);
            const exhausted = Math.max(c.warExhaustion || 0, oc.warExhaustion || 0);
            let score = 0;
            if (exhausted >= 60) score += 30 * W.peace;
            if (myPower < ocPower * 0.8) score += 25 * W.peace;
            if (turns >= 12) score += 10 * W.peace;
            if (myPower > ocPower * 1.4) score -= 35 * W.peace;
            reg('diplo', { type: 'PROPOSE_PEACE', target_country: oc.id },
                'PROPOSE_PEACE ' + oc.name + '(id:' + oc.id + ') — война ' + turns + ' ходов, истощение ' + Math.round(exhausted) +
                ', силы ' + (myPower >= ocPower ? 'у вас перевес' : 'вы слабее'),
                score, 'peace');
            reg('diplo', { type: 'PROPOSE_TREATY', treaty_type: 'ceasefire', target_country: oc.id, terms: { duration: 8 } },
                'PROPOSE_TREATY ceasefire ' + oc.name + '(id:' + oc.id + ') на 8 ходов', score - 5, 'ceasefire');
        } else {
            const canWar = canDeclareWar(cid, oc.id);
            const border = oc.provinces.some(pid => {
                const p = provinceList[pid];
                if (!p) return false;
                for (const n of p.neighbors) if (myIds.has(n)) return true;
                return false;
            });
            if (canWar) {
                const myPower = llmCountryPower(cid), ocPower = llmCountryPower(oc.id);
                const ratio = ocPower > 0 ? myPower / ocPower : 9;
                let score = 0;
                if (ratio > 1.3) score += 25 * W.warEager;
                if (ratio < 0.9) score -= 30;
                if (border) score += 10;
                if (typeof isAnyWarFor === 'function' && isAnyWarFor(oc.id)) score += 12 * W.warEager;
                score -= (c.relations && c.relations[oc.id] > 40 ? 20 : 0);
                reg('diplo', { type: 'DECLARE_WAR', target_country: oc.id },
                    'DECLARE_WAR ' + oc.name + '(id:' + oc.id + ') — ' + (border ? 'есть граница' : 'границы нет') +
                    ', силы ' + ratio.toFixed(2) + ':1, провинций ' + oc.provinces.length,
                    score, 'war');
            }
            // Пакты: с сильным соседом — ненападение, с сильным не-соседом — союз против общего врага.
            const pendingBetween = (type) => getIncomingProposals(cid).some(p => p.from === oc.id && p.type === type) ||
                getIncomingProposals(oc.id).some(p => p.from === cid && p.type === type);
            const pact = getActiveTreatyBetween(cid, oc.id, 'non_aggression');
            if (!pact && !getActiveTreatyBetween(cid, oc.id, 'alliance')) {
                const myPower = llmCountryPower(cid), ocPower = llmCountryPower(oc.id);
                if (border && ocPower > myPower * 0.8 && !pendingBetween('non_aggression')) {
                    reg('diplo', { type: 'PROPOSE_TREATY', treaty_type: 'non_aggression', target_country: oc.id, terms: { duration: 12 } },
                        'PROPOSE_TREATY non_aggression ' + oc.name + '(id:' + oc.id + ') на 12 ходов — сильный сосед',
                        14 * W.diplo, 'nap');
                } else if (!border && ocPower > myPower * 0.9 && !pendingBetween('alliance')) {
                    reg('diplo', { type: 'PROPOSE_TREATY', treaty_type: 'alliance', target_country: oc.id, terms: { duration: 15 } },
                        'PROPOSE_TREATY alliance ' + oc.name + '(id:' + oc.id + ') на 15 ходов — дальний сильный партнёр',
                        10 * W.diplo, 'alliance');
                }
            }
        }
    }

    // Ответы на входящие оферты — оцениваем игровой функцией botTreatyValue.
    for (const prop of getIncomingProposals(cid)) {
        if (diploSeen.has(prop.id)) continue;
        diploSeen.add(prop.id);
        const from = countryList[prop.from];
        let val = 0;
        if (typeof botTreatyValue === 'function') { try { val = botTreatyValue(cid, prop); } catch (e) { val = 0; } }
        const terms = [];
        if (prop.terms) {
            if (prop.terms.duration) terms.push('duration ' + prop.terms.duration);
            if (prop.terms.gold_per_turn) terms.push('gold/turn ' + prop.terms.gold_per_turn);
            if (prop.terms.province_id != null) terms.push('province P' + prop.terms.province_id);
        }
        const head = 'оферта id:' + prop.id + ' ' + treatyTypeLabel(prop.type) + ' от ' + (from ? from.name : '?') +
            '(id:' + prop.from + ') [' + terms.join(', ') + '] ценность для вас ' + (val >= 0 ? '+' : '') + Math.round(val);
        if (val > 0) reg('diplo', { type: 'ACCEPT_TREATY', proposal_id: prop.id }, 'ACCEPT_TREATY — ' + head, 20 + val * W.diplo, 'accept');
        else reg('diplo', { type: 'REJECT_TREATY', proposal_id: prop.id }, 'REJECT_TREATY — ' + head, 6 - val, 'reject');
        reg('diplo', {
            type: 'COUNTER_TREATY',
            proposal_id: prop.id,
            terms: Object.assign({}, prop.terms || {}, { duration: Math.max(5, Math.round(((prop.terms && prop.terms.duration) || 10) * 1.5)) })
        }, 'COUNTER_TREATY — ' + head + ' (торг: срок длиннее)', 4, 'counter');
    }

    // Ответы на предложения мира.
    for (const fromCid of getPeaceProposals(cid)) {
        const fc = countryList[fromCid];
        reg('diplo', { type: 'ACCEPT_PEACE', from_country: fromCid },
            'ACCEPT_PEACE — предложение мира от ' + (fc ? fc.name : '?') + '(id:' + fromCid + ')', 12 * W.peace, 'accept-peace');
    }

    // --- Строительство ---
    for (const p of myProvs) {
        if (p.port && p.port.built) continue;
        if (!p.isCoastal) continue;
        if ((c.treasury || 0) < G.params.portCost) continue;
        // Тот же запрет, что и в validateAndExecuteAction: порт во внутреннем
        // водоёме строить нельзя. Без этой проверки список ходов предлагал
        // заведомо незаконную стройку (видно в llm-eval как «нельзя строить
        // порт во внутреннем водоёме»).
        const pos = (typeof findPortVisualPosition === 'function') ? findPortVisualPosition(p) : null;
        const vx = pos ? pos.vx : -1, vy = pos ? pos.vy : -1;
        const wrId = (vx >= 0 && G.waterRegionOf && typeof idxOf === 'function') ? G.waterRegionOf[idxOf(vx, vy)] : -1;
        if (wrId >= 0 && G.waterIsOcean && G.waterIsOcean[wrId] === false) continue;
        reg('build', { type: 'BUILD_PORT', province: p.id },
            'BUILD_PORT P' + p.id + ' (стоимость ' + G.params.portCost + ', казна ' + Math.round(c.treasury) + ')',
            12 * W.build, 'port');
        break;
    }
    for (const p of portProvs) {
        if (p.port.ships >= G.params.maxShipsPerPort) continue;
        if ((c.treasury || 0) < G.params.shipCost) continue;
        reg('build', { type: 'BUILD_SHIP', province: p.id },
            'BUILD_SHIP P' + p.id + ' (кораблей ' + p.port.ships + '/' + G.params.maxShipsPerPort + ', цена ' + G.params.shipCost + ')',
            8 * W.build, 'ship');
        break;
    }

    // Сортировка и подрезка каждой группы.
    for (const key of ['attacks', 'sea', 'reinforces', 'diplo', 'builds']) {
        out[key].sort((a, b) => b.score - a.score);
        out[key] = out[key].slice(0, LLM_MOVE_LIMITS[key] || 5);
    }
    // ID переназначаем после сортировки, чтобы A1 всегда был лучшим ходом.
    out.byId = {};
    for (const key of ['attacks', 'sea', 'reinforces', 'diplo', 'builds']) {
        const prefix = { attacks: 'A', sea: 'S', reinforces: 'R', diplo: 'D', builds: 'B' }[key];
        out[key].forEach((mv, i) => { mv.id = prefix + (i + 1); out.byId[mv.id] = mv; });
    }
    return out;
}

// Компактный текст списка ходов для снапшота.
function renderLegalMoves(moves) {
    const L = [];
    const push = (title, arr, hint) => {
        if (!arr || arr.length === 0) return;
        L.push(title + (hint ? ' ' + hint : ''));
        for (const mv of arr) L.push(mv.id + ' | ' + mv.line + ' | score ' + mv.score);
    };
    push('ATTACKS (готовые ходы — бери id в поле "move"):', moves.attacks);
    push('SEA ATTACKS:', moves.sea);
    push('REINFORCE:', moves.reinforces);
    push('DIPLOMACY:', moves.diplo);
    push('BUILD:', moves.builds);
    if (L.length === 0) L.push('(легальных ходов нет — жди или пиши письма)');
    return L;
}

// Ссылка на готовый ход: 'A2', 'a2', 'A-2'. Числа НЕ принимаем (иначе
// спутали бы с id провинций).
function resolveMoveRef(cid, ref) {
    if (ref == null) return null;
    const cfg = (typeof llmCountryConfig === 'function') ? llmCountryConfig(cid) : null;
    const byId = cfg && cfg.status && cfg.status.legalMoves ? cfg.status.legalMoves.byId : null;
    if (!byId) return null;
    const m = String(ref).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[ASRDB]\d+$/.test(m)) return null;
    const mv = byId[m];
    return mv ? mv.action : null;
}

// ---------- 4. Угрозы: где нас съедят ----------

function assessThreats(cid, moves, maxLines) {
    const items = [];
    const c = countryList[cid];
    const isCap = (pid) => c && c.capital === pid;
    // Уже идущий штурм важнее гипотетического удара.
    for (const th of (moves.threats || [])) {
        const p = provinceList[th.pid];
        if (!p) continue;
        items.push({
            sev: (th.win ? 100 : 400) + llmProvinceValue(p) + (isCap(th.pid) ? 1000 : 0),
            line: 'P' + th.pid + ' — штурм идёт: incoming ' + th.incoming + ' vs garrison ' + th.garrison +
                ' → ' + (th.win ? 'hold' : 'FALLS, нужно подкрепление')
        });
    }
    // Превентивно: чем нас могут ударить в следующем ходу.
    if (c) {
        const myIds = new Set(c.provinces);
        for (const pid of c.provinces) {
            const p = provinceList[pid];
            if (!p || p.cells <= 0) continue;
            let worst = null;
            for (const nbId of p.neighbors) {
                const nb = provinceList[nbId];
                if (!nb || nb.cells <= 0) continue;
                // «Своё» определяем по карте владельцев, а не по списку
                // c.provinces: это единственный источник правды и для боя.
                const ocid = findCountryOfProvince(nb.id);
                if (ocid < 0 || ocid === cid) continue;
                if (!isAtWar(cid, ocid) && !canDeclareWar(cid, ocid)) continue;
                const commit = Math.floor((nb.army || 0) * 0.75);
                if (commit < 10) continue;
                const fc = combatForecast(commit, p.army, llmFrontsAgainst(p.id, ocid) - 1);
                if (!fc.win) continue;
                if (!worst || commit > worst.commit) worst = { commit, from: nb.id, ocid, fc };
            }
            if (worst) {
                const oc = countryList[worst.ocid];
                items.push({
                    sev: 200 + llmProvinceValue(p) + (isCap(pid) ? 1000 : 0),
                    line: 'P' + pid + ' уязвима: удар с P' + worst.from + '[' + (oc ? oc.name : '?') + '] ~' + worst.commit +
                        ' войск ' + (isAtWar(cid, worst.ocid) ? '' : '(войны пока нет) ') +
                        '→ провинцию заберут, останется ~' + worst.fc.attackerLeft
                });
            }
        }
    }
    // Режем список по важности: столица и падающие провинции — первыми.
    items.sort((a, b) => b.sev - a.sev);
    return items.slice(0, maxLines || 6).map(i => i.line);
}

// ---------- 5. Наблюдатель мира: авто-память ----------
//
// Модель не должна «запоминать» войну — игра сама знает, что произошло.
// Сравниваем снимок мира с прошлым раундом и пишем факты в память.

function llmWorldSignature(cid) {
    const c = countryList[cid];
    const sig = { wars: [], provs: [], treaties: [], capital: c ? c.capital : -1, power: Math.round(llmCountryPower(cid)) };
    for (const [k, w] of (G.wars || [])) {
        if (w.a === cid || w.b === cid) sig.wars.push((w.a === cid ? w.b : w.a));
    }
    sig.wars.sort((a, b) => a - b);
    if (c) sig.provs = c.provinces.slice().sort((a, b) => a - b);
    for (const t of getActiveTreatiesFor(cid)) sig.treaties.push(t.type + ':' + (t.a === cid ? t.b : t.a));
    sig.treaties.sort();
    return sig;
}

function llmObserveWorld(cid) {
    const cfg = (typeof llmCountryConfig === 'function') ? llmCountryConfig(cid) : null;
    if (!cfg) return;
    const c = countryList[cid];
    if (!c) return;
    const mem = (typeof getLlmMemory === 'function') ? getLlmMemory(c) : (c.llmMemory = c.llmMemory || { goals: [], enemy_models: {}, key_events: [], strategic_notes: [] });
    mem.sys_events = mem.sys_events || [];
    const prev = cfg.status.worldSig;
    const now = llmWorldSignature(cid);
    const add = (text) => {
        mem.sys_events.push({ turn: G.turnNumber, event: text });
        if (mem.sys_events.length > LLM_SYS_EVENTS_CAP) mem.sys_events.splice(0, mem.sys_events.length - LLM_SYS_EVENTS_CAP);
    };

    if (prev) {
        for (const w of now.wars) if (!prev.wars.includes(w)) add('ВОЙНА НАЧАЛАСЬ с ' + (countryList[w] ? countryList[w].name : w));
        for (const w of prev.wars) if (!now.wars.includes(w)) add('мир заключён с ' + (countryList[w] ? countryList[w].name : w));
        const prevSet = new Set(prev.provs);
        const nowSet = new Set(now.provs);
        for (const pid of prev.provs) if (!nowSet.has(pid)) add('ПОТЕРЯНА провинция P' + pid);
        for (const pid of now.provs) if (!prevSet.has(pid)) add('захвачена провинция P' + pid);
        for (const t of prev.treaties) if (!now.treaties.includes(t)) add('договор прекращён: ' + t);
        for (const t of now.treaties) if (!prev.treaties.includes(t)) add('заключён договор: ' + t);
        if (prev.capital !== now.capital) add('СТОЛИЦА ПОТЕРЯНА');
        if (prev.power > 0 && now.power < prev.power * 0.85) add('сила страны упала (' + prev.power + ' → ' + now.power + ')');
    }

    // Нарушенные договоры — факты из журнала, а не догадки модели.
    for (const t of (G.treaties || [])) {
        if (t.status !== 'broken' || (t.a !== cid && t.b !== cid)) continue;
        if (t.brokenBy == null || t.brokenBy === cid) continue;
        const tag = 'broken:' + t.id;
        if (mem.sys_events.some(e => e.tag === tag)) continue;
        const ev = { turn: t.brokenTurn || G.turnNumber, event: (countryList[t.brokenBy] ? countryList[t.brokenBy].name : t.brokenBy) + ' НАРУШИЛ(а) ' + treatyTypeLabel(t.type) + ' с вами' };
        ev.tag = tag;
        mem.sys_events.push(ev);
        if (mem.sys_events.length > LLM_SYS_EVENTS_CAP) mem.sys_events.splice(0, mem.sys_events.length - LLM_SYS_EVENTS_CAP);
    }
    cfg.status.worldSig = now;
}

// ---------- 6. Терпеливый парсер JSON ----------

function repairJsonText(txt) {
    let s = String(txt == null ? '' : txt);
    // Вырезаем markdown-забор и всё до первой { / после последней }
    s = s.replace(/^[\s\S]*?```(?:json)?/i, '').replace(/```[\s\S]*$/, '');
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    else if (first >= 0) s = s.slice(first) + '}';

    // Пошагово: сначала пробуем «как есть», потом всё более агрессивные починки.
    const attempts = [s];
    const stripComments = x => x.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"\\])\/\/[^\n]*/g, '$1');
    const fixLiterals = x => x.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
        .replace(/\bNaN\b/g, 'null').replace(/\bInfinity\b/g, 'null');
    const fixTrailing = x => x.replace(/,\s*([}\]])/g, '$1');
    const fixQuotes = x => x.replace(/([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*:)/g, '$1"$2"$3')
        .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
    const fixKeys = x => x.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    const dropCtl = x => x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');

    attempts.push(dropCtl(s));
    attempts.push(fixTrailing(dropCtl(s)));
    attempts.push(fixLiterals(fixTrailing(stripComments(dropCtl(s)))));
    attempts.push(fixKeys(fixLiterals(fixTrailing(stripComments(dropCtl(s))))));
    attempts.push(fixQuotes(fixKeys(fixLiterals(fixTrailing(stripComments(dropCtl(s)))))));
    // Балансировка скобок (модель оборвала ответ на max_tokens).
    const balance = (x) => {
        let stack = '', inStr = false, esc = false;
        for (const ch of x) {
            if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
            if (ch === '"') inStr = true;
            else if (ch === '{') stack += '}';
            else if (ch === '[') stack += ']';
            else if (ch === '}' || ch === ']') stack = stack.slice(0, -1);
        }
        if (inStr) x += '"';
        x = fixTrailing(x);
        return x + stack.split('').reverse().join('');
    };
    attempts.push(balance(fixQuotes(fixKeys(fixLiterals(fixTrailing(stripComments(dropCtl(s))))))));

    for (const cand of attempts) {
        try {
            const v = JSON.parse(cand);
            if (v && typeof v === 'object') return v;
        } catch (e) { /* следующий вариант */ }
    }
    return null;
}

// Единая точка разбора ответа модели: null = не удалось даже после починки.
function parseLlmJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const txt = raw.trim();
    if (!txt) return null;
    try {
        const v = JSON.parse(txt);
        if (v && typeof v === 'object') return v;
    } catch (e) { /* чиним дальше */ }
    return repairJsonText(txt);
}
