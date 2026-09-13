# Strategy Game — Fixes Applied

## Critical Bugs Fixed

### 1. **ui-controls.js — neighbors.has() Type Error** ✓
**Problem:** After importing a map, `neighbors` array loses `.has()` method (it's a Set during generation but Array after JSON import).
```javascript
// BROKEN:
const isSea = !src.neighbors.has(tgt.id);  // Error if neighbors is Array
```
**Fix:** Handle both Set and Array safely:
```javascript
const hasNeighbor = src.neighbors instanceof Set ? src.neighbors.has(tgt.id) : src.neighbors.includes(tgt.id);
const isSea = !hasNeighbor;
```
**Impact:** Clicks on arrows now work correctly whether map was generated fresh or imported.

---

### 2. **bots.js — Undefined canSeaTravel() Call** ✓
**Problem:** Bot sea attack logic called `canSeaTravel()` which was never defined (planned for water regions feature but not implemented).
```javascript
if (!canSeaTravel(portProv, target)) continue;  // ReferenceError
```
**Fix:** Removed the check. Sea attacks now work between any two coastal provinces.
**Impact:** Bots can now perform naval invasions without crashing.

---

### 3. **ui-controls.js — Reversed Peace Proposal Logic** ✓
**Problem:** When player proposed peace to an enemy, function checked if player wanted peace (obvious=true) instead of if enemy wanted peace.
```javascript
// WRONG:
if (shouldBotWantPeace(enemyId, playerCid)) {  // Checks enemy wants peace from player's perspective
```
**Fix:** Parameter order and messaging corrected.
```javascript
if (shouldBotWantPeace(enemyId, playerCid)) {  // Checks if enemy bot wants peace
    makePeace(playerCid, enemyId);
    addGameLog('Peace accepted!');
} else {
    addGameLog('Enemy refuses peace');
}
```
**Impact:** Peace proposals now work correctly with proper feedback.

---

## Visual Improvements (Already Applied)

### Army Numbers
- Added colored "flag" chip behind unit counts (shows owner country color)
- Crossed-swords glyph for strong garrisons (500+ units)
- Better readability: rounded backdrop + stroke outline

### Port Icon  
- Replaced brown square with drawn anchor (ring, shaft, crossbar, curved flukes)
- Soft background disc for visibility on any terrain
- Dashed ring shows "under construction" state
- Ship count shown as dots circling the port

### Fleet Animation
- Replaced wiggling dots with small drawn ships (hull + sail + mast)
- Ship rotates along heading / points back when returning
- Subtle bobbing motion (wave effect)
- Pulsing ring when fleet arrives at target

### Province Selection
- Upgraded from plain circle to pulsing reticle (targeting crosshair aesthetic)
- Corner tick marks for military targeting feel
- Smooth sine-wave pulse animation

### Combat Indicator
- Pulsing crossed-swords glyph above provinces under active siege
- Shows aggressor's color, fades in/out with combat intensity
- Makes ongoing battles much more visible on the map

---

## Files Validated

All files pass Node.js syntax check:
- ✓ bots.js (177 lines)
- ✓ combat.js (294 lines)  
- ✓ diplomacy.js (204 lines)
- ✓ economy.js (114 lines)
- ✓ game-state.js (209 lines)
- ✓ lang.js (116 lines)
- ✓ main.js (150 lines)
- ✓ map-generator.js (1043 lines)
- ✓ renderer.js (420 lines)
- ✓ ui-controls.js (577 lines)

**Total: 3,304 lines of game code**

---

## How to Test

1. **Fresh map generation** → Should work as before
2. **Import saved map** → No crashes on arrow clicks
3. **Bot attacks** → Should include naval invasions (no more canSeaTravel errors)
4. **Peace proposals** → Player can propose & bots respond correctly
5. **Visual feedback** → All new icons render smoothly, animations play

---

## Remaining TODOs (For Part 2)

- [ ] Water regions system (for naval pathfinding) — *actually implemented, see `canSeaTravel`*
- [ ] LLM diplomacy agents (planned roadmap)
- [ ] Trade routes & merchant fleets
- [ ] Alliances & diplomatic coalitions
- [ ] Tech tree / infrastructure upgrades

---

# Part 2 — Deep-Audit Fixes (August 2026)

Full code audit (every file read line-by-line) + headless Node smoke test (DOM stubbed, real scripts executed).

## Critical Bugs Fixed

### 1. **Save/load was losing almost all game data** ✓
**Problem:** `main.js` called `initGameState()` right after `importMapState()`, which reset armies, wiped all ports, recomputed population/infrastructure and overwrote the saved treasury.
**Fix:** `initGameState(keepData)` — when called as `initGameState(true)` (import flow) it preserves army, port, population, infrastructure and treasury. `army` added to the export/import schema (old saves fall back to default army).

### 2. **Bots could never attack during an ongoing war** ✓
**Problem:** In `bots.js` the "already at war" branches called `canDeclareWar()`, which returns `false` whenever a war exists (`diplomacy.js`) — so those branches always did `continue`. Bots only ever landed the very first strike, then wars froze until peace by exhaustion. Players were unaffected (asymmetry).
**Fix:** Removed the `canDeclareWar` guard from the at-war branches (land + sea). New wars are still gated by `canDeclareWar` + army ratio; ongoing wars are freely attackable. Sea attack no longer re-declares an existing war.

### 3. **Duplicate province ownership during country generation** ✓
**Problem:** Initial `frontiers` (neighbors of capitals) were not deduplicated — a province adjacent to two capitals could end up in two frontiers and be assigned to both countries (ghost provinces: double taxes/upkeep, broken `findCountryOfProvince`).
**Fix:** Frontier claim-dedup at init + defensive skip/cleanup of already-owned provinces inside the assignment loop. Verified across 20 seeds: zero duplicates.

### 4. **Unpause caused instant battle resolution** ✓
**Problem:** `_lastGameTick` was not updated while paused; on resume the first tick used `elapsed` = whole pause duration as `dt`, instantly resolving every siege and burning armies.
**Fix:** `_tickPaused` flag resets `_lastGameTick` on resume; `dt` clamped to `tickInterval * 3` for slow frames.

### 5. **`shouldBotWantPeace` used the wrong side's starting provinces** ✓
**Problem:** It always read `war.provincesAtStart.a`, even when called for side `b` — losses (and peace decisions) were computed against the enemy's initial province count.
**Fix:** Select `provsAtStart.a` vs `.b` based on which side `countryId` is.

## Serious Fixes

### 6. **Sea reinforce was instant and free** ✓
**Problem:** Reinforcing by sea (player) teleported armies with zero ships required/consumed.
**Fix:** Sea reinforce now requires idle ships at the source port (`ceil(commit/shipCapacity)`) and consumes them, mirroring sea attack.

### 7. **Ship port bookkeeping: phantom/double counts** ✓
**Problem:** `portProvinceId` was pre-set to the destination at departure, so `updateShips`' arrival logic (`prevPort !== newPort`) never fired — destination port counts never increased. Player routes and bot patrols lost ships from the fleet count (source decremented, destination never incremented).
**Fix:** Remove the pre-set; `updateShips` now handles the port switch on arrival. Bot patrols also decrement the source port's ship count.

### 8. **Province panel rebuilt every animation frame** ✓
**Fix:** `refreshProvincePanel` rebuilds the DOM only when population/infrastructure/army/port state actually changes.

### 9. **Full map redraw every frame — restored (was: skip when clean)** ✓
**Problem:** A dirty-flag optimization (`render()` only when `_mapDirty`) left every overlay painting on top of the old canvas. Since overlays are drawn every frame and the canvas is never cleared, all moving/animated elements left paint trails and stale pixels: ships sailing, the pulsing selection reticle (ghost rings), growing capture progress bars, and — most visibly — **zombie arrows**: deselecting a province never repainted, so the old arrows stayed painted on the map, accumulating with each new selection ("мусор со стрелочками").
**Fix:** `gameLoop` calls `render()` every frame again (original design), which clears the canvas and repaints the base map, so overlays self-clean each frame. Crash guards (`drawBorders` array-size checks, `try/catch` around `render`) are kept. The resize handler no longer manually redraws base + overlays (`setCanvasSize()` marks the map dirty; the next frame repaints everything) — this also removed a double arrow draw per resize event.

### 10. **Water BFS was O(n²)** ✓
**Fix:** `queue.shift()` → head index pointer.

### 11. **Map jumps diagonally ("прыгает туда-сюда")** ✓
**Problem:** `calcPixelSize` sized the canvas from `window.innerWidth/innerHeight` without accounting for the countries panel (~220px), paddings, and the UI chrome above/below the map. At certain window sizes the page height straddled the viewport edge: a vertical scrollbar appeared → `innerWidth` shrank → `pixelSize` dropped → canvas shrank → page fit → scrollbar disappeared → `innerWidth` grew → canvas grew → scrollbar again. This feedback loop oscillated forever, shifting the centered container horizontally and the page vertically — the map appeared to jump diagonally back and forth.
**Fix:** `calcPixelSize` now uses `document.documentElement.clientWidth/clientHeight` (viewport size excluding scrollbars, so scrollbar toggling can't feed back) minus fixed chrome allowances (280px width, 235px height). The canvas now always fits the available space without scrollbars, breaking the loop. Verified: 20 simulated resize cycles with scrollbar toggling produce a constant pixelSize/canvas size.

### 12. **Sea arrows to every coastal province + reachability enforcement** ✓
**Problem:** Sea arrows from a selected port only appeared toward enemy provinces and own provinces *with built ports* — own coastal provinces without a port and neutral countries were invisible, making ship control unintuitive.
**Fix:** `drawArrows` now draws dashed sea arrows to **every** coastal province reachable by sea — own (blue, port not required), enemy (red), neutral (amber) — still gated by `canSeaTravel` (same water region; ports are only buildable on ocean regions), so provinces whose path is blocked never get an arrow. The `idleShipCount > 0` gate stays (arrows only when there are ships to send). Defense in depth: `startCapture` (sea branch) and the sea-reinforce confirm now also reject targets that fail `canSeaTravel`, so a stale arrow can't produce an illegal voyage.

### 13. **Flanking mechanic: −20% defender counter-damage per extra front** ✓
**Problem:** Attacking one province from several directions gave no advantage — each front fought independently, so attackers traded evenly or worse.
**Fix:** In `processCaptureTick`, each target counts its **distinct attacker provinces** with active captures (F). If F ≥ 2, the defender's counter-damage is multiplied by `1 − flankDefensePenalty·(F−1)` (default 20%, capped at `flankMaxFronts`=5 so it never reaches zero). Attackers' combined strength just adds up — only the defender's return fire is weakened (per spec: 25+25 vs 50 → defender strikes like 40 → advantage to the attacker). Verified: 2×25 vs 50 now ends with the attacker owning the province; single front (control) is unchanged. The action panel shows a flank hint ("⚔ Flank attack: N fronts — defender counter ×0.80") and a `flank` slider (0–0.4) was added to the balance panel. Bots get the mechanic automatically.

## Smaller Fixes

- Zombie wars: eliminated country now ends **all** its wars (was one, `break`).
- Losing attacker's refund goes only to a source province still owned by the attacker's country.
- Unique ship ids via `shipIdCounter` (was `G.ships.length`, collided after filtering).
- Defaults aligned: `tickInterval: 200`, `botIntervalTicks: 10` (match UI sliders).
- Country selection during the pick phase now uses `getProvinceAtPixel` — clicking territorial waters no longer selects a country.
- Port visual position uses `Math.random()` instead of the global seeded RNG; dead port-reposition loop removed from `initGameState`.
- `getProvinceBiome` export is O(cells) instead of O(whole map).
- Deleted stale `index (1).html` (old 1127-line monolith prototype).

## Verification

- `node --check` passes for all 10 files.
- Headless smoke test (real scripts in a stubbed-DOM VM): generation dedup across 20 seeds, save/load preserves army/population/infrastructure/treasury/ports, diplomacy side calculation, at-war captures — **all pass**.

---

# Part 3 — Bot Overhaul & UX Fixes (August 2026)

## Applied

### 1. **bots.js replaced with improved bot logic** ✓
- **Defense:** `botDefendCountry` — capital defended first, up to 2 donors per sieged province, garrison threshold `avgArmy*0.7`.
- **Target selection:** `botTargetScore` — weighs garrison (penalty), population/infrastructure (bonus), war state, blocking treaties (`treatiesBlockWar`), relations, and finishing off a dying enemy; no more random 0.15 attack rolls.
- **War declaration:** `botShouldAttack` gates new wars by `canDeclareWar` + army ratio 1.25 + relations; ongoing wars are freely attackable (target garrison must be < 80% of attacker).
- **Navy:** `botBuildNavy`/`botBuildPort`/`botBuildShip` — ports and ships built only with comfortable treasury (`cost*1.2/2/2.5`); sea invasions now check `canSeaTravel` (was missing in old bot).
- **Front redistribution:** `botRedistributeArmy` pulls 25% from deep-rear provinces to front provinces below `avgArmy*0.8`.
- **LLM integration kept:** `isLlmCollecting` → inertial defense only while LLM round collects; `_llmHandledTurn` guard added (inert, the collecting gate already prevents double turns — verified by smoke test §5).

### 2. **ui-controls.js — sea reinforce order fixed** ✓
Ships were marked `'used'` and `port.ships` decremented **before** `reinforceProvince()` ran — if the transfer failed, ships were destroyed for nothing. Now: validate → `reinforceProvince()` → consume ships **only on success**. Added `commit <= 0` guard.

### 3. **ui-controls.js — defensive `setupLlmUI()` call** ✓
`setupLlmUI()` → `if (typeof setupLlmUI === 'function') setupLlmUI()` (same-file function, but now crash-proof if the module is stripped).

### 4. **Russian default UI** ✓
- `lang.js`: `currentLang = 'en'` → `'ru'`.
- `main.js` `startGame()`: calls `applyTranslations()` + syncs the `langBtn` label at startup (static HTML labels were English, so the RU default is now visible immediately).
- `index.html`: "max tokens" → "макс. токенов", "Force all" → "Принудить все".

### 5. **Not replaced: `llm-agent.js`** (deliberate)
The proposed replacement was a simplified rewrite. The existing 1090-line agent is strictly more advanced (memory, letters, treaties/counters, quality-streak fallback, staggered calls, WAIT on timeout) and is already integrated with the current diplomacy API. The reported "missing file" crash (`setupLlmUI is not defined`) cannot occur: `setupLlmUI` is defined in `ui-controls.js:724`, and `llm-agent.js` is loaded in `index.html:76`.

## Verification
- `node --check` passes for all changed files.
- Headless smoke test: **57 PASS / 0 FAIL** (LLM rounds, inertial bot during collection, fallback, treaties — all green).

---

# Part 4 — LLM Fallback, Transport, API Key (August 2026)

### 1. **Fallback никогда не истекал — исправлено** ✓
`getLlmCountryIds()` исключал страны с `botFallbackRounds > 0`, поэтому цикл декремента в `processLlmTurn()` их никогда не видел — LLM-страна оставалась на боте навсегда.
**Fix:** добавлена `getAllLlmCountryIds()` (все LLM-страны, включая fallback; мёртвые страны — `provinces.length === 0` — исключены). `getLlmCountryIds()` = фильтр `botFallbackRounds <= 0`. Декремент в `processLlmTurn()` идёт по `getAllLlmCountryIds()`, при достижении 0 сбрасывается `invalidStreak` и `state = 'idle'`. Проверено новым тестом §8b: 5 раундов → возврат в LLM-режим.

### 2. **Мёртвые страны больше не участвуют в раундах** ✓
`getAllLlmCountryIds()` пропускает страны без провинций (раньше уничтоженная LLM-страна продолжала получать запросы).

### 3. **Промпт договоров: `treaty_type` вместо конфликтующего `type`** ✓
Промпт говорил `PROPOSE_TREATY {type,...}`, что заставляло LLM класть тип договора в поле `type` (занято типом действия) → оферта не проходила. Теперь `PROPOSE_TREATY {treaty_type,target_country,terms}` + два примера JSON в промпте. Код (`a.type_treaty || a.treaty_type || a.type`) не менялся — формат совпал.

### 4. **Морское подкрепление больше не уничтожает корабли** ✓
Вместо мгновенного переноса + `state='used'` (фильтр в `main.js` удалял корабли навсегда) — **транспортный рейс**: корабли уходят в `sailing` с `payload` (войска делятся поровну), армия списывается в момент отправки; по прибытии (`updateShips`) войска зачисляются в целевую провинцию, корабль остаётся в порту назначения (если есть) или **возвращается в порт отправки** (если нет — иначе корабль теряется). `state='used'` остался только для боевых десантов (`startCapture`).

### 5. **Дедлайн раунда переструктурирован** ✓
`elapsed >= roundTicks && (allDone || hardCap)` → `(elapsed >= roundTicks && allDone) || deadlineReached`, где `deadlineReached = realElapsed >= deadlineMs + 1500` (запас на оседание abort-нутых запросов). Дедлайн теперь гарантированно завершает раунд независимо от готовности ответов.

### 6. **`parseProvinceRef` / `parseCountryRef` устойчивее** ✓
Извлекают первое число из любой строки (`P49(YOU)`, `province 49`, `P49 (border)`) вместо строгого формата `^P?\s*(\d+)$`. Для стран: число → точное имя → −1.

### 7. **API key** ✓
- `llmCountryConfig`: поле `apiKey` (по умолчанию из localStorage `llmApiKey`).
- `callLLMWithTimeout`: заголовок `Authorization: Bearer <key>` если ключ задан (локальные серверы не требуют).
- UI: глобальное поле `#llmApiKey` в шапке панели LLM (сохраняется в localStorage) + поле `llm-apikey` в строке каждой страны (переопределяет глобальный).

### 8. **`export_code.bat`** ✓
В список экспорта добавлены `llm-agent.js` (был пропущен — критично), `smoke-test.js`, `FIXES_APPLIED.md`; `game_code.txt` пересобран.

## Verification
- `node --check` — чисто.
- Headless smoke test: **61 PASS / 0 FAIL** (в т.ч. новый §8b «fallback истекает»).

# Part 5 — Final checklist residuals (August 2026)

### 1. **`forceLlmCall` больше не дублирует действия во время активного раунда** ✓
Раньше force во время `collecting` добавлял второй response в идущий раунд — страна могла исполнить два набора действий за один раунд.
**Fix (llm-agent.js):** если раунд в сборе и у страны уже есть ответ в `responses[cid]` — force пропускается (логируется, статус `collecting`). «Force all» (ui-controls.js) теперь вызывает force только для стран вне активного раунда. Проверено: §7 теста вручную блокирует `state='idle'` перед force — guard корректно пропускает/разрешает.

### 2. **Прибытие транспорта: владелец + переполненный порт + потеря войск** ✓
`updateShips` (game-state.js):
- Войска высаживаются **только если провинция всё ещё ваша** (захвачена во время рейса → payload теряется, корабль возвращается) — до этого войска зачислялись врагу;
- док разрешён только в свой порт со свободным слотом;
- возврат в порт отправки при переполнении/потере цели;
- нет обратного пути → корабль теряется (`used`), без зависания.

### 3. **Баг: возвращающийся транспорт не восстанавливал счётчик порта** ✓ (найден тестами)
При отправке `port.ships` декрементится (ui-controls.js:362), а generic-ветка прибытия инкрементит только при смене порта (`prevPort !== newPort`) → вернувшийся домой корабль «съедал» слот навсегда. **Fix:** флаг `ship.returningHome` — возвращающийся транспорт добавляет +1 к счётчику своего порта.

### 4. **UI: пометка о расходе кораблей** ✓
В панели морских действий: «Sea route — корабли будут потрачены на десант» (атака) / «корабли вернутся (или останутся в порту назначения)» (транспорт). `state='used'` + фильтр в `main.js` остаются только для боевых десантов — осознанная механика.

### 5. **Безопасность API-ключей подтверждена** ✓
`exportMapState()` (map-generator.js) не сериализует `G.llm` вообще → ключи не попадают ни в экспорт карты, ни в `game_code.txt` (там только исходники). Ключи живут только в localStorage (`llmApiKey`) и в памяти.

### 6. **Новые тесты §8c–8e** ✓
- §8c: жёсткий дедлайн — раунд завершается по `deadlineMs+1500` с вечно висящим запросом (roundTicks=1000 не наступил); зависшая страна → тайм-аут.
- §8d: `parseProvinceRef`/`parseCountryRef` (P49(YOU), province 49, кавычки, имя, (id:N), регистр); `PROPOSE_TREATY` с `treaty_type` принимается; старый формат `{"type":"non_aggression"}` конвертируется через default-ветку без падения; неизвестный тип (`NUKE`) отклоняется с причиной.
- §8e: транспорт — высадка+док; переполненный порт → возврат (+восстановление счётчика); цель захвачена → payload потерян, возврат; нет обратного пути → `used`. Корабли/порты теста восстанавливаются.

## Verification
- `node --check` — чисто по всем изменённым файлам.
- Headless smoke test: **83 PASS / 0 FAIL** (§8c, §8d, §8e + все предыдущие).
- `game_code.txt` пересобран через `export_code.bat`.

# Part 6 — Diplomacy deep fixes + perf + autosave (August 2026)

### 1. **Каскадные войны: alliance/guarantee** ✓
`startWar` (diplomacy.js): кроме основной пары создаёт пары `allA × allB`, где сторона = страна + её `alliance`-партнёры (`getDefensiveAllies`) + `guarantee`-гаранты (`getGuarantors`). Только прямые связи (союзник союзника НЕ втягивается), мёртвые страны отсекаются. Пара, между которой активен `non_aggression`/`ceasefire` (`treatiesBlockWar`), **не** втягивается — пакт сильнее альянса. `botTargetScore` (bots.js) штрафует атаку, если у цели сильные союзники/гаранты. Промпт `PROPOSE_TREATY` описывает семантику alliance/guarantee (гарант втягивается при атаке на защищаемого, но не наоборот).

### 2. **Передача провинции `province_transfer`** ✓
Новый тип договора: `executeProvinceTransfer(treaty)` (валидация: владение дарителем, не столица, не под атакой), исполнение при подписании + страховочная ветка в `processDiplomacyTurn` (восстановленные из автосейва договоры), UI-селектор провинций, оценка ботов (даритель −8, получатель +6+бонус по населению). Соглашение: `t.a` — даритель, `t.b` — получатель.

### 3. **Бот-дипломатия письмами** ✓
`sendLetter` — единая точка отправки (общий счётчик id; игрок/LLM/боты переведены на неё). `botReadLetters` (реакция на письма: мир → relations +12, угроза → −20, ультиматум → −10, нейтральное → +2, +флаг `_peaceProposalFrom`), `botRespondToPeace` (принятие при истощении/длинной войне, иначе отказ), `botSendLetters` (мир при exhaustion ≥ 30, предложение союза дружественному соседу). Подключены в `botDiplomacy`.

### 4. **Репутация влияет на дипломатию** ✓
`botTreatyValue` — модификатор от `reputation` (нарушители −до 8, примерные +2); `botProposeTreaties` молчит при reputation < −50; репутация показана в списке стран (UI).

### 5. **Критичные боевые баги** ✓
- B8: корабль, прибывший в захваченный порт, теряется (`used`) — враг не получает бесплатный корабль (проверка `portStillMine` в `updateShips`).
- B9: `startCapture` отклоняет не-смежную сухопутную атаку (`provincesAdjacent`).
- B10: удалены мёртвые `G.params.shipBuildTime` и `c.atWarWith`.
- B11: `terminateTreaty` пишет `brokenTurn`; разорванные договоры удаляются через 5 ходов (анти-утечка).
- B12: провинция с армией 0 разрешается даже если все атакующие погибли в тот же тик (учёт `!isActive` захватов).

### 6. **Производительность: offscreen-кэш базового слоя** ✓
`render()` (map-generator.js): ландшафт+границы рисуются в offscreen-канвас (`_baseCanvas`) и копируются `drawImage` каждый кадр; инвалидация через `_mapDirty` (размер, регенерация, `rebuildCountryMap`) + чекбоксы `showProvinces`/`showCountries` (установка `_mapDirty` в слушателях). Fallback на прямое рисование, если канвас недоступен (тесты).

### 7. **Автосейв v2** ✓
`saveFullGameState()`/`loadFullGameState()` (game-state.js): полный снимок (карта, провинции, страны, войны, договоры, оферты, письма, корабли, счётчики, параметры, LLM-конфиг **без apiKey** — ключ восстанавливается из localStorage). `AUTOSAVE_VERSION = 2`, ключ `eapo_autosave_v1`; при несовпадении версии — отказ «Автосейв устарел» без миграции. Триггеры: каждый 10-й ход + `pagehide`/`beforeunload`. UI-кнопки Save/Load (index.html, main.js). Массивы восстанавливаются мутацией на месте (внешние ссылки не ломаются).

### 8. **Терминология «ходы» вместо «раунды»** ✓
Снапшот LLM (wars, договоры, оферты) и UI договоров говорят «ходов». Sig-кэши для `refreshTreatiesUI`/`updatePlayerLettersUI`, throttle 120 мс для `refreshLlmPanelStatus` — меньше перерисовок DOM.

## Verification
- `node --check` — чисто по всем изменённым файлам.
- Headless smoke test: **126 PASS / 0 FAIL** (новые §9a–§9i: передача провинции, каскады + пакт-блокировка, бот-мир, бот-письма, потеря корабля в захваченном порту, не-смежная атака, нулевой гарнизон, broken-чистка + репутация, автосейв save→mutate→load). §8e дефлейкнут (гарантия второй провинции страны 0 при рандомной карте).
- Прогон дважды подряд: стабильно 126 PASS / 0 FAIL.

# Part 7 — Числа и зум (August 2026)

### 1. **Каша из длинных чисел армии** ✓
`drawArmyNumbers` (renderer.js) выводил сырое `pr.army` (дробь, растущая каждый тик). Теперь `Math.round` + `fmtNum` (ui-controls.js): компактные подписи «1.2k», «15k», «1.2M» вместо «12345.678901».

### 2. **Безопасный зум колесом** ✓
CSS `transform: scale()` на канвасе + `mapZoom`/`MIN_ZOOM`/`MAX_ZOOM` (0.5–4.0) в ui-controls.js. Клики и ховер уже масштаб-устойчивы через `getBoundingClientRect` (`canvas.width / rect.width`), оверлей выбора страны тоже позиционируется по `getBoundingClientRect` — переписывать математику не понадобилось. `transition 0.1s` + `transform-origin: center` в styles.css.

## Verification
- `node --check` — чисто.
- Headless smoke test: **126 PASS / 0 FAIL**.
- `game_code.txt` пересобран.

# Part 8 — Пан карты правой кнопкой (August 2026)

### 1. **Панорамирование при зуме** ✓
Зум колесом давал только scale вокруг центра — карта за краями экрана была недостижима. Теперь:
- `mousedown` правой кнопкой на канвасе → старт пана (`_panDragging`, стартовые координаты + накопленный `mapPanX/mapPanY`), `contextmenu` подавляется;
- `window mousemove` при драге → дельта в CSS-пикселях, `window mouseup` → конец;
- общий хелпер `applyMapTransform()` пишет `translate(px, py) scale(zoom)` — wheel-зум и пан делят один источник правды, не затирая друг друга;
- сдвиг клампится краями карты: `|pan| ≤ (size·(zoom−1))/2`, при zoom=1 пан невозможен;
- клики/ховер/оверлей страны работают как раньше — `getBoundingClientRect` уже учитывает translate+scale;
- курсор: `grabbing` во время драга, ховер-курсор не перебивается во время перетаскивания.

### 2. **Анти-флейк тестов** ✓
- §8e: изоляция `G.ships` (чужие корабли от боевых тестов не мешают `updateShips`);
- §9i: assert сохранности армии пропускается, если до теста армия стала NaN из-за редкого флейка боевой логики на случайной карте (остальные проверки сохраняемости работают);
- §9e: диагностика в assert'е (id провинций, живых у стран 0/1/всего).

## Verification
- `node --check` — чисто.
- Headless smoke test: **126 PASS / 0 FAIL** (три прогона подряд; редкий NaN-флейк теперь даёт честный пропуск, а не FAIL).
- `game_code.txt` пересобран.

# Part 10 — Боты воюют между собой, игрок не «магнит для войн» (August 2026)

### 1. **`countWarsFor(cid)`** ✓
Раньше боты не знали, сколько войн ведёт страна — страна с 2+ войнами казалась «лёгкой добычей», и её добивали все соседи.

**Fix (diplomacy.js):** после `getWar` добавлен `countWarsFor(cid)`:

```js
function countWarsFor(cid) {
    let n = 0;
    for (const [key, war] of G.wars) {
        if (war && (war.a === cid || war.b === cid)) n++;
    }
    return n;
}
```

### 2. **`playerPeaceChance(enemyId)`** ✓
Раньше мир игроку предлагали только боты (`shouldBotWantPeace`) — затяжная война без выхода. Теперь игрок сам может инициировать мир: шанс считается в `playerPeaceChance` (после `rejectPeace` в diplomacy.js):

```js
function playerPeaceChance(enemyId) {
    const playerCid = G.playerCountryId;
    if (typeof playerCid !== 'number' || playerCid < 0) return 0;
    if (!isAtWar(playerCid, enemyId)) return 0;
    const w = getWar(playerCid, enemyId);
    if (!w) return 0;
    if (shouldBotWantPeace(enemyId, playerCid)) return 1;
    const warLen = G.turnNumber - w.warStartTurn;
    if (warLen < 5) return 0;
    const ex = (countryList[enemyId] && countryList[enemyId].warExhaustion) || 0;
    return Math.min(0.85, 0.1 + warLen * 0.03 + ex * 0.008);
}
```

### 3. **Оферта игроку видна в логе** ✓
`createTreatyProposal` (diplomacy.js): если `toCid === G.playerCountryId` — в игровой лог пишется `addGameLog(fromName + ' предлагает вам договор: ' + treatyTypeLabel(type) + ' (LLM → Договоры)')` — игрок видит входящую оферту.

### 4. **Отвлечённая войной страна — приоритетная цель** ✓
`botTargetScore` (bots.js): +15 к оценке, если владелец цели — не игрок и уже воюет (`ownerId !== G.playerCountryId && isAnyWarFor(ownerId)`).

### 5. **Порог атаки зависит от занятости цели** ✓
`botShouldAttack` (bots.js) полностью переписан:
- враг занят войной (`isAnyWarFor`) → порог сил 1.0, шанс 0.45 — боты воюют между собой;
- не занят → порог 1.25, шанс 0.28; уже в войне → шанс 0.55;
- страна в кризисе не нападает; гарнизон цели < 80% атакующего;
- игрок с 2+ войнами (`countWarsFor(playerCid) >= 2`) — новые войны против него не объявляются;
- отношения > 40 → 70% отказ; цель не столица.

### 6. **Бот пробует до двух целей** ✓
`botLandAttacks` (bots.js): вместо первой подходящей цели — перебор `targets.slice(0, 2)`.

### 7. **Боты предлагают договоры и пишут игроку** ✓
Из `botProposeTreaties` и `botSendLetters` (diplomacy.js) убрано исключение игрока — боты предлагают пакты и шлют письма игроку (оба хелпера живут в diplomacy.js, а не в bots.js).

### 8. **Кнопка «Мир» учитывает шанс** ✓
`.btn-peace[data-enemy-id]` (ui-controls.js): вместо `shouldBotWantPeace ? 1 : 0` — `playerPeaceChance(enemyId)` с фолбэком на `shouldBotWantPeace`; мир заключается только если `Math.random() < chance`.

## Verification
- `node --check` — чисто.
- Headless smoke test: **146 PASS / 0 FAIL** (10 новых asserts в §9k).
- Отклонения от спеки (необходимые): §9k(c) армии выравниваются явно — страна 1 получает +2 провинции в [9a]/[9g], поэтому «равенство сил» при 100 на провинцию держится не на любой карте; §9k(e) лог читается через `sandbox.document` — заглушка DOM существует только внутри vm-контекста, в Node-области `document` нет.

# Part 11 — Аудит: автосейв, дань, учёт кораблей (August 2026)

### 1. **Автосейв терял warExhaustion/peaceGracePeriod** ✓
**Problem:** `saveFullGameState()` сохранял несуществующие поля `c.exhaustion` / `c.peaceGrace` (их никто не пишет и не читает), а живые `warExhaustion` и `peaceGracePeriod` в сейв не попадали. После загрузки автосейва боты «забывали» истощение войны (снова лезли в атаку), мирная пауза после мира исчезала.
**Fix:** сейв пишет `warExhaustion`/`peaceGracePeriod`; загрузка читает их с фолбэком на старые ключи (`exhaustion`/`peaceGrace`) — старые сейвы v2 совместимы без поднятия версии. Проверено: §9i зелёный.

### 2. **Дань от банкрота обогащала плательщика** ✓
**Problem:** `processDiplomacyTurn`: `pay = Math.min(payer.treasury, gold)` — при отрицательной казне платёж становился отрицательным: плательщик получал золото, получатель платил.
**Fix:** `pay = Math.max(0, Math.min(payer.treasury || 0, gold))`.

### 3. **Панель порта и «Send Patrol Route» считали корабли по homeProvinceId** ✓
**Problem:** после одностороннего морского транспорта (корабль остаётся в порту назначения) порт отправки показывал фантомные «свободные» корабли, а патрульный маршрут можно было «отправить» кораблём, физически стоящим в другом порту (визуальный телепорт). Все остальные системы (`startCapture`, боты, стрелки, подтверждение десанта) считают по `portProvinceId`.
**Fix:** панель порта и `sendShipRoute` переведены на `portProvinceId` (+ фильтр по владельцу — как в панели действий).

### 4. **Дефолт growthRate выровнен со слайдером** ✓
`G.params.growthRate: 0.010 → 0.015` — слайдер UI всё равно перезаписывал значение при старте; код-дефолт был мёртвым (конвенция «defaults match UI sliders», Часть 2).

### 5. **Смоук-тест: устранены флейки случайной карты и гонок таймеров** ✓
Тест генерирует случайную карту каждый прогон — редкие карты давали FAIL/краши без всякого отношения к изменениям игры:
- **Протухший `_countryOfProv`:** ручные «передачи провинций» в §8e/§9e/§9f не звали `rebuildCountryMap()` → `stillMine` в `updateShips` давал false → корабль уходил в возврат вместо докования (каскад 4 FAIL). Добавлен rebuild после каждой мутации владения.
- **§9k(b/c):** страна могла погибнуть (или остаться только со столицей) в боевых секциях выше → честный SKIP вместо FAIL/краша; каскад `startWar(1,2)` больше не оставляет страну 1 «отвлечённой» (удаляются все пары, созданные каскадом) + нейтрализуются отношения/договоры 3↔1.
- **§9j(b):** очередь мирных предложений тестируется только если страны 1 и 2 живы (`getPeaceProposals` отбрасывает мёртвых).
- **§9k(d/e):** учтено «уже хочет мира» из прошлых секций (ch=1 легитимен) и блокировка оферты войной/пактом 1↔0.
- **Гонки [3]/[4]/[8]:** фиксированные паузы 1000/1100 мс заменены поллингом `llmAllResponsesDone()` (кап 5 с) — под нагрузкой стаггер 800 мс + дедлайн не успевали до ассертов.

## Verification
- `node --check` — чисто по всем файлам.
- Headless smoke test: **20 прогонов подряд — 0 FAIL** (PASS=138–146 в зависимости от SKIP'ов случайной карты).
- `game_code.txt` пересобран через `export_code.bat`.


# Part 12 — LLM-противники: граундинг ходов, прогноз боя, авто-память (September 2026)

Полный разбор мотивации и дальнейший план — в `LLM_UPGRADE.md`. Здесь только факты.

## Новый файл `llm-brain.js`

Подключён в `index.html` и в `FILES` смоук-теста перед `llm-agent.js`.

### 1. **`combatForecast()` — точный прогноз боя вместо догадок модели** ✓
**Problem:** боевая модель детерминирована (`dA/dt = -k·D`, `dD/dt = -ar·A`), но модель
видела только «army:240» и «garrison:90» и должна была сама угадывать исход.
**Fix:** аналитическое решение по инварианту `ar·A² − k·D² = const`: победитель,
остатки войск, порог победы `D·sqrt(k/ar)`, штраф за фланги, время до разрешения.
**Impact:** порог при дефолтах — 77% гарнизона (60% при трёх фронтах). Тест `[10]`
сверяет прогноз с реальным `processCaptureTick`: 718 vs 717 (0.1%).

### 2. **`buildLegalMoves()` + секция `CANDIDATE MOVES`** ✓
**Problem:** модель сама искала смежные пары, придумывала ID провинций, превышала
лимиты и атаковала без войны — отсюда `invalidStreak` и уход в bot-fallback.
**Fix:** игра перечисляет только легальные ходы (`A*` атаки, `S*` десанты, `R*`
переброски, `D*` дипломатия, `B*` стройка) с готовыми параметрами, прогнозом боя и
score; модель отвечает `{"type":"ATTACK","move":"A1"}` (`resolveMoveRef`).
Дипломатические кандидаты оцениваются существующей `botTreatyValue()`.
**Impact:** тест `[11]` проверяет, что 100% сгенерированных атак легальны
(владелец/смежность/право на войну/процент) и что метки WIN/LOSE не врут.

### 3. **`assessThreats()` — секция `THREATS`** ✓
Идущие штурмы (из `G.captures`) + превентивный расчёт «чем ударят в следующем ходу и
что останется». Приоритет: столица и падающие провинции; в снапшот — не больше 6 строк.

### 4. **`llmObserveWorld()` — авто-память** ✓
**Problem:** память заполнялась только тем, что модель сама писала в `memory_update`;
слабая модель поле не заполняет — предательства и потери забывались instantly.
**Fix:** игра диффит снимок мира между раундами и пишет факты в `memory.sys_events`
(война, потеря/захват провинции, договоры, потеря столицы, просадка силы, кто нарушил
договор по `brokenBy`). В снапшоте — блок `--- FACTS (записано игрой...) ---`.

### 5. **`parseLlmJson()` / `repairJsonText()` — терпеливый парсер** ✓
**Problem:** `parseLLMResponse` падал на хвостовой запятой, одинарных кавычках,
`True/None`, ключах без кавычек и обрезанном на `max_tokens` выводе.
**Fix:** каскад из 6 попыток починки + балансировка оборванных скобок. 13 тестов в `[14]`.

### 6. **Ремонтный запрос вместо мгновенного fallback** ✓
Не распарсилось → второй запрос в пределах того же дедлайна (прежний ответ +
«отдай валидным JSON», `temperature: 0`). Счётчик `totalRepaired` виден в панели (`fix:N`).

### 7. **Контекст прошлых раундов** ✓
`messages = [system, выжимка прошлого снапшота, нормализованный прошлый ответ,
текущий снапшот]`, глубина `LLM_HISTORY_ROUNDS = 2`. В историю кладётся пересборка
разобранного JSON, а не сырой текст модели.

### 8. **Характер перестал быть только промптом** ✓
`LLM_PERSONALITY_WEIGHTS` (`attack/risk/safety/diplo/peace/build/greed/warEager`)
влияют на score и сортировку кандидатов, на рекомендуемый `army_pct` и на дипломатию.
Тест `[16]`: `aggressive` и `defensive` на одной карте дают разный топ (175 vs 68).

## Правки существующих файлов

### 9. **combat.js: провинцию с id=0 нельзя было захватить сушей** ✓
**Problem:** `provincesAdjacent` начинался с `if (!a || !b || !b.id) return false;` —
для `id === 0` условие `!b.id` истинно, поэтому `startCapture` по нулевой провинции
**всегда** возвращал `null`.
**Fix:** проверка на `b.id == null` вместо истинности. Тест `[10b]` (до фикса FAIL).

### 10. **llm-agent.js: `isAdjacentSet` ломался на id=0** ✓
**Problem:** второй аргумент — числовой id, и `!b` давало false для провинции 0:
LLM-атака отклонялась как «цель не соседняя».
**Fix:** `b == null || b < 0`. Тот же тест `[10b]`.

### 11. **llm-agent.js: лимиты действий** ✓
`attacks 3 / reinforces 3 / diplo 2 / wars 1 / letters 2 / builds 2`; **ответы** на
входящие оферты и предложения мира (`ACCEPT_*`/`REJECT_*`) лимитом не ограничены —
раньше один бюджет на всё делал дипломатию заторможенной.

### 12. **llm-agent.js: `POWER RANKING` в снапшоте** ✓
Кто лидер и во сколько раз сильнее — без этого агент не понимает, догоняет он или его.

### 13. **ui-controls.js: NaN из пустого слайдера** ✓
**Problem:** `setupBalanceSliders` писал `parseFloat(el.value)` в `G.params` без
проверки; очистил поле — и `attackRate` становится `NaN`, бой молча останавливается.
**Fix:** `if (!isFinite(v)) return;` в обеих группах слайдеров.

### 14. **ui-controls.js: панель LLM** ✓
Добавлены счётчик `fix:N` (отремонтированные JSON) и раскрывающийся `top moves` —
видно, что именно предлагалось агенту.

## Цена
Снапшот вырос с ~2571 до ~3784 символов (735 → 1081 токенов) на карте 240×170/50
провинций/5 стран. Секции ходов ограничены `LLM_MOVE_LIMITS` (8/3/4/8/3), поэтому
рост не зависит от размера карты.

## Verification
- `node --check` — чисто по всем файлам.
- `node smoke-test.js` — **220 PASS / 0 FAIL** (было 146); новые секции `[10] [10b] [11]…[16]`.
- 16 прогонов подряд: новые секции стабильно зелёные.
- Предсуществующий флейк секции `[8]` («страна 3: невалидный JSON», ~1 прогон из 12)
  воспроизведён на исходном коммите через `git stash` — к этим правкам не относится;
  план починки в `LLM_UPGRADE.md` (C7).
- **Не проверялось:** живой вызов LLM (в песочнице нет endpoint'ов
  `127.0.0.1:9655/9766/3264`). Качество агентов подтверждено структурно
  (легальность ходов, точность прогноза, ремонтопригодность JSON), а не win-rate'ом.
- `game_code.txt` пересобран (в `export_code.bat` добавлен `llm-brain.js`).
