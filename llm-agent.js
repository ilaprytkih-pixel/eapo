// ============================================================
// LLM-агенты: снапшот, раундовый gate, валидация, память, письма
// ============================================================

const LLM_PRESETS = {
    deepseek: { label: 'DeepSeek :9655', endpoint: 'http://127.0.0.1:9655', model: 'deepseek-chat' },
    glm:      { label: 'GLM/Kimi :9766', endpoint: 'http://127.0.0.1:9766', model: 'glm-5.2' },
    qwen:     { label: 'Qwen :3264',     endpoint: 'http://127.0.0.1:3264/api', model: 'qwen3.7-max' }
};

const LLM_PERSONALITIES = ['aggressive', 'defensive', 'diplomatic', 'opportunist'];

const LLM_ACTION_LIMITS = { attacks: 3, reinforces: 2, diplo: 1, letters: 2, builds: 1 };
const LLM_MAX_LISTED_PROVINCES = 25;
const LLM_BOT_FALLBACK_ROUNDS = 5;
const LLM_INVALID_STREAK_LIMIT = 3;

const PERSONALITY_PROMPTS = {
    aggressive: 'Приоритет — территориальная экспансия. Атакуй при малейшем превосходстве, не бойся риска. Слабый сосед — законная цель.',
    defensive: 'Приоритет — безопасность границ. Атакуй только при явном превосходстве. Усиливай провинции под атакой. Мир предпочтительнее рискованной войны.',
    diplomatic: 'Приоритет — союзы, письма и переговоры. Война — последнее средство, только при явной угрозе. Договорённости ценны, но помни: другие могут лгать.',
    opportunist: 'Атакуй слабых, договаривайся с сильными. Используй чужие войны себе на пользу. Не подставляйся, выбирай момент.'
};

function isAnyWarFor(cid) {
    if (!G.wars) return false;
    for (const [k, w] of G.wars) {
        if (w.a === cid || w.b === cid) return true;
    }
    return false;
}

// ---------- Конфигурация ----------

function pushLlmActivity(cid, text) {
    if (!G.llm) G.llm = { enabled: false, roundTicks: 30, deadlineMs: 6000, maxTokens: 400, temperature: 0.5, countries: {} };
    G.llm.activity = G.llm.activity || [];
    const c = countryList[cid];
    const stamp = new Date().toTimeString().slice(0, 8);
    G.llm.activity.push({ t: stamp, cid: cid, name: c ? c.name : '?', text: String(text).slice(0, 200) });
    if (G.llm.activity.length > 60) G.llm.activity.splice(0, G.llm.activity.length - 60);
    if (typeof refreshLlmPanelStatus === 'function') refreshLlmPanelStatus();
}

function actionLabel(a) {
    if (!a || typeof a !== 'object') return '?';
    const t = a.type;
    switch (t) {
        case 'ATTACK': return 'атака ' + a.from + '→' + a.to + ' (' + a.army_pct + '%)';
        case 'SEA_ATTACK': return 'морской десант ' + a.from_port_province + '→' + a.to;
        case 'REINFORCE': return 'переброска ' + a.from + '→' + a.to + ' (' + a.army_pct + '%)';
        case 'DECLARE_WAR': return 'война против страны ' + a.target_country;
        case 'PROPOSE_PEACE': return 'предложение мира стране ' + a.target_country;
        case 'ACCEPT_PEACE': return 'принят мир со страной ' + a.from_country;
        case 'REJECT_PEACE': return 'отклонён мир со страной ' + a.from_country;
        case 'PROPOSE_TREATY': return 'предложен договор (' + (a.type_treaty || a.treaty_type || '?') + ') стране ' + a.target_country;
        case 'COUNTER_TREATY': return 'контр-предложение по оферте ' + a.proposal_id;
        case 'ACCEPT_TREATY': return 'принята оферта ' + a.proposal_id;
        case 'REJECT_TREATY': return 'отклонена оферта ' + a.proposal_id;
        case 'TERMINATE_TREATY': return 'разорван договор ' + a.treaty_id;
        case 'BUILD_PORT': return 'порт в провинции ' + a.province;
        case 'BUILD_SHIP': return 'корабль в провинции ' + a.province;
        case 'SEND_LETTER': return 'письмо стране ' + a.to_country;
        case 'WAIT': return 'выжидание';
        default: return String(t);
    }
}

function llmGetStoredApiKey() {
    try {
        return (typeof localStorage !== 'undefined' && localStorage.getItem) ? (localStorage.getItem('llmApiKey') || '') : '';
    } catch (e) {
        return '';
    }
}

function llmCountryConfig(cid) {
    if (!G.llm) G.llm = { enabled: false, roundTicks: 30, deadlineMs: 6000, maxTokens: 400, temperature: 0.5, countries: {} };
    G.llm.countries = G.llm.countries || {};
    if (!G.llm.countries[cid]) {
        G.llm.countries[cid] = {
            mode: 'bot',
            endpoint: LLM_PRESETS.deepseek.endpoint,
            model: LLM_PRESETS.deepseek.model,
            temperature: G.llm.temperature != null ? G.llm.temperature : 0.5,
            personality: 'opportunist',
            apiKey: llmGetStoredApiKey(),
            status: { state: 'idle', invalidStreak: 0, botFallbackRounds: 0, totalCalls: 0, totalTimeouts: 0, totalErrors: 0, totalInvalid: 0 }
        };
    }
    return G.llm.countries[cid];
}

// Все страны в режиме LLM (включая fallback и мёртвых — для таймера fallback).
function getAllLlmCountryIds() {
    if (!countryList) return [];
    const out = [];
    for (const c of countryList) {
        if (!c || c.id === G.playerCountryId) continue;
        if (!c.provinces || c.provinces.length === 0) continue;
        const cfg = llmCountryConfig(c.id);
        if (cfg.mode === 'llm') out.push(c.id);
    }
    return out;
}

// Страны, которые участвуют в раунде (не в fallback).
function getLlmCountryIds() {
    return getAllLlmCountryIds().filter(cid => {
        const cfg = llmCountryConfig(cid);
        return (cfg.status.botFallbackRounds || 0) <= 0;
    });
}

function isLlmCollecting(cid) {
    if (!G.llm || !G.llm.enabled) return false;
    if (!G.llmRound || G.llmRound.state !== 'collecting') return false;
    const cfg = llmCountryConfig(cid);
    if (!cfg || cfg.mode !== 'llm') return false;
    if ((cfg.status.botFallbackRounds || 0) > 0) return false;
    return true;
}

function llmChatUrl(endpoint) {
    const e = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!e) return null;
    if (/\/chat\/completions$/.test(e)) return e;
    if (/\/api$/.test(e)) return e + '/v1/chat/completions';
    return e + '/v1/chat/completions';
}

// ---------- Промпты ----------

function buildSystemPrompt(personality) {
    const lines = [
        'Ты — правитель государства в реалтайм гранд-стратегии.',
        'Ты управляешь страной через JSON-команды. Другие страны управляются такими же агентами — они могут лгать и блефовать.',
        'ФОРМАТ: отвечай ТОЛЬКО одним валидным JSON объектом без markdown и без текста вокруг:',
        '{"reasoning":"...","memory_update":{"goals_add":[],"goals_remove":[],"enemy_notes_update":{},"key_events_add":[]},"actions":[...]}',
        'ДОСТУПНЫЕ ДЕЙСТВИЯ (поле type):',
        'ATTACK {from,to,army_pct} — сухопутная атака из своей провинции на соседнюю вражескую (army_pct 10-100). ВАЖНО: атака возможна только если идёт война с владельцем цели (см. WARS). Если войны нет — сначала отправь DECLARE_WAR, иначе атака будет отклонена.',
        'SEA_ATTACK {from_port_province,to,army_pct} — морской десант из своего порта на прибрежную вражескую провинцию (нужны корабли). Тоже требует войны.',
        'REINFORCE {from,to,army_pct} — переброска войск между своими соседними провинциями',
        'DECLARE_WAR {target_country} — объявление войны',
        'PROPOSE_PEACE {target_country} — предложить мир (только если идёт война)',
        'ACCEPT_PEACE {from_country} / REJECT_PEACE {from_country} — ответ на поступившее предложение мира',
        'PROPOSE_TREATY {treaty_type,target_country,terms} — предложить договор. treaty_type: non_aggression (пакт о ненападении — блокирует войну между сторонами), alliance (взаимная оборона: при атаке на союзника вы И он автоматически вступаете в войну с агрессором), guarantee (односторонняя гарантия: вы — гарант; при атаке на защищаемую страну вы автоматически вступаете в войну, но защищаемый в ваши войны НЕ вступает), tribute (дань), ceasefire (перемирие при войне), province_transfer (передача своей нестоличной провинции). terms: {duration} (ходы), для tribute: {gold_per_turn}, для province_transfer: {province_id}. ПРИМЕРЫ: {"type":"PROPOSE_TREATY","treaty_type":"non_aggression","target_country":2,"terms":{"duration":10}} и {"type":"PROPOSE_TREATY","treaty_type":"tribute","target_country":4,"terms":{"duration":12,"gold_per_turn":30}}',
        'COUNTER_TREATY {proposal_id,terms} — контр-предложение по входящей оферте (не более 2 раз)',
        'ACCEPT_TREATY {proposal_id} / REJECT_TREATY {proposal_id} — ответ на входящую оферту (нельзя отвечать на собственное предложение)',
        'TERMINATE_TREATY {treaty_id} — разорвать активный договор (серьёзный удар по репутации)',
        'BUILD_PORT {province} — построить порт в своей прибрежной провинции',
        'BUILD_SHIP {province} — построить корабль в своей провинции с портом',
        'SEND_LETTER {to_country,text} — письмо другому государству (текст до 400 символов)',
        'WAIT — ничего не делать',
        'ОГРАНИЧЕНИЯ за раунд: максимум 3 атаки, 2 переброски, 1 дипломатический акт (война/мир/договор вместе), 2 письма, 1 строительство.',
        'ФОРМАТ ID: провинции указывай как в снапшоте — P49 (или просто 49). Страну можно указывать числом (id) или точным именем из снапшота.',
        'Используй ТОЛЬКО провинции, перечисленные в снапшоте. Не придумывай ID.',
        'ВАЖНО: слово INTERIOR в снапшоте — это СВОДКА внутренних провинций, а не провинция. Не указывай его в действиях.',
        'Не указывай несуществующие или несоседние провинции. Данные о глубоком тыле врага приблизительны (±30%).',
        'Обосновывай решения в reasoning (2-3 предложения).',
        'СТИЛЬ: реалистичный, стратегически обоснованный.'
    ];
    const p = PERSONALITY_PROMPTS[personality] || '';
    return lines.join('\n') + (p ? '\n\n' + p : '');
}

// ---------- Память ----------

function getLlmMemory(country) {
    if (!country.llmMemory) country.llmMemory = { goals: [], enemy_models: {}, key_events: [], strategic_notes: [] };
    return country.llmMemory;
}

function recordLlmEvent(cid, event) {
    if (cid == null || !countryList || !countryList[cid]) return;
    if (!G.llm || !G.llm.enabled) return;
    const cfg = G.llm.countries[cid];
    if (!cfg || cfg.mode !== 'llm') return;
    const mem = getLlmMemory(countryList[cid]);
    mem.key_events.push({ turn: G.turnNumber, event: String(event).slice(0, 160) });
    if (mem.key_events.length > 15) mem.key_events.splice(0, mem.key_events.length - 15);
}

function applyMemoryUpdate(cid, mu) {
    if (!mu || typeof mu !== 'object') return;
    const c = countryList[cid];
    if (!c) return;
    const mem = getLlmMemory(c);
    if (Array.isArray(mu.goals_add)) {
        for (const g of mu.goals_add) {
            if (typeof g === 'string' && g && !mem.goals.includes(g)) mem.goals.push(g.slice(0, 120));
        }
    }
    if (Array.isArray(mu.goals_remove)) {
        mem.goals = mem.goals.filter(g => !mu.goals_remove.includes(g));
    }
    if (mu.enemy_notes_update && typeof mu.enemy_notes_update === 'object') {
        for (const key in mu.enemy_notes_update) {
            const k = parseInt(key);
            if (isNaN(k) || !countryList[k]) continue;
            mem.enemy_models[k] = mem.enemy_models[k] || {};
            mem.enemy_models[k].notes = String(mu.enemy_notes_update[key]).slice(0, 200);
        }
    }
    if (Array.isArray(mu.key_events_add)) {
        for (const e of mu.key_events_add) {
            if (typeof e === 'string' && e) mem.key_events.push({ turn: G.turnNumber, event: e.slice(0, 160) });
        }
    }
    if (Array.isArray(mu.strategic_notes)) {
        for (const s of mu.strategic_notes) {
            if (typeof s === 'string' && s && !mem.strategic_notes.includes(s)) mem.strategic_notes.push(s.slice(0, 160));
        }
    }
    if (mem.key_events.length > 15) mem.key_events.splice(0, mem.key_events.length - 15);
    if (mem.strategic_notes.length > 5) mem.strategic_notes.splice(0, mem.strategic_notes.length - 5);
    if (mem.goals.length > 5) mem.goals.splice(0, mem.goals.length - 5);
}

// ---------- Снапшот ----------

function treasuryTrend(c) {
    const h = c.treasuryHistory || [];
    if (h.length >= 2) {
        const d = Math.round(h[h.length - 1] - h[h.length - 2]);
        if (d !== 0) return (d > 0 ? '+' : '') + d + '/turn';
    }
    return 'stable';
}

function noisyInt(v) {
    return Math.max(0, Math.round((v || 0) * (0.7 + Math.random() * 0.6)));
}

function provShortName(cid) {
    const c = countryList[cid];
    return c ? c.name : '?';
}

function isAdjacentSet(a, b) {
    if (!a || !b) return false;
    return a.neighbors instanceof Set ? a.neighbors.has(b) : a.neighbors.includes(b);
}

function buildSnapshot(cid, tick) {
    const c = countryList[cid];
    if (!c) return '(no country)';
    const cfg = llmCountryConfig(cid);
    const L = [];
    const push = s => L.push(s);

    const myProvs = c.provinces.map(pid => provinceList[pid]).filter(p => p && p.cells > 0);
    const myIds = new Set(myProvs.map(p => p.id));
    const myTotalArmy = myProvs.reduce((s, p) => s + p.army, 0);

    push('WORLD TURN: ' + G.turnNumber + ' | ROUND: ' + (G.llmRound.roundNumber + 1));
    push('YOU: ' + c.name + ' (id:' + cid + ') | PERSONALITY: ' + (cfg.personality || 'opportunist') + ' | MODE: LLM');
    push('TREASURY: ' + Math.round(c.treasury || 0) + ' | TREND: ' + treasuryTrend(c) + ' | CRISIS_TURNS: ' + (c.crisisTurns || 0));
    push('WAR_EXHAUSTION: ' + Math.round(c.warExhaustion || 0));

    const wars = [];
    for (const [k, w] of (G.wars || [])) {
        if (w.a === cid || w.b === cid) {
            const other = w.a === cid ? w.b : w.a;
            const oc = countryList[other];
            wars.push('vs ' + (oc ? oc.name : '?') + '(id:' + other + ') — ' + (G.turnNumber - w.warStartTurn) + ' turns, heat:' + w.heat);
        }
    }
    push('WARS: ' + (wars.length ? wars.join('; ') : 'none'));
    push('REPUTATION: ' + Math.round(c.reputation || 0) + ' (репутация падает при разрыве договоров)');

    const myTreaties = getActiveTreatiesFor(cid);
    if (myTreaties.length) {
        push('');
        push('=== TREATIES ===');
        for (const t of myTreaties) {
            const other = t.a === cid ? t.b : t.a;
            const oc = countryList[other];
            const remaining = Math.max(0, t.turnExpires - G.turnNumber);
            const wePay = t.type === 'tribute' && t.a === cid;
            push('[' + (t.type === 'ceasefire' ? 'CEASEFIRE' : treatyTypeLabel(t.type).toUpperCase()) + ' id:' + t.id +
                '] with ' + (oc ? oc.name : '?') + '(id:' + other + '), осталось ' + remaining + ' ходов' +
                (t.type === 'tribute' ? ', ' + (wePay ? 'мы платим' : 'получаем') + ' ' + t.terms.gold_per_turn + ' золота/ход' : ''));
        }
    }

    const myOffers = getIncomingProposals(cid);
    if (myOffers.length) {
        push('');
        push('=== INCOMING OFFERS ===');
        for (const p of myOffers) {
            const fromCid = p.lastOfferBy;
            const oc = countryList[fromCid];
            const desc = [];
            desc.push('duration ' + p.terms.duration + ' ходов');
            if (p.type === 'tribute') desc.push('gold_per_turn ' + p.terms.gold_per_turn);
            if (p.type === 'province_transfer') desc.push('province P' + p.terms.province_id);
            push('[OFFER ' + treatyTypeLabel(p.type) + ' id:' + p.id + '] от ' + (oc ? oc.name : '?') + '(id:' + fromCid +
                '): ' + desc.join(', ') + (p.counterCount ? ' (контр-предложений: ' + p.counterCount + ')' : ''));
        }
    }

    const peaceProps = getPeaceProposals(cid);
    if (peaceProps.length) {
        push('PEACE_PROPOSALS_RECEIVED: [' + peaceProps.map(f => {
            const fc = countryList[f];
            return 'from ' + (fc ? fc.name : '?') + '(id:' + f + ')';
        }).join('; ') + ']');
    } else {
        push('PEACE_PROPOSALS_RECEIVED: [none]');
    }
    push('PEACE_GRACE: ' + Math.round(c.peaceGracePeriod || 0));

    const st = cfg.status;
    if (st.state === 'timeout') push('NOTE: last round you had no response (timeout). World advanced.');
    else if (st.state === 'error') push('NOTE: last round your LLM call failed: ' + (st.lastError || 'unknown error'));
    else if (st.state === 'executed' && st.lastActions && st.lastActions.length) {
        const bad = st.lastActions.filter(a => !a.ok);
        push('NOTE: last round actions executed.' + (bad.length ? ' Invalid: ' + bad.map(b => b.type + '(' + b.reason + ')').join('; ') : ''));
    } else {
        push('NOTE: last round all your actions executed successfully.');
    }

    // --- Свои провинции ---
    push('');
    push('=== YOUR PROVINCES (' + myProvs.length + ' total) ===');
    let listed = myProvs;
    let interior = null;
    if (myProvs.length > LLM_MAX_LISTED_PROVINCES) {
        const strategic = myProvs.filter(p => {
            if (p.id === c.capital) return true;
            if (p.port && p.port.built) return true;
            if (p.captureProgress && p.captureProgress.length > 0) return true;
            for (const nbId of p.neighbors) {
                const nb = provinceList[nbId];
                if (nb && nb.cells > 0 && !myIds.has(nb.id)) return true;
            }
            return false;
        });
        const interiorProvs = myProvs.filter(p => !strategic.includes(p));
        if (interiorProvs.length > 0) {
            listed = strategic;
            interior = {
                count: interiorProvs.length,
                army: interiorProvs.reduce((s, p) => s + p.army, 0),
                pop: interiorProvs.reduce((s, p) => s + (p.population || 0), 0)
            };
        }
    }
    if (interior) {
        push('(показаны ' + listed.length + ' стратегических провинций; INTERIOR: ' + interior.count + ' prov, army ' + interior.army + ', pop ' + Math.round(interior.pop) + ' — внутренний резерв)');
    }
    for (const p of listed) {
        const nbParts = [];
        for (const nbId of p.neighbors) {
            const nb = provinceList[nbId];
            if (!nb || nb.cells <= 0) continue;
            if (myIds.has(nb.id)) nbParts.push('P' + nb.id + '(YOU)');
            else {
                const ocid = findCountryOfProvince(nb.id);
                nbParts.push('P' + nb.id + '(' + provShortName(ocid) + ':' + Math.round(nb.army) + ')');
            }
        }
        const tags = [];
        if (p.port && p.port.built) tags.push('port:YES(ships:' + p.port.ships + ')');
        else tags.push('port:NO');
        if (p.isCoastal) tags.push('COASTAL');
        if (p.id === c.capital) tags.push('CAPITAL');
        push('[P' + p.id + '] ' + (p.biome || '?') + ' army:' + Math.round(p.army) + ' pop:' + Math.round(p.population || 0) +
            ' infra:' + Math.round(p.infrastructure || 0) + ' ' + tags.join(' ') +
            (nbParts.length ? ' nb: ' + nbParts.join(' ') : ''));
    }

    // --- Враги и границы ---
    const enemyIds = new Set();
    for (const [k, w] of (G.wars || [])) {
        if (w.a === cid) enemyIds.add(w.b);
        if (w.b === cid) enemyIds.add(w.a);
    }
    for (const p of myProvs) {
        for (const nbId of p.neighbors) {
            const nb = provinceList[nbId];
            if (!nb || nb.cells <= 0) continue;
            const ocid = findCountryOfProvince(nb.id);
            if (ocid >= 0 && ocid !== cid) enemyIds.add(ocid);
        }
    }
    if (enemyIds.size > 0) {
        push('');
        push('=== ENEMY BORDERS ===');
        for (const ocid of enemyIds) {
            const oc = countryList[ocid];
            if (!oc || oc.provinces.length === 0) continue;
            const ocProvs = oc.provinces.map(pid => provinceList[pid]).filter(p => p && p.cells > 0);
            const atWar = isAtWar(cid, ocid);
            push(oc.name + '(id:' + ocid + ') provinces:' + ocProvs.length + ' army:~' + noisyInt(getCountryArmy(ocid)) +
                ' treasury:~' + noisyInt(oc.treasury) + ' relation:' + Math.round((c.relations[ocid] || 0)) +
                (atWar ? ' war:YES' : '') + ' exhaustion:' + Math.round(oc.warExhaustion || 0));
            for (const op of ocProvs) {
                let touchesMine = false;
                for (const nbId of op.neighbors) { if (myIds.has(nbId)) { touchesMine = true; break; } }
                if (!touchesMine) continue;
                const myNb = [];
                for (const nbId of op.neighbors) { if (myIds.has(nbId)) myNb.push('P' + nbId + '(YOU)'); }
                const tags = [];
                if (op.isCoastal) tags.push('COASTAL');
                if (op.port && op.port.built) tags.push('port');
                if (op.id === oc.capital) tags.push('CAPITAL');
                push('  [P' + op.id + '] ' + (op.biome || '?') + ' army:' + Math.round(op.army) +
                    (tags.length ? ' ' + tags.join(' ') : '') + (myNb.length ? ' nb: ' + myNb.join(' ') : ''));
            }
        }
    }

    // --- Нейтралы ---
    const neutrals = countryList.filter(oc => oc && oc.id !== cid && oc.provinces.length > 0 && !enemyIds.has(oc.id));
    if (neutrals.length > 0) {
        push('');
        push('=== NEUTRAL NATIONS ===');
        for (const oc of neutrals) {
            const ocProvs = oc.provinces.map(pid => provinceList[pid]).filter(p => p && p.cells > 0);
            let border = false;
            for (const op of ocProvs) {
                for (const nbId of op.neighbors) { if (myIds.has(nbId)) { border = true; break; } }
                if (border) break;
            }
            push(oc.name + '(id:' + oc.id + '): provinces:' + ocProvs.length + ' army:~' + noisyInt(getCountryArmy(oc.id)) +
                ' treasury:~' + noisyInt(oc.treasury) + ' relation:' + Math.round((c.relations[oc.id] || 0)) +
                ' [border: ' + (border ? 'YES' : 'NO') + ']');
        }
    }

    // --- Бои ---
    const myBattles = (G.captures || []).filter(cap => cap.isActive && (cap.attackerCountryId === cid || cap.defenderCountryId === cid));
    if (myBattles.length > 0) {
        push('');
        push('=== ACTIVE BATTLES ===');
        for (const cap of myBattles) {
            const tp = provinceList[cap.targetProvinceId];
            const ap = provinceList[cap.attackerProvinceId];
            const mySide = cap.attackerCountryId === cid ? 'YOU ATK' : 'YOU DEF';
            const progress = cap.totalCells > 0 ? Math.round(cap.cellsCaptured / cap.totalCells * 100) : 0;
            const fronts = new Set();
            for (const c2 of G.captures) {
                if (c2.isActive && c2.targetProvinceId === cap.targetProvinceId) fronts.add(c2.attackerProvinceId);
            }
            push('[' + mySide + '] P' + (ap ? ap.id : '?') + '→P' + (tp ? tp.id : '?') +
                '(' + provShortName(cap.defenderCountryId) + '): your_army:' + Math.round(cap.attackerArmy) +
                ' enemy_army:' + Math.round(tp ? tp.army : 0) + ' progress:' + progress + '% flanks:' + fronts.size +
                (cap.isSea ? ' SEA' : ''));
        }
    }

    // --- Флот ---
    push('');
    push('=== FLEET ===');
    let fleetLines = 0;
    for (const p of myProvs) {
        if (p.port && p.port.built) {
            const idle = (G.ships || []).filter(s => s.portProvinceId === p.id && s.state === 'idle').length;
            push('P' + p.id + '-port: ' + idle + '/' + p.port.ships + ' ships idle');
            fleetLines++;
        }
    }
    for (const anim of (G.fleetAnims || [])) {
        if (anim.countryId === cid && anim.state === 'sailing') {
            push('fleet en route to P' + anim.targetProvinceId + ' (' + anim.state + ')');
            fleetLines++;
        }
    }
    if (!fleetLines) push('(no fleet)');

    // --- Письма ---
    push('');
    push('=== INBOX ===');
    const letters = (G.letterQueue || []).filter(l => l.toCountryId === cid && !l.read);
    if (letters.length === 0) push('(no letters)');
    for (const l of letters) {
        const from = countryList[l.fromCountryId];
        push('[FROM ' + (from ? from.name : '?') + ', round ' + l.sentRound + ']: "' + l.text + '"');
    }
    // Прочитанными письма станут ТОЛЬКО после успешного исполнения ответа
    // (executeDecisions). При тайм-ауте/ошибке письма не теряются —
    // страна увидит их в следующем снапшоте.
    cfg.status.pendingLetterIds = letters.map(l => l.id);
    push('=== OUTBOX (ваши письма другим) ===');
    const sentLetters = (G.letterQueue || []).filter(l => l.fromCountryId === cid).slice(-3);
    if (sentLetters.length === 0) push('(вы ещё не писали писем)');
    for (const l of sentLetters) {
        const to = countryList[l.toCountryId];
        push('-> ' + (to ? to.name : '?') + ': "' + l.text + '"');
    }

    const diploHints = [];
    if (getActiveTreatiesFor(cid).length === 0) {
        diploHints.push('у вас НЕТ активных договоров — можно предложить пакт о ненападении (PROPOSE_TREATY non_aggression) соседу, дань (tribute) или гарантию (guarantee)');
    }
    const peaceProposed = (G.letterQueue || []).some(l => l.fromCountryId === cid && /переговор|мир|договор|союз/i.test(l.text));
    if (!peaceProposed && myTreaties.length === 0 && !isAnyWarFor(cid)) {
        diploHints.push('письма (SEND_LETTER) можно использовать для дипломатии — например, предложить переговоры или союз');
    }
    if (diploHints.length) push('');
    for (const h of diploHints) push('DIPLO_HINT: ' + h);

    // --- Память ---
    push('');
    push('=== MEMORY ===');
    const mem = getLlmMemory(c);
    let memCount = 0;
    for (const g of mem.goals) { push('- Goal: ' + g); memCount++; }
    for (const key in mem.enemy_models) {
        const oc = countryList[parseInt(key)];
        if (!oc) continue;
        const m = mem.enemy_models[key];
        push('- ' + oc.name + ': ' + (m.notes || 'no notes') + (m.trust != null ? ' [trust:' + m.trust + ']' : ''));
        memCount++;
    }
    for (const ev of mem.key_events) { push('- R' + ev.turn + ': ' + ev.event); memCount++; }
    for (const sn of mem.strategic_notes) { push('- Note: ' + sn); memCount++; }
    if (!memCount) push('(empty — формируй память через memory_update)');

    push('');
    push('REMINDER: reply ONLY with valid JSON. Max 3 attacks, 2 reinforces, 1 diplomacy (war/peace/treaty all count together), 2 letters, 1 build per round.');

    return L.join('\n');
}

// ---------- Вызов LLM ----------

function makeTracked(promise) {
    const t = { done: false, value: null, error: null };
    promise.then(v => { t.done = true; t.value = v; }).catch(e => { t.done = true; t.error = e; });
    return t;
}

async function callLLMWithTimeout(cid, snapshot, deadlineMs, url, cfg) {
    const AbortCtrl = typeof AbortController !== 'undefined' ? AbortController : null;
    const ctrl = AbortCtrl ? new AbortCtrl() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), deadlineMs || 6000) : null;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(cfg.apiKey || llmGetStoredApiKey() ? { Authorization: 'Bearer ' + (cfg.apiKey || llmGetStoredApiKey()) } : {})
            },
            body: JSON.stringify({
                model: cfg.model || 'deepseek-chat',
                user: 'game-country-' + cid,
                temperature: cfg.temperature != null ? cfg.temperature : 0.5,
                max_tokens: (G.llm && G.llm.maxTokens) || 400,
                messages: [
                    { role: 'system', content: buildSystemPrompt(cfg.personality) },
                    { role: 'user', content: snapshot }
                ]
            }),
            signal: ctrl ? ctrl.signal : undefined
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data && data.choices && data.choices[0] && data.choices[0].message) {
            const content = data.choices[0].message.content;
            if (typeof content === 'string' && content.trim()) return content;
            return null; // пустой ответ — мягкий сбой, не невалидный JSON
        }
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const LLM_CALL_STAGGER_MS = 400;

function startLlmCall(cid, snapshot, url, cfg, delayMs) {
    if (!delayMs) return callLLMWithTimeout(cid, snapshot, G.llm.deadlineMs, url, cfg);
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            callLLMWithTimeout(cid, snapshot, G.llm.deadlineMs, url, cfg).then(resolve, reject);
        }, delayMs);
    });
}

// ---------- Раундовый gate ----------

function llmStartRound() {
    if (!G.llm || !G.llm.enabled) return;
    const llmCids = getLlmCountryIds();
    if (llmCids.length === 0) {
        G.llmRound.state = 'idle';
        G.llmRound.responses = {};
        return;
    }
    G.llmRound.roundNumber++;
    G.llmRound.state = 'collecting';
    G.llmRound.startedTick = G.tickCount;
    G.llmRound.startedAtMs = Date.now();
    G.llmRound.responses = {};
    llmCids.forEach((cid, idx) => {
        const cfg = llmCountryConfig(cid);
        const st = cfg.status;
        st.state = 'collecting';
        st.lastError = null;
        try {
            const snapshot = buildSnapshot(cid, G.tickCount);
            st.lastSnapshot = snapshot;
            st.snapshotLen = snapshot.length;
            const url = llmChatUrl(cfg.endpoint);
            if (!url) {
                st.state = 'error';
                st.lastError = 'нет endpoint';
                G.llmRound.responses[cid] = { done: true, value: null, error: new Error('no endpoint') };
                return;
            }
            G.llmRound.responses[cid] = makeTracked(startLlmCall(cid, snapshot, url, cfg, idx * LLM_CALL_STAGGER_MS));
        } catch (e) {
            st.state = 'error';
            st.lastError = String((e && e.message) || e).slice(0, 120);
            G.llmRound.responses[cid] = { done: true, value: null, error: e };
        }
    });
    if (typeof refreshLlmPanelStatus === 'function') refreshLlmPanelStatus();
}

function llmExecuteRound() {
    const llmCids = getLlmCountryIds();
    const order = llmCids.slice();
    for (let i = order.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [order[i], order[j]] = [order[j], order[i]];
    }
    for (const cid of order) {
        const cfg = llmCountryConfig(cid);
        const st = cfg.status;
        const r = G.llmRound.responses[cid];
        st.totalCalls = (st.totalCalls || 0) + 1;
        if (r && r.done && !r.error && r.value != null) {
            executeDecisions(cid, r.value);
            if (countryList[cid]) countryList[cid]._llmHandledTurn = G.turnNumber;
            if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): решения исполнены');
        } else if (r && r.done && r.error) {
            const errDesc = String((r.error && (r.error.name || r.error.message)) || r.error);
            if (/abort/i.test(errDesc)) {
                st.state = 'timeout';
                st.totalTimeouts = (st.totalTimeouts || 0) + 1;
                st.lastError = 'timeout (>' + (G.llm.deadlineMs || 6000) + 'ms)';
                if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): тайм-аут, WAIT');
            } else {
                st.state = 'error';
                st.lastError = errDesc.slice(0, 120);
                st.totalErrors = (st.totalErrors || 0) + 1;
                if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): ошибка вызова — ' + st.lastError);
            }
        } else if (r && r.done && !r.error && r.value == null) {
            st.state = 'error';
            st.totalErrors = (st.totalErrors || 0) + 1;
            st.lastError = 'пустой ответ';
            if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): пустой ответ, WAIT');
        } else {
            st.state = 'timeout';
            st.totalTimeouts = (st.totalTimeouts || 0) + 1;
            st.lastError = 'timeout (>' + (G.llm.deadlineMs || 6000) + 'ms)';
            if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): тайм-аут, WAIT');
        }
    }
    G.llmRound.state = 'idle';
    G.llmRound.responses = {};
    if (typeof refreshLlmPanelStatus === 'function') refreshLlmPanelStatus();
}

function llmAllResponsesDone() {
    const st = G.llmRound;
    if (!st || !st.responses) return true;
    for (const cid in st.responses) {
        const r = st.responses[cid];
        if (!r || !r.done) return false;
    }
    return true;
}

function processLlmTurn() {
    if (!G.llm || !G.llm.enabled) return;
    // Fallback-страны тоже должны отсчитывать раунды до возвращения в LLM-режим
    // (getAllLlmCountryIds включает их, в отличие от getLlmCountryIds).
    for (const cid of getAllLlmCountryIds()) {
        const cfg = llmCountryConfig(cid);
        if ((cfg.status.botFallbackRounds || 0) > 0) {
            cfg.status.botFallbackRounds--;
            if (cfg.status.botFallbackRounds === 0) {
                cfg.status.invalidStreak = 0;
                cfg.status.state = 'idle';
                if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): fallback окончен, возврат в LLM-режим');
            }
        }
    }
    const st = G.llmRound;
    if (st.state === 'collecting') {
        const elapsed = G.tickCount - st.startedTick;
        const realElapsed = Date.now() - (st.startedAtMs || 0);
        const allDone = llmAllResponsesDone();
        // Жёсткий дедлайн: даже если не все ответили, исполняем то, что пришло
        // (+1500мс запаса, чтобы abort-нутые запросы успели осесть в response).
        const deadlineReached = realElapsed >= ((G.llm.deadlineMs || 6000) + 1500);
        if ((elapsed >= G.llm.roundTicks && allDone) || deadlineReached) {
            llmExecuteRound();
            llmStartRound();
        }
    } else if (st.state === 'idle' && (st.pendingStart || G.tickCount % G.llm.roundTicks === 0)) {
        st.pendingStart = false;
        llmStartRound();
    }
}

// ---------- Разбор ответа ----------

function parseLLMResponse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let txt = raw.trim();
    const fence = txt.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
    if (fence) txt = fence[1].trim();
    try {
        return JSON.parse(txt);
    } catch (e) {
        const start = txt.indexOf('{');
        const end = txt.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try { return JSON.parse(txt.slice(start, end + 1)); } catch (e2) { return null; }
        }
        return null;
    }
}

// ---------- Исполнение действий ----------

function executeDecisions(cid, response) {
    const cfg = llmCountryConfig(cid);
    const st = cfg.status;
    const parsed = parseLLMResponse(response);
    if (!parsed) {
        st.lastActions = [];
        st.invalidStreak = (st.invalidStreak || 0) + 1;
        st.totalInvalid = (st.totalInvalid || 0) + 1;
        st.lastError = 'невалидный JSON ответ';
        st.state = 'error';
        if (st.invalidStreak >= LLM_INVALID_STREAK_LIMIT) {
            st.botFallbackRounds = LLM_BOT_FALLBACK_ROUNDS;
            st.state = 'fallback';
            if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): 3 невалидных ответа подряд — переключение на бота на ' + LLM_BOT_FALLBACK_ROUNDS + ' раундов');
        }
        return;
    }
    st.invalidStreak = 0;
    // Ответ получен и исполняется — письма из снапшота теперь прочитаны
    if (st.pendingLetterIds && st.pendingLetterIds.length) {
        const pending = new Set(st.pendingLetterIds);
        for (const l of (G.letterQueue || [])) {
            if (pending.has(l.id)) l.read = true;
        }
        st.pendingLetterIds = null;
    }
    st.lastReasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 600) : '';
    applyMemoryUpdate(cid, parsed.memory_update);

    const used = { attacks: 0, reinforces: 0, diplo: 0, letters: 0, builds: 0 };
    const results = [];
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    let okCount = 0;
    for (const a of actions) {
        const reason = validateAndExecuteAction(cid, a, used);
        const ok = !reason;
        if (ok) okCount++;
        results.push({ type: a && a.type ? a.type : '?', ok, reason: reason || null });
        if (reason) st.totalInvalid = (st.totalInvalid || 0) + 1;
        const label = actionLabel(a);
        if (ok) {
            pushLlmActivity(cid, '✓ ' + label);
            if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): ' + label);
        } else {
            pushLlmActivity(cid, '✗ ' + label + ' — ' + reason);
        }
    }
    if (actions.length === 0) {
        pushLlmActivity(cid, 'действий не было (WAIT)');
    }
    pushLlmActivity(cid, 'раунд исполнен: ' + okCount + '✓ из ' + actions.length + ' действий');
    st.lastActions = results;
    st.state = 'executed';
    checkQualityStreak(cid, okCount, actions.length);
}

function pctOf(a, field) {
    const v = parseFloat(a[field]);
    return isFinite(v) ? v : NaN;
}

function parseProvinceRef(ref) {
    if (ref == null) return -1;
    if (typeof ref === 'number') return ref >= 0 ? Math.floor(ref) : -1;
    const m = String(ref).match(/\d+/);
    return m ? parseInt(m[0], 10) : -1;
}

function parseCountryRef(ref) {
    if (ref == null) return -1;
    if (typeof ref === 'number') return ref >= 0 && countryList[ref] ? ref : -1;
    const s = String(ref).trim();
    if (s === '') return -1;
    const numMatch = s.match(/\d+/);
    if (numMatch) {
        const n = parseInt(numMatch[0], 10);
        if (countryList[n]) return n;
    }
    const lower = s.toLowerCase();
    for (const c of countryList) {
        if (c && c.name && c.name.toLowerCase() === lower) return c.id;
    }
    return -1;
}

function checkQualityStreak(cid, okCount, total) {
    const cfg = llmCountryConfig(cid);
    const st = cfg.status;
    if (total < 2 || okCount === total) return;
    const okRatio = okCount / total;
    if (okRatio >= 0.5) return;
    st.invalidStreak = (st.invalidStreak || 0) + 1;
    if (st.invalidStreak >= LLM_INVALID_STREAK_LIMIT) {
        st.botFallbackRounds = LLM_BOT_FALLBACK_ROUNDS;
        st.state = 'fallback';
        if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): много невалидных действий — переключение на бота на ' + LLM_BOT_FALLBACK_ROUNDS + ' раундов');
    }
}

function validateAndExecuteAction(cid, a, used) {
    if (!a || typeof a !== 'object') return 'действие не объект';
    const c = countryList[cid];
    if (!c) return 'страна не существует';
    const type = a.type;

    switch (type) {
        case 'ATTACK': {
            if (used.attacks >= LLM_ACTION_LIMITS.attacks) return 'лимит атак за раунд';
            const from = provinceList[parseProvinceRef(a.from)], to = provinceList[parseProvinceRef(a.to)];
            if (!from || !to) return 'провинция не существует';
            if (!c.provinces.includes(from.id)) return 'from — не ваша провинция';
            const v = pctOf(a, 'army_pct');
            if (!(v >= 10 && v <= 100)) return 'army_pct вне диапазона 10-100';
            if (from.army <= 0) return 'в провинции нет войск';
            if (!isAdjacentSet(from, to.id)) return 'цель не соседняя';
            const tcid = findCountryOfProvince(to.id);
            if (tcid < 0) return 'цель ничья';
            if (tcid === cid) return 'нельзя атаковать свою провинцию';
            if (!isAtWar(cid, tcid)) {
                if (!canDeclareWar(cid, tcid)) return 'нет войны с владельцем цели (и нельзя объявить: мирная пауза или пакт)';
                startWar(cid, tcid);
                recordCombat(cid, tcid);
                if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): атака без объявления — война с ' + countryList[tcid].name + ' начата автоматически');
                if (typeof recordLlmEvent === 'function') recordLlmEvent(cid, 'War started by unannounced attack on ' + countryList[tcid].name);
            }
            const cap = startCapture(from, to, v);
            if (!cap) return 'startCapture вернул null';
            recordCombat(cid, tcid);
            used.attacks++;
            return null;
        }
        case 'SEA_ATTACK': {
            if (used.attacks >= LLM_ACTION_LIMITS.attacks) return 'лимит атак за раунд';
            const from = provinceList[parseProvinceRef(a.from_port_province)], to = provinceList[parseProvinceRef(a.to)];
            if (!from || !to) return 'провинция не существует';
            if (!c.provinces.includes(from.id)) return 'from_port — не ваша провинция';
            const v = pctOf(a, 'army_pct');
            if (!(v >= 10 && v <= 100)) return 'army_pct вне диапазона 10-100';
            if (!from.port || !from.port.built) return 'нет порта в провинции';
            if (!to.isCoastal) return 'цель не прибрежная';
            if (typeof canSeaTravel !== 'function' || !canSeaTravel(from, to)) return 'нет морского пути';
            const tcid = findCountryOfProvince(to.id);
            if (tcid < 0 || tcid === cid) return 'нельзя атаковать эту провинцию';
            if (!isAtWar(cid, tcid)) {
                if (!canDeclareWar(cid, tcid)) return 'нет войны с владельцем цели (и нельзя объявить: мирная пауза или пакт)';
                startWar(cid, tcid);
                recordCombat(cid, tcid);
                if (typeof addGameLog === 'function') addGameLog(countryList[cid].name + ' (LLM): десант без объявления — война с ' + countryList[tcid].name + ' начата автоматически');
                if (typeof recordLlmEvent === 'function') recordLlmEvent(cid, 'War started by unannounced sea attack on ' + countryList[tcid].name);
            }
            const commit = Math.floor(from.army * v / 100);
            const needed = Math.ceil(commit / G.params.shipCapacity);
            const idle = (G.ships || []).filter(s => s.portProvinceId === from.id && s.state === 'idle').length;
            if (idle < needed) return 'недостаточно кораблей (' + idle + '/' + needed + ')';
            const cap = startCapture(from, to, v, { isSea: true });
            if (!cap) return 'startCapture вернул null';
            recordCombat(cid, tcid);
            used.attacks++;
            return null;
        }
        case 'REINFORCE': {
            if (used.reinforces >= LLM_ACTION_LIMITS.reinforces) return 'лимит перебросок за раунд';
            const from = provinceList[parseProvinceRef(a.from)], to = provinceList[parseProvinceRef(a.to)];
            if (!from || !to) return 'провинция не существует';
            if (!c.provinces.includes(from.id) || !c.provinces.includes(to.id)) return 'обе провинции должны быть ваши';
            const v = pctOf(a, 'army_pct');
            if (!(v >= 10 && v <= 100)) return 'army_pct вне диапазона 10-100';
            if (!isAdjacentSet(from, to.id)) return 'провинции не соседние';
            if (!reinforceProvince(from, to, v)) return 'не удалось перебросить';
            used.reinforces++;
            return null;
        }
        case 'DECLARE_WAR': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const t = parseCountryRef(a.target_country);
            if (t < 0 || t === cid) return 'неверная цель';
            if (!canDeclareWar(cid, t)) return 'нельзя объявить войну (мирная пауза или уже идёт война)';
            startWar(cid, t);
            recordCombat(cid, t);
            used.diplo++;
            return null;
        }
        case 'PROPOSE_PEACE': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const t = parseCountryRef(a.target_country);
            if (t < 0) return 'неверная цель';
            if (!isAtWar(cid, t)) return 'нет войны с целью';
            addPeaceProposal(t, cid);
            used.diplo++;
            return null;
        }
        case 'ACCEPT_PEACE': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const t = parseCountryRef(a.from_country);
            if (t < 0) return 'неверная цель';
            if (!getPeaceProposals(cid).includes(t)) return 'нет предложения мира от этой страны';
            if (!isAtWar(cid, t)) return 'нет войны с этой страной';
            const ok = makePeace(cid, t);
            removePeaceProposal(cid, t);
            removePeaceProposal(t, cid);
            used.diplo++;
            return ok ? null : 'не удалось заключить мир';
        }
        case 'REJECT_PEACE': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const t = parseCountryRef(a.from_country);
            if (t < 0) return 'неверная цель';
            if (!getPeaceProposals(cid).includes(t)) return 'нет предложения мира от этой страны';
            removePeaceProposal(cid, t);
            used.diplo++;
            return null;
        }
        case 'PROPOSE_TREATY': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const t = parseCountryRef(a.target_country);
            const type = String(a.type_treaty || a.treaty_type || a.type || '');
            if (isNaN(t) || !countryList[t] || t === cid) return 'неверная цель';
            if (!TREATY_TYPES.includes(type)) return 'неизвестный тип договора: ' + type;
            if (type !== 'ceasefire' && isAtWar(cid, t)) return 'нельзя договор во время войны (кроме перемирия)';
            if (getActiveTreatyBetween(cid, t, type)) return 'такой договор уже активен';
            if (getIncomingProposals(cid).some(p => p.from === t && p.type === type) ||
                getIncomingProposals(t).some(p => p.from === cid && p.type === type)) return 'такая оферта уже есть';
            const prop = createTreatyProposal(cid, t, type, a.terms);
            if (!prop) return 'не удалось создать оферту (проверьте terms)';
            used.diplo++;
            return null;
        }
        case 'COUNTER_TREATY': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const pid = parseInt(a.proposal_id);
            const prop = getProposalById(pid);
            if (!prop || prop.status !== 'pending') return 'оферта не найдена';
            if (cid !== prop.from && cid !== prop.to) return 'не вы участник оферты';
            if (cid === prop.lastOfferBy) return 'нельзя отвечать на собственное предложение';
            if (prop.counterCount >= TREATY_MAX_COUNTERS) return 'превышен лимит контр-предложений';
            const counter = counterTreatyProposal(pid, cid, a.terms);
            if (!counter) return 'контр-предложение отклонено (проверьте terms)';
            used.diplo++;
            return null;
        }
        case 'ACCEPT_TREATY': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const pid = parseInt(a.proposal_id);
            const prop = getProposalById(pid);
            if (!prop || prop.status !== 'pending') return 'оферта не найдена';
            if (cid === prop.lastOfferBy) return 'нельзя принять собственную оферту';
            if (!acceptTreatyProposal(pid, cid)) return 'не удалось принять договор';
            used.diplo++;
            return null;
        }
        case 'REJECT_TREATY': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const pid = parseInt(a.proposal_id);
            const prop = getProposalById(pid);
            if (!prop || prop.status !== 'pending') return 'оферта не найдена';
            if (cid === prop.lastOfferBy) return 'нельзя отклонить собственную оферту';
            rejectTreatyProposal(pid, cid);
            used.diplo++;
            return null;
        }
        case 'TERMINATE_TREATY': {
            if (used.diplo >= LLM_ACTION_LIMITS.diplo) return 'лимит дипломатических действий';
            const tid = parseInt(a.treaty_id);
            const treaty = getTreatyById(tid);
            if (!treaty || treaty.status !== 'active') return 'договор не найден';
            if (treaty.a !== cid && treaty.b !== cid) return 'не вы участник договора';
            terminateTreaty(tid, cid);
            used.diplo++;
            return null;
        }
        case 'BUILD_PORT': {
            if (used.builds >= LLM_ACTION_LIMITS.builds) return 'лимит строительства за раунд';
            const p = provinceList[parseProvinceRef(a.province)];
            if (!p) return 'провинция не существует';
            if (!c.provinces.includes(p.id)) return 'провинция не ваша';
            if (!p.isCoastal) return 'не прибрежная провинция';
            if (p.port && p.port.built) return 'порт уже построен';
            if (c.treasury < G.params.portCost) return 'недостаточно золота';
            const pos = typeof findPortVisualPosition === 'function' ? findPortVisualPosition(p) : null;
            const vx = pos ? pos.vx : -1;
            const vy = pos ? pos.vy : -1;
            const wrId = (vx >= 0 && G.waterRegionOf) ? G.waterRegionOf[idxOf(vx, vy)] : -1;
            if (wrId >= 0 && G.waterIsOcean[wrId] === false) return 'нельзя строить порт во внутреннем водоёме';
            c.treasury -= G.params.portCost;
            p.port = { built: true, ships: 0, buildTimer: 0, vx, vy, waterRegionId: wrId };
            used.builds++;
            return null;
        }
        case 'BUILD_SHIP': {
            if (used.builds >= LLM_ACTION_LIMITS.builds) return 'лимит строительства за раунд';
            const p = provinceList[parseProvinceRef(a.province)];
            if (!p) return 'провинция не существует';
            if (!c.provinces.includes(p.id)) return 'провинция не ваша';
            if (!p.port || !p.port.built) return 'нет порта в провинции';
            if (p.port.vx < 0) return 'некорректная позиция порта';
            if (p.port.ships >= G.params.maxShipsPerPort) return 'порт заполнен';
            if (c.treasury < G.params.shipCost) return 'недостаточно золота';
            c.treasury -= G.params.shipCost;
            p.port.ships++;
            G.ships.push({
                id: shipIdCounter++,
                ownerCid: cid,
                homeProvinceId: p.id,
                portProvinceId: p.id,
                targetProvinceId: null,
                x: p.port.vx * pixelSize + pixelSize / 2,
                y: p.port.vy * pixelSize + pixelSize / 2,
                targetX: -1, targetY: -1,
                path: null,
                pathIndex: 0,
                progress: 0,
                state: 'idle',
                speed: G.params.shipMoveSpeed
            });
            used.builds++;
            return null;
        }
        case 'SEND_LETTER': {
            if (used.letters >= LLM_ACTION_LIMITS.letters) return 'лимит писем за раунд';
            const t = parseCountryRef(a.to_country);
            if (t < 0 || t === cid) return 'неверный получатель';
            const text = String(a.text || '').slice(0, 400);
            if (!text.trim()) return 'пустое письмо';
            if (typeof sendLetter !== 'function') return 'sendLetter недоступен';
            if (!sendLetter(cid, t, text)) return 'не удалось отправить письмо';
            used.letters++;
            return null;
        }
        case 'WAIT':
            return null;
        default:
            if (typeof TREATY_TYPES !== 'undefined' && TREATY_TYPES.includes(type)) {
                return validateAndExecuteAction(cid, { type: 'PROPOSE_TREATY', treaty_type: type, target_country: a.target_country, terms: a.terms }, used);
            }
            return 'неизвестный тип действия: ' + type;
    }
}

// ---------- Инерционный бот (пока LLM думает) ----------

function processInertialTurn(countryId) {
    const country = countryList[countryId];
    if (!country) return;
    const myProvinces = country.provinces.map(pid => provinceList[pid]).filter(p => p && p.cells > 0);
    if (myProvinces.length === 0) return;
    const totalArmy = myProvinces.reduce((s, p) => s + p.army, 0);
    const avgArmy = totalArmy / myProvinces.length;
    for (const prov of myProvinces) {
        const underAttack = (G.captures || []).some(c => c.targetProvinceId === prov.id && c.isActive);
        if (!underAttack || prov.army >= avgArmy * 0.6) continue;
        for (const nbId of prov.neighbors) {
            const nb = provinceList[nbId];
            if (!nb || !nb.cells || !country.provinces.includes(nb.id)) continue;
            if (nb.army > avgArmy * 0.3) {
                const transferPct = Math.min(60, Math.floor((nb.army - avgArmy * 0.3) / nb.army * 100));
                if (transferPct > 10) reinforceProvince(nb, prov, transferPct);
                break;
            }
        }
    }
}

// ---------- Force call (дебаг) ----------

async function forceLlmCall(cid) {
    // Не даём дублировать действия: если страна уже участвует в активном
    // раунде (ответ не получен/не исполнен), force пропускается.
    if (G.llmRound && G.llmRound.state === 'collecting' && G.llmRound.responses && G.llmRound.responses[cid]) {
        const st0 = llmCountryConfig(cid).status;
        st0.state = 'collecting';
        if (typeof addGameLog === 'function' && countryList[cid]) {
            addGameLog(countryList[cid].name + ': force пропущен — страна уже в активном раунде');
        }
        if (typeof refreshLlmPanelStatus === 'function') refreshLlmPanelStatus();
        return;
    }
    const cfg = llmCountryConfig(cid);
    const st = cfg.status;
    const snapshot = buildSnapshot(cid, G.tickCount);
    st.lastSnapshot = snapshot;
    st.snapshotLen = snapshot.length;
    const url = llmChatUrl(cfg.endpoint);
    if (!url) {
        st.state = 'error';
        st.lastError = 'нет endpoint';
        if (typeof refreshLlmPanelStatus === 'function') refreshLlmPanelStatus();
        return;
    }
    st.state = 'collecting';
    st.totalCalls = (st.totalCalls || 0) + 1;
    try {
        const content = await callLLMWithTimeout(cid, snapshot, (G.llm && G.llm.deadlineMs) || 6000, url, cfg);
        if (content != null) {
            executeDecisions(cid, content);
            if (countryList[cid]) countryList[cid]._llmHandledTurn = G.turnNumber;
        } else {
            st.state = 'error';
            st.totalErrors = (st.totalErrors || 0) + 1;
            st.lastError = 'пустой ответ';
        }
    } catch (e) {
        st.state = 'error';
        st.totalErrors = (st.totalErrors || 0) + 1;
        st.lastError = String((e && e.message) || e).slice(0, 120);
    }
    if (typeof refreshLlmPanelStatus === 'function') refreshLlmPanelStatus();
}
