// ============================================================
// llm-eval.js — измерение качества LLM-противников.
//
// Зачем: «стали ли агенты умнее» нельзя определить на глаз. Здесь те же
// headless-партии, что в smoke-test, но с телеметрией по каждому действию:
// валидность, приверженность готовым ходам (CANDIDATE MOVES), доля атак с
// прогнозом LOSE, расход токенов, латентность, исход партии.
//
// Запуск:
//   node llm-eval.js --mock                      # без сети, скриптовая «модель»
//   node llm-eval.js --endpoint http://127.0.0.1:9655 --model deepseek-chat
//   node llm-eval.js --games 5 --turns 120 --llm 1,2,3 --personality aggressive
//
// Ключевые метрики (чем меньше, тем лучше):
//   invalid%  — доля невалидных действий
//   lose%     — доля исполненных атак, которые игра заранее считала проигрышными
//   offbook%  — доля действий «не из списка» (модель выдумала свой ход)
// ============================================================
'use strict';

const fs = require('fs');
const { createHarness } = require('./test-harness');

// ---------- Аргументы ----------

function parseArgs(argv) {
    const o = {
        mock: false, endpoint: 'http://127.0.0.1:9655', model: 'deepseek-chat', key: '',
        games: 3, turns: 80, llm: '1,2,3', personality: '', deadline: 20000, maxTokens: 400,
        roundTicks: 0, tickMs: 200, width: 240, height: 170, provinces: 50, countries: 5,
        json: '', verbose: false, garbage: 0.15
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        switch (a) {
            case '--mock': o.mock = true; break;
            case '--endpoint': o.endpoint = next(); break;
            case '--model': o.model = next(); break;
            case '--key': o.key = next(); break;
            case '--games': o.games = parseInt(next(), 10); break;
            case '--turns': o.turns = parseInt(next(), 10); break;
            case '--llm': o.llm = next(); break;
            case '--personality': o.personality = next(); break;
            case '--deadline': o.deadline = parseInt(next(), 10); break;
            case '--max-tokens': o.maxTokens = parseInt(next(), 10); break;
            case '--round-ticks': o.roundTicks = parseInt(next(), 10); break;
            case '--tick-ms': o.tickMs = parseInt(next(), 10); break;
            case '--width': o.width = parseInt(next(), 10); break;
            case '--height': o.height = parseInt(next(), 10); break;
            case '--provinces': o.provinces = parseInt(next(), 10); break;
            case '--countries': o.countries = parseInt(next(), 10); break;
            case '--json': o.json = next(); break;
            case '--garbage': o.garbage = parseFloat(next()); break;
            case '--verbose': o.verbose = true; break;
            default: console.error('Неизвестный аргумент: ' + a); process.exit(2);
        }
    }
    if (!isFinite(o.games) || o.games < 1) o.games = 1;
    if (!isFinite(o.turns) || o.turns < 5) o.turns = 5;
    if (!(o.garbage >= 0)) o.garbage = 0;
    return o;
}

// ---------- Скриптовая «модель» для --mock ----------
//
// Читает секцию CANDIDATE MOVES из снапшота и берёт лучший ход — так мы
// проверяем весь тракт (снапшот → resolveMoveRef → исполнение) без сети.
// Доля `garbage` ответов намеренно невалидна: exercising ремонт JSON.

function mockReply(snapshot, garbageRate) {
    if (Math.random() < garbageRate) {
        const dirty = [
            'Думаю, стоит подождать.',
            '{"reasoning":"оборвано на токенах","actions":[{"type":"WAIT"',
            "{'reasoning':'одинарные кавычки','actions':[],}",
            '```json\n{"reasoning":"x","actions":[{"type":"WAIT"},]}\n```'
        ];
        return dirty[Math.floor(Math.random() * dirty.length)];
    }
    const ids = [];
    const lines = String(snapshot).split('\n');
    let inMoves = false;
    for (const ln of lines) {
        if (ln.indexOf('=== CANDIDATE MOVES') >= 0) { inMoves = true; continue; }
        if (!inMoves) continue;
        if (/^===/.test(ln)) break;
        const m = ln.match(/^([ASRDB]\d+)\s\|\s(.*)\|\sscore\s(-?\d+)/);
        if (m) ids.push({ id: m[1], line: m[2], score: parseInt(m[3], 10) });
    }
    const attacks = ids.filter(x => x.id[0] === 'A' && !/LOSE/.test(x.line));
    const diplo = ids.filter(x => x.id[0] === 'D');
    const rein = ids.filter(x => x.id[0] === 'R');
    const build = ids.filter(x => x.id[0] === 'B');
    const actions = [];
    if (attacks.length) {
        for (const a of attacks.slice(0, 2)) actions.push({ type: 'ATTACK', move: a.id });
        // Намеренно «тупой» ход в 10% случаев — чтобы метрика lose% не была тождественно нулевой.
        const losing = ids.find(x => x.id[0] === 'A' && /LOSE/.test(x.line));
        if (losing && Math.random() < 0.1) actions.push({ type: 'ATTACK', move: losing.id });
    }
    if (rein.length) actions.push({ type: 'REINFORCE', move: rein[0].id });
    if (diplo.length && Math.random() < 0.5) actions.push({ type: 'DIPLO', move: diplo[0].id });
    if (build.length && Math.random() < 0.3) actions.push({ type: 'BUILD', move: build[0].id });
    if (!actions.length) actions.push({ type: 'WAIT' });
    return JSON.stringify({ reasoning: 'mock: беру лучшие готовые ходы', actions });
}

// ---------- Телеметрия ----------

function blankStats() {
    return {
        rounds: 0, calls: 0, timeouts: 0, errors: 0, responses: 0, jsonFailed: 0, repaired: 0,
        actions: 0, ok: 0, offbook: 0, attacks: 0, attacksLose: 0, attacksWin: 0,
        letters: 0, treaties: 0, wars: 0,
        rejectReasons: {},
        promptChars: 0, completionChars: 0, latencies: [],
        finalProvinces: 0, finalArmy: 0, survived: false
    };
}

function pct(a, b) { return b > 0 ? (100 * a / b).toFixed(1) + '%' : '—'; }
function p(arr, q) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// ---------- Партия ----------

async function runGame(opts, gameIdx) {
    const harness = createHarness({
        sliders: {
            mapWidth: String(opts.width), mapHeight: String(opts.height),
            provCount: String(opts.provinces), countryCount: String(opts.countries)
        }
    });
    // Значения, объявленные через let/const, из vm-контекста достаются только
    // через __export (см. test-harness.js) — отсюда t.*; функции-объявления
    // доступны и как свойства sandbox.
    const { sandbox, t, run } = harness;
    const G = t.G;
    const countryList = t.countryList;
    const provinceList = t.provinceList;

    const llmIds = opts.llm.split(',').map(s => parseInt(s, 10)).filter(n => isFinite(n) && countryList[n]);
    if (llmIds.length === 0) throw new Error('ни одна страна из --llm не существует на этой карте');

    G.isPlayerSelectPhase = false;
    G.isPaused = false;
    G.playerCountryId = 0;
    G.llm.enabled = true;
    G.llm.deadlineMs = opts.deadline;
    G.llm.maxTokens = opts.maxTokens;
    G.llm.roundTicks = opts.roundTicks > 0 ? opts.roundTicks : (G.params.botIntervalTicks || 10);
    G.llmRound.pendingStart = true;

    const stats = {};
    for (const cid of llmIds) {
        const cfg = t.llmCountryConfig(cid);
        cfg.mode = 'llm';
        cfg.endpoint = opts.endpoint;
        cfg.model = opts.model;
        cfg.apiKey = opts.key;
        if (opts.personality) cfg.personality = opts.personality;
        cfg.status.totalCalls = 0; cfg.status.totalTimeouts = 0; cfg.status.totalErrors = 0;
        cfg.status.totalInvalid = 0; cfg.status.totalRepaired = 0;
        stats[cid] = blankStats();
    }

    // --- Обёртка над исполнением действий: единственное место, где видно
    // --- КАЖДОЕ действие агента вместе с прогнозом боя ДО его исполнения.
    sandbox.__evalStats = stats;
    sandbox.__evalIds = llmIds;
    run(`
        if (!globalThis.__evalWrapped) {
            globalThis.__evalWrapped = true;
            const __origVAE = validateAndExecuteAction;
            globalThis.validateAndExecuteAction = function (cid, a, used) {
                let forecastWin = null, byMove = false, isWait = false;
                try {
                    const st = globalThis.__evalStats && globalThis.__evalStats[cid];
                    if (st && a && typeof a === 'object') {
                        byMove = a.move != null || a.move_id != null;
                        isWait = !byMove && a.type === 'WAIT';
                        let resolved = null, note = null;
                        if (byMove) {
                            const cfg = llmCountryConfig(cid);
                            const mv = cfg && cfg.status && cfg.status.legalMoves
                                ? cfg.status.legalMoves.byId[String(a.move != null ? a.move : a.move_id).toUpperCase()]
                                : null;
                            if (mv) { resolved = mv.action; note = mv.note; }
                        } else {
                            resolved = a;
                        }
                        if (resolved && (resolved.type === 'ATTACK' || resolved.type === 'SEA_ATTACK')) {
                            if (note) {
                                // Ход из списка: берём вердикт, который игра
                                // показала модели в снапшоте.
                                forecastWin = note !== 'lose';
                            } else {
                                // Ход «от себя»: считаем прогноз сами.
                                const from = provinceList[resolved.type === 'SEA_ATTACK' ? resolved.from_port_province : resolved.from];
                                const to = provinceList[resolved.to];
                                const pctv = parseFloat(resolved.army_pct);
                                if (from && to && isFinite(pctv)) {
                                    forecastWin = combatForecast(Math.floor(from.army * pctv / 100), to.army, 0).win;
                                }
                            }
                        }
                    }
                } catch (e) { /* телеметрия не должна ломать игру */ }
                const reason = __origVAE(cid, a, used);
                try {
                    const st = globalThis.__evalStats && globalThis.__evalStats[cid];
                    if (st) {
                        st.actions++;
                        if (!reason) st.ok++;
                        else st.rejectReasons[reason] = (st.rejectReasons[reason] || 0) + 1;
                        // WAIT — законное «ничего не делать», а не выдуманный ход.
                        if (!byMove && !isWait) st.offbook++;
                        if (!reason && forecastWin !== null) {
                            st.attacks++;
                            if (forecastWin) st.attacksWin++; else st.attacksLose++;
                        }
                        if (!reason && a && a.type === 'SEND_LETTER') st.letters++;
                        if (!reason && a && /TREATY|PEACE/.test(a.type || '')) st.treaties++;
                        if (!reason && a && a.type === 'DECLARE_WAR') st.wars++;
                    }
                } catch (e) { /* то же */ }
                return reason;
            };
        }
    `);

    // --- Обёртка над executeDecisions: считаем ответы, которые не удалось
    // --- разобрать даже после ремонтного запроса (это другой сбой, чем
    // --- отклонённое действие, и смешивать их нельзя).
    run(`
        if (!globalThis.__evalWrappedED) {
            globalThis.__evalWrappedED = true;
            const __origED = executeDecisions;
            globalThis.executeDecisions = function (cid, raw) {
                try {
                    const st = globalThis.__evalStats && globalThis.__evalStats[cid];
                    if (st) { st.responses++; if (!parseLlmJson(raw)) st.jsonFailed++; }
                } catch (e) { /* то же */ }
                return __origED(cid, raw);
            };
        }
    `);

    // --- fetch: реальный или скриптовый, со счётчиком токенов и латентности.
    const realFetch = global.fetch ? global.fetch.bind(global) : null;
    sandbox.fetch = async (url, init) => {
        const t0 = Date.now();
        let cid = -1;
        try { cid = parseInt(String((JSON.parse(init.body).user || '').replace('game-country-', '')), 10); } catch (e) {}
        let promptChars = 0;
        try {
            for (const m of JSON.parse(init.body).messages || []) promptChars += String(m.content || '').length;
        } catch (e) {}
        const st = stats[cid];
        if (st) { st.calls++; st.promptChars += promptChars; }

        let res;
        if (opts.mock) {
            const snapshot = (() => {
                const last = (JSON.parse(init.body).messages || []).slice(-1)[0];
                return last ? String(last.content || '') : '';
            })();
            const content = mockReply(snapshot, opts.garbage);
            res = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
        } else {
            if (!realFetch) throw new Error('в этой среде нет fetch — используйте --mock');
            res = await realFetch(url, init);
        }
        const dt = Date.now() - t0;
        if (st) {
            st.latencies.push(dt);
            if (!res.ok && st) st.errors++;
        }
        // Считаем символы ответа, не потребляя тело дважды.
        const origJson = res.json.bind(res);
        res.json = async () => {
            const data = await origJson();
            try {
                const c = data && data.choices && data.choices[0] && data.choices[0].message
                    ? String(data.choices[0].message.content || '') : '';
                if (st) st.completionChars += c.length;
            } catch (e) {}
            return data;
        };
        return res;
    };

    // --- Игровой цикл (headless-аналог gameLoop из main.js).
    const turnMs = opts.tickMs;
    while (G.turnNumber < opts.turns) {
        const ticksPerTurn = G.params.botIntervalTicks || 10;
        for (let k = 0; k < ticksPerTurn; k++) {
            G.tickCount++;
            for (let i = G.captures.length - 1; i >= 0; i--) {
                const cap = G.captures[i];
                if (!cap.isActive) { G.captures.splice(i, 1); continue; }
                t.processCaptureTick(cap, turnMs);
            }
            const resolved = new Set();
            for (const cap of G.captures) {
                const tp = provinceList[cap.targetProvinceId];
                if (tp && tp.cells > 0 && tp.army <= 0) resolved.add(cap.targetProvinceId);
            }
            for (const pid of resolved) t.resolveProvinceCombat(pid);
            if (typeof t.updateShips === 'function') t.updateShips(turnMs);
        }
        G.turnNumber++;
        t.processEconomyTurn();
        t.processDiplomacyTurn();
        const roundsBefore = G.llmRound.roundNumber;
        t.processLlmTurn();
        // Ждём ответы раунда (иначе следующий ход исполнит неполный раунд).
        if (G.llmRound.state === 'collecting') {
            const t0 = Date.now();
            while (!t.llmAllResponsesDone() && Date.now() - t0 < opts.deadline + 2000) {
                await new Promise(r => setTimeout(r, 5));
            }
            for (const cid of llmIds) stats[cid].rounds = G.llmRound.roundNumber;
        }
        for (const c of countryList) {
            if (!c || c.provinces.length === 0) continue;
            t.processBotTurn(c.id);
        }
        for (const pr of provinceList) {
            if (pr.cells > 0 && t.findCountryOfProvince(pr.id) >= 0) pr.army += Math.ceil(pr.cells / 250);
        }
        if (roundsBefore === G.llmRound.roundNumber && opts.verbose) {
            console.log('  [партия ' + gameIdx + '] ход ' + G.turnNumber + ': раунд LLM не завершился');
        }
    }

    // --- Итоги.
    for (const cid of llmIds) {
        const c = countryList[cid];
        const cfg = t.llmCountryConfig(cid);
        const st = stats[cid];
        st.timeouts = cfg.status.totalTimeouts || 0;
        st.invalidJson = cfg.status.totalInvalid || 0;
        st.repaired = cfg.status.totalRepaired || 0;
        st.finalProvinces = c ? c.provinces.length : 0;
        st.finalArmy = c ? c.provinces.reduce((s, pid) => s + (provinceList[pid] ? provinceList[pid].army : 0), 0) : 0;
        st.survived = st.finalProvinces > 0;
        st.name = c ? c.name : '?';
        st.personality = cfg.personality;
    }
    return { turn: G.turnNumber, stats, countries: countryList.map(c => c ? { id: c.id, name: c.name, provs: c.provinces.length } : null) };
}

// ---------- Отчёт ----------

function report(all, opts) {
    console.log('');
    console.log('Параметры: ' + (opts.mock ? 'MOCK-модель' : opts.endpoint + ' / ' + opts.model) +
        ', партий ' + opts.games + ', ходов ' + opts.turns + ', карта ' + opts.width + 'x' + opts.height +
        '/' + opts.provinces + 'пров/' + opts.countries + 'стран, LLM: ' + opts.llm);
    console.log('');
    const head = ['страна', 'ход', 'выж', 'пров', 'армия', 'действ', 'ok%', 'reject%', 'json%', 'offbook%', 'атак', 'lose%', 'timeout', 'fix', 'токен/раунд', 'p50мс', 'p95мс'];
    console.log(head.join('\t'));
    const rows = [];
    for (const game of all) {
        for (const cid of Object.keys(game.stats)) {
            const st = game.stats[cid];
            const tokensPerRound = st.rounds > 0 ? Math.round((st.promptChars + st.completionChars) / 3.5 / st.rounds) : 0;
            rows.push([
                st.name + '(#' + cid + ')', game.turn, st.survived ? 'да' : 'НЕТ',
                st.finalProvinces, Math.round(st.finalArmy), st.actions,
                pct(st.ok, st.actions), pct(st.actions - st.ok, st.actions), pct(st.jsonFailed, st.responses),
                pct(st.offbook, st.actions),
                st.attacks, pct(st.attacksLose, st.attacks), st.timeouts, st.repaired,
                tokensPerRound, p(st.latencies, 0.5), p(st.latencies, 0.95)
            ].join('\t'));
        }
    }
    console.log(rows.join('\n'));

    // Сводка по всем партиям.
    const agg = blankStats();
    let games = 0;
    for (const game of all) {
        games++;
        for (const cid of Object.keys(game.stats)) {
            const st = game.stats[cid];
            for (const k of Object.keys(agg)) {
                if (typeof agg[k] === 'number' && typeof st[k] === 'number') agg[k] += st[k];
                else if (Array.isArray(agg[k]) && Array.isArray(st[k])) agg[k] = agg[k].concat(st[k]);
            }
            for (const r of Object.keys(st.rejectReasons)) {
                agg.rejectReasons[r] = (agg.rejectReasons[r] || 0) + st.rejectReasons[r];
            }
        }
    }
    console.log('');
    console.log('=== СВОДКА по ' + games + ' партиям ===');
    console.log('действий: ' + agg.actions + ', принято: ' + agg.ok + ' (' + pct(agg.ok, agg.actions) + ')');
    console.log('отклонённых действий: ' + (agg.actions - agg.ok) + ' (' + pct(agg.actions - agg.ok, agg.actions) + ')');
    console.log('ответов без валидного JSON (даже после ремонта): ' + agg.jsonFailed + ' из ' + agg.responses + ' (' + pct(agg.jsonFailed, agg.responses) + ')');
    console.log('вне списка готовых ходов (offbook): ' + agg.offbook + ' (' + pct(agg.offbook, agg.actions) + ')');
    console.log('атак исполнено: ' + agg.attacks + ', из них игра заранее считала проигрышными: ' + agg.attacksLose + ' (' + pct(agg.attacksLose, agg.attacks) + ')');
    console.log('JSON починено повторным запросом: ' + agg.repaired + ', тайм-аутов: ' + agg.timeouts);
    console.log('токенов на раунд (оценка): ' + (agg.rounds > 0 ? Math.round((agg.promptChars + agg.completionChars) / 3.5 / agg.rounds) : 0));
    const top = Object.entries(agg.rejectReasons).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) {
        console.log('частые причины отказа:');
        for (const [r, n] of top) console.log('  ' + n + 'x ' + r);
    }
    if (opts.json) {
        fs.writeFileSync(opts.json, JSON.stringify({ opts, games: all }, null, 2));
        console.log('JSON сохранён: ' + opts.json);
    }
}

// ---------- main ----------

(async function main() {
    const opts = parseArgs(process.argv);
    console.log('llm-eval: ' + opts.games + ' парт(ии) x ' + opts.turns + ' ходов, ' +
        (opts.mock ? 'mock-модель (garbage=' + opts.garbage + ')' : opts.endpoint + ' [' + opts.model + ']'));
    const all = [];
    for (let g = 1; g <= opts.games; g++) {
        const t0 = Date.now();
        try {
            const res = await runGame(opts, g);
            all.push(res);
            console.log('  партия ' + g + '/' + opts.games + ': ход ' + res.turn +
                ', выжили ' + Object.values(res.stats).filter(s => s.survived).map(s => s.name).join(', ') +
                ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 'с)');
        } catch (e) {
            console.error('  партия ' + g + ' упала: ' + (e && e.stack || e));
        }
    }
    if (!all.length) { console.error('ни одной партии не сыграно'); process.exit(1); }
    report(all, opts);
})().catch(e => { console.error(e); process.exit(1); });
