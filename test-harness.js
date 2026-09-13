// ============================================================
// test-harness.js — общий headless-стенд для smoke-test.js и llm-eval.js.
//
// Поднимает игровой код внутри vm-контекста с заглушками DOM/canvas, так что
// реальные скрипты игры выполняются как есть (без браузера и без сборки).
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = ['lang.js', 'map-generator.js', 'game-state.js', 'economy.js', 'combat.js', 'diplomacy.js', 'bots.js', 'llm-brain.js', 'llm-agent.js', 'renderer.js', 'ui-controls.js', 'main.js'];

const DEFAULT_SLIDERS = { mapWidth: '120', mapHeight: '90', provCount: '30', countryCount: '4', terrainFit: '60' };

// options: { sliders: {...}, baseDir: '...' }
function createHarness(options) {
    const baseDir = (options && options.baseDir) || __dirname;

    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    const FILES = ['lang.js', 'map-generator.js', 'game-state.js', 'economy.js', 'combat.js', 'diplomacy.js', 'bots.js', 'llm-brain.js', 'llm-agent.js', 'renderer.js', 'ui-controls.js', 'main.js'];

    // ---------- Заглушки DOM ----------

    function makeCtxProxy() {
        const ctx = {
            measureText: () => ({ width: 0 }),
            createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
        };
        return new Proxy(ctx, {
            get(t, p) {
                if (p in t) return t[p];
                if (typeof p === 'string') return function () { return undefined; };
                return undefined;
            },
            set(t, p, v) { t[p] = v; return true; }
        });
    }

    function makeElement(id) {
        const el = {
            id: id || '',
            value: '',
            textContent: '',
            innerHTML: '',
            style: {},
            dataset: {},
            className: '',
            disabled: false,
            checked: false,
            max: 0,
            min: 0,
            getContext: () => makeCtxProxy(),
            addEventListener() {},
            removeEventListener() {},
            appendChild() {},
            remove() {},
            setAttribute() {},
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
            querySelectorAll: () => [],
            querySelector: () => null,
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
        };
        return el;
    }

    const elements = {};
    const containerStub = {
        innerHTML: '',
        style: {},
        appendChild() {},
        removeChild() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        querySelectorAll: () => []
    };

    const documentStub = {
        getElementById(id) {
            if (!elements[id]) elements[id] = makeElement(id);
            return elements[id];
        },
        querySelector() { return containerStub; },
        querySelectorAll() { return []; },
        createElement() { return makeElement(); },
        documentElement: { clientWidth: 1400, clientHeight: 900 }
    };

    const canvasStub = {
        width: 100,
        height: 100,
        style: {},
        addEventListener() {},
        removeEventListener() {},
        getContext: () => makeCtxProxy(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
    };

        const sliderDefaults = Object.assign({}, DEFAULT_SLIDERS, (options && options.sliders) || {});
        for (const k in sliderDefaults) { elements[k] = makeElement(k); elements[k].value = sliderDefaults[k]; }
    const otherIds = ['mapWidthVal', 'mapHeightVal', 'provCountVal', 'countryCountVal', 'terrainFitVal', 'attackRateVal', 'defenseRateVal', 'tickIntervalVal', 'botIntervalVal', 'flankPenaltyVal', 'growthRateVal', 'taxRateVal', 'armyUpkeepRateVal', 'infraUpkeepRateVal', 'coord', 'elev', 'seedInput', 'gameLog', 'mapStatus', 'llmCountries', 'llmStatus', 'llmPlayerLetters', 'llmEnabled', 'llmRoundTicks', 'llmDeadline', 'llmMaxTokens', 'countryPanelBody', 'countryPanelToggle', 'pauseBtn', 'importInput', 'exportBtn', 'regenerateBtn', 'llmBtn', 'llmForceAllBtn', 'langBtn', 'llmPanel', 'llmTreaties', 'map', 'provincePanel'];
    for (const k of otherIds) { if (!elements[k]) elements[k] = makeElement(k); }
    elements.showProvinces = makeElement('showProvinces'); elements.showProvinces.checked = true;
    elements.showCountries = makeElement('showCountries'); elements.showCountries.checked = true;

    const sandbox = {
        console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        Math, Date, JSON, Promise, Int32Array, Int16Array, Float32Array, Float64Array, Uint8Array, Uint8ClampedArray,
        Array, Object, String, Number, Boolean, Set, Map, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN,
        Error, TypeError, RangeError, RegExp, ArrayBuffer, Intl, Symbol, Proxy, Reflect,
        document: documentStub,
        window: {
            addEventListener() {}, removeEventListener() {},
            innerWidth: 1400, innerHeight: 900,
            requestAnimationFrame: () => 0,
            prompt: () => null
        },
        requestAnimationFrame: () => 0,
        performance: { now: () => Date.now() },
        AbortController, AbortSignal,
        fetch: null
    };
    sandbox.globalThis = sandbox;
    sandbox.window.window = sandbox.window;

    vm.createContext(sandbox);

    for (const f of FILES) {
        const code = fs.readFileSync(path.join(baseDir, f), 'utf8');
        vm.runInContext(code, sandbox, { filename: f });
    }

    // Экспорт top-level let/const из контекста (выполняется ВНУТРИ контекста)
    vm.runInContext(`
        globalThis.__export = function () {
            globalThis.__test = {
                countryList, provinceList, G, heightMap, provinceOf, findCountryOfProvince,
                buildSnapshot, processLlmTurn, processBotTurn, isLlmCollecting, isAtWar,
                llmCountryConfig, forceLlmCall, rebuildCountryMap, startWar, canDeclareWar, makePeace,
                processDiplomacyTurn, botDiplomacy, createTreatyProposal, counterTreatyProposal,
                acceptTreatyProposal, rejectTreatyProposal, terminateTreaty,
                getActiveTreatyBetween, getIncomingProposals, treatyTypeLabel,
                parseProvinceRef, parseCountryRef, validateAndExecuteAction, updateShips, findWaterPath,
                startWar, startCapture, resolveProvinceCombat, getWar,
                executeProvinceTransfer, sendLetter, botReadLetters, botRespondToPeace, botSendLetters,
                getDefensiveAllies, getGuarantors, botTreatyValue,
                addPeaceProposal, removePeaceProposal, getPeaceProposals,
                botShouldAttack, countWarsFor, playerPeaceChance,
                saveFullGameState, loadFullGameState, AUTOSAVE_VERSION, AUTOSAVE_KEY,
                shouldBotWantPeace, llmAllResponsesDone,
                combatForecast, recommendedAttackPct, buildLegalMoves, renderLegalMoves,
                resolveMoveRef, assessThreats, llmObserveWorld, llmCountryPower,
                repairJsonText, parseLlmJson, parseLLMResponse, buildSystemPrompt,
                processCaptureTick, processEconomyTurn, getCountryArmy
            };
        }
    `, sandbox);
    vm.runInContext('__export()', sandbox);

    // Выполнить код внутри игрового контекста (нужно для тестовых обёрток).
    const run = (code) => vm.runInContext(code, sandbox);

    return { sandbox, t: sandbox.__test, elements, run };
}

module.exports = { createHarness, FILES, DEFAULT_SLIDERS };
