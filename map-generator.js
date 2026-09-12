class PerlinNoise {
    constructor(seed) {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        let s = seed;
        for (let i = 255; i > 0; i--) {
            s = (s * 1664525 + 1013904223) & 0x7fffffff;
            const j = (s >>> 0) % (i + 1);
            const t = p[i]; p[i] = p[j]; p[j] = t;
        }
        this.perm = new Uint8Array(512);
        for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    }
    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(a, b, t) { return a + t * (b - a); }
    grad(h, x, y) {
        const hh = h & 3;
        const u = hh < 2 ? x : y;
        const v = hh < 2 ? y : x;
        return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
    }
    noise(x, y) {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        const xf = x - Math.floor(x), yf = y - Math.floor(y);
        const u = this.fade(xf), v = this.fade(yf);
        const p = this.perm;
        const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
        const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
        return this.lerp(
            this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u),
            this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u),
            v
        );
    }
    octaveNoise(x, y, oct, pers) {
        let val = 0, amp = 1, freq = 1, max = 0;
        for (let i = 0; i < oct; i++) {
            val += amp * this.noise(x * freq, y * freq);
            max += amp;
            amp *= pers;
            freq *= 2;
        }
        return (val / max + 1) / 2;
    }
}

function lerp3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function evalStops(stops, h) {
    if (h <= stops[0][0]) return stops[0][1];
    if (h >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (h >= stops[i][0] && h < stops[i + 1][0]) {
            const t = (h - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
            return lerp3(stops[i][1], stops[i + 1][1], t);
        }
    }
    return stops[stops.length - 1][1];
}

const WATER = [
    [0.00, [8, 16, 38]],
    [0.30, [14, 38, 72]],
    [0.40, [22, 62, 108]],
    [0.46, [34, 88, 138]],
    [0.485, [56, 120, 156]],
    [0.50, [92, 160, 160]],
];

const DRY = [
    [0.500, [214, 202, 150]],
    [0.520, [222, 196, 120]],
    [0.560, [210, 178, 96]],
    [0.620, [196, 160, 84]],
    [0.680, [168, 150, 88]],
    [0.760, [140, 122, 96]],
    [0.860, [128, 118, 118]],
    [0.930, [190, 190, 196]],
    [1.000, [250, 250, 252]],
];

const WET = [
    [0.500, [222, 214, 160]],
    [0.520, [176, 196, 96]],
    [0.560, [128, 176, 68]],
    [0.620, [78, 150, 56]],
    [0.680, [46, 122, 48]],
    [0.760, [58, 100, 58]],
    [0.860, [104, 108, 100]],
    [0.930, [196, 196, 200]],
    [1.000, [250, 250, 252]],
];

const WETTEST = [
    [0.500, [214, 210, 150]],
    [0.520, [98, 168, 84]],
    [0.560, [46, 138, 62]],
    [0.620, [22, 108, 48]],
    [0.680, [16, 86, 40]],
    [0.760, [54, 94, 56]],
    [0.860, [104, 108, 100]],
    [0.930, [196, 196, 200]],
    [1.000, [250, 250, 252]],
];

const COLD = [
    [0.500, [200, 206, 200]],
    [0.520, [150, 168, 150]],
    [0.560, [120, 148, 130]],
    [0.620, [96, 128, 112]],
    [0.680, [58, 96, 76]],
    [0.760, [90, 100, 96]],
    [0.860, [130, 132, 134]],
    [0.930, [206, 208, 212]],
    [1.000, [252, 252, 254]],
];

const CURRENT_SCHEMA_VERSION = 1;
function idxOf(x, y) { return y * COLS + x; }

function getBiomeName(h, m, lat) {
    if (h <= 0.50) return 'water';
    const cold = lat < 0.15;
    const wettest = m > 0.72 && lat > 0.5;
    if (cold) return h < 0.56 ? 'tundra' : (h < 0.68 ? 'sparse_taiga' : (h < 0.76 ? 'taiga' : (h < 0.86 ? 'rocky_slopes' : 'alpine')));
    if (wettest) return h < 0.56 ? 'light_jungle' : (h < 0.68 ? 'jungle' : (h < 0.76 ? 'dense_rainforest' : (h < 0.86 ? 'cloud_forest' : 'alpine')));
    if (m < 0.5) return h < 0.52 ? 'dunes' : (h < 0.62 ? 'semi_desert' : (h < 0.68 ? 'dry_steppe' : (h < 0.76 ? 'dry_hills' : (h < 0.86 ? 'foothills' : 'rocky_slopes'))));
    return h < 0.52 ? 'meadow' : (h < 0.62 ? 'savanna' : (h < 0.68 ? 'plain' : (h < 0.76 ? 'forest' : (h < 0.86 ? 'coniferous_forest' : 'rocky_slopes'))));
}

function getBiomeColor(h, m, lat) {
    if (h <= 0.50) return evalStops(WATER, h);

    const cold = evalStops(COLD, h);
    const dry = evalStops(DRY, h);
    const wet = evalStops(WET, h);
    const wettest = evalStops(WETTEST, h);

    const warmBlend = Math.pow(m, 0.9);
    let warm;
    if (m < 0.5) {
        warm = lerp3(dry, wet, warmBlend * 2);
    } else {
        warm = lerp3(wet, wettest, (warmBlend - 0.5) * 2);
    }

    const t = Math.max(0, Math.min(1, (lat - 0.15) / 0.35));
    let c = lerp3(cold, warm, t);

    if (h > 0.90) {
        const s = Math.pow((h - 0.90) / 0.10, 1.4);
        c = lerp3(c, [248, 250, 253], s);
    }
    return c;
}

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
let COLS = 240, ROWS = 170;
let pixelSize = 4, seed = 0;
let heightMap, moistMap, latMap, lightMap;
let provinceMap, countryMap, provinceOf, provinceList, countryList;
let rngState = 1;
let _countryOfProv = null;
let _mapDirty = true;
let _mapRenderedOnce = false;

function seededRandom() {
    rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
    return (rngState >>> 0) / 2147483647;
}

function calcPixelSize() {
    const docEl = document.documentElement || { clientWidth: window.innerWidth, clientHeight: window.innerHeight };
    const availW = Math.max(200, docEl.clientWidth - 280);
    const availH = Math.max(200, docEl.clientHeight - 235);
    const psW = Math.floor(availW / COLS);
    const psH = Math.floor(availH / ROWS);
    pixelSize = Math.max(2, Math.min(psW, psH, 8));
}

function setCanvasSize() {
    calcPixelSize();
    canvas.width = COLS * pixelSize;
    canvas.height = ROWS * pixelSize;
    _cachedImgData = null;
    _mapDirty = true;
}

function generate(seedVal) {
    COLS = parseInt(document.getElementById('mapWidth').value) || 240;
    ROWS = parseInt(document.getElementById('mapHeight').value) || 170;
    document.getElementById('mapWidthVal').textContent = COLS;
    document.getElementById('mapHeightVal').textContent = ROWS;
    const totalCells = COLS * ROWS;
    const maxProv = Math.max(8, Math.min(300, Math.floor(totalCells / 200)));
    const provEl = document.getElementById('provCount');
    const prevMaxProv = parseInt(provEl.max) || maxProv;
    provEl.max = maxProv;
    // Масштабируем число провинций пропорционально площади карты
    if (prevMaxProv !== maxProv) {
        const scaled = Math.round(parseInt(provEl.value) * (maxProv / prevMaxProv));
        provEl.value = Math.max(4, Math.min(maxProv, scaled));
    } else if (parseInt(provEl.value) > maxProv) {
        provEl.value = maxProv;
    }
    document.getElementById('provCountVal').textContent = provEl.value;

    const maxCountries = Math.max(2, Math.min(12, Math.floor(parseInt(provEl.value) / 4)));
    const countryEl = document.getElementById('countryCount');
    const countryLabel = document.getElementById('countryCountVal');
    countryEl.max = maxCountries;
    if (parseInt(countryEl.value) > maxCountries) {
        countryEl.value = maxCountries;
    }
    countryLabel.textContent = countryEl.value;
    setCanvasSize();

    seed = (seedVal != null) ? seedVal : (Math.random() * 2147483647 | 0) + 1;
    document.getElementById('seedInput').value = seed;
    const noise1 = new PerlinNoise(seed);
    const noise2 = new PerlinNoise(seed + 9999);
    const noise3 = new PerlinNoise(seed + 54321);

    heightMap = [];
    moistMap = [];
    latMap = [];
    for (let y = 0; y < ROWS; y++) {
        heightMap[y] = [];
        moistMap[y] = [];
        latMap[y] = [];
        for (let x = 0; x < COLS; x++) {
            const h = noise1.octaveNoise(x * 0.007, y * 0.007, 5, 0.55);
            const m = noise2.octaveNoise(x * 0.018, y * 0.018, 4, 0.5);
            heightMap[y][x] = Math.max(0, Math.min(1, h));
            moistMap[y][x] = Math.max(0, Math.min(1, m));

            const distFromEquator = Math.abs(y - ROWS / 2) / (ROWS / 2);
            const warp = noise3.octaveNoise(x * 0.01, y * 0.01, 3, 0.5) * 0.35 - 0.175;
            const lat = Math.max(0, Math.min(1, 1 - distFromEquator + warp));
            latMap[y][x] = lat;
        }
    }
    lightMap = [];
    for (let y = 0; y < ROWS; y++) {
        lightMap[y] = [];
        for (let x = 0; x < COLS; x++) {
            let dx = 0, dy = 0;
            if (x > 0 && x < COLS - 1) dx = (heightMap[y][x + 1] - heightMap[y][x - 1]) * 0.5;
            if (y > 0 && y < ROWS - 1) dy = (heightMap[y + 1][x] - heightMap[y - 1][x]) * 0.5;
            lightMap[y][x] = Math.max(0.4, Math.min(1.7, 1.0 + (dx + dy) * 0.35));
        }
    }
    render();
    generateBorders();
    render();
}

function generateBorders() {
    _mapDirty = true;
    rngState = (seed + 777) >>> 0 || 1;

    const provCount = parseInt(document.getElementById('provCount').value);
    const countryCount = parseInt(document.getElementById('countryCount').value);
    const terrainFit = parseInt(document.getElementById('terrainFit').value) / 100;

    const compOf = new Int32Array(COLS * ROWS).fill(-1);
    const components = [];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (heightMap[y][x] <= 0.5 || compOf[idxOf(x, y)] !== -1) continue;
            const compId = components.length;
            const cells = [];
            const stack = [[x, y]];
            compOf[idxOf(x, y)] = compId;
            while (stack.length) {
                const [cx, cy] = stack.pop();
                cells.push([cx, cy]);
                for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                    const nx = cx + ddx, ny = cy + ddy;
                    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                    if (heightMap[ny][nx] <= 0.5) continue;
                    const nIdx = idxOf(nx, ny);
                    if (compOf[nIdx] !== -1) continue;
                    compOf[nIdx] = compId;
                    stack.push([nx, ny]);
                }
            }
            components.push({ cells });
        }
    }
    if (components.length === 0) {
        provinceMap = null; countryMap = null;
        return;
    }
    const significantComps = components.filter(c => c.cells.length >= 6);
    const usableComps = significantComps.length > 0 ? significantComps : components;
    const totalLand = usableComps.reduce((s, c) => s + c.cells.length, 0);

    const seeds = [];
    const compQuota = usableComps.map(c => Math.max(1, Math.round((c.cells.length / totalLand) * provCount)));
    let quotaSum = compQuota.reduce((a, b) => a + b, 0);
    while (quotaSum > provCount) {
        const maxI = compQuota.indexOf(Math.max(...compQuota));
        if (compQuota[maxI] <= 1) break;
        compQuota[maxI]--; quotaSum--;
    }
    while (quotaSum < provCount) {
        const maxI = usableComps.reduce((best, c, i) => c.cells.length > usableComps[best].cells.length ? i : best, 0);
        compQuota[maxI]++; quotaSum++;
    }

    usableComps.forEach((comp, ci) => {
        const quota = compQuota[ci];
        const cells = comp.cells;
        const minDist = Math.sqrt(cells.length / Math.max(1, quota)) * 0.6;
        const localSeeds = [];
        let attempts = 0;
        while (localSeeds.length < quota && attempts < quota * 80) {
            attempts++;
            const cand = cells[(seededRandom() * cells.length) | 0];
            let ok = true;
            for (const s of localSeeds) {
                const dx = s[0] - cand[0], dy = s[1] - cand[1];
                if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
            }
            if (ok) localSeeds.push(cand);
        }
        while (localSeeds.length < quota) {
            localSeeds.push(cells[(seededRandom() * cells.length) | 0]);
        }
        seeds.push(...localSeeds);
    });

    const NPROV = seeds.length;
    provinceOf = new Int16Array(COLS * ROWS).fill(-1);
    const dist = new Float32Array(COLS * ROWS).fill(Infinity);

    const buckets = [];
    function pushBucket(cost, x, y) {
        const b = Math.max(0, Math.min(2000, cost | 0));
        if (!buckets[b]) buckets[b] = [];
        buckets[b].push([x, y]);
    }
    for (let i = 0; i < NPROV; i++) {
        const [sx, sy] = seeds[i];
        const idx = sy * COLS + sx;
        dist[idx] = 0;
        provinceOf[idx] = i;
        pushBucket(0, sx, sy);
    }

    for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b];
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
            const [cx, cy] = bucket[k];
            const curIdx = cy * COLS + cx;
            if (dist[curIdx] < b) continue;
            const curProv = provinceOf[curIdx];
            for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = cx + ddx, ny = cy + ddy;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                if (heightMap[ny][nx] <= 0.5) continue;
                const nIdx = ny * COLS + nx;
                const heightDiff = Math.abs(heightMap[ny][nx] - heightMap[cy][cx]);
                const cost = 1 + heightDiff * 6 * terrainFit;
                const nd = dist[curIdx] + cost;
                if (nd < dist[nIdx]) {
                    dist[nIdx] = nd;
                    provinceOf[nIdx] = curProv;
                    pushBucket(nd, nx, ny);
                }
            }
        }
    }

    provinceList = [];
    for (let i = 0; i < NPROV; i++) provinceList.push({ id: i, cells: 0, sumX: 0, sumY: 0, neighbors: new Set() });
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const p = provinceOf[idxOf(x, y)];
            if (p < 0) continue;
            const pr = provinceList[p];
            pr.cells++; pr.sumX += x; pr.sumY += y;
            if (x < COLS - 1) {
                const pr2 = provinceOf[idxOf(x + 1, y)];
                if (pr2 >= 0 && pr2 !== p) { pr.neighbors.add(pr2); provinceList[pr2].neighbors.add(p); }
            }
            if (y < ROWS - 1) {
                const pr2 = provinceOf[idxOf(x, y + 1)];
                if (pr2 >= 0 && pr2 !== p) { pr.neighbors.add(pr2); provinceList[pr2].neighbors.add(p); }
            }
        }
    }
    for (const pr of provinceList) {
        pr.cx = pr.cells ? pr.sumX / pr.cells : 0;
        pr.cy = pr.cells ? pr.sumY / pr.cells : 0;
    }

    const nCountries = Math.max(1, Math.min(countryCount, Math.floor(NPROV / 4)));
    const provIndices = provinceList.filter(p => p.cells > 0).map(p => p.id);
    for (let i = provIndices.length - 1; i > 0; i--) {
        const j = (seededRandom() * (i + 1)) | 0;
        [provIndices[i], provIndices[j]] = [provIndices[j], provIndices[i]];
    }
    const capitals = provIndices.slice(0, nCountries);
    const countryOfProv = new Int16Array(NPROV).fill(-1);
    countryList = capitals.map((pid, i) => ({ id: i, capital: pid, provinces: [pid] }));
    capitals.forEach((pid, i) => countryOfProv[pid] = i);

    function provinceValue(pid) {
        const p = provinceList[pid];
        if (!p || p.cells <= 0) return 0;
        if (p._value) return p._value;
        const cy = p.cy | 0, cx = p.cx | 0;
        const biome = getBiomeName(heightMap[cy][cx], moistMap[cy][cx], latMap[cy][cx]);
        const growth = typeof BIOME_GROWTH !== 'undefined' ? (BIOME_GROWTH[biome] || 0.8) : 0.8;
        const infra = typeof BIOME_INFRA_CAP !== 'undefined' ? (BIOME_INFRA_CAP[biome] || 50) : 50;
        p._value = p.cells * growth * (infra / 50);
        return p._value;
    }

    const countryValue = new Float64Array(nCountries);
    for (let i = 0; i < nCountries; i++) {
        countryValue[i] = provinceValue(capitals[i]);
    }

    const frontiers = countryList.map(() => new Set());
    const frontierClaimed = new Set();
    for (let cid = 0; cid < nCountries; cid++) {
        for (const nb of provinceList[capitals[cid]].neighbors) {
            if (countryOfProv[nb] === -1 && !frontierClaimed.has(nb)) {
                frontiers[cid].add(nb);
                frontierClaimed.add(nb);
            }
        }
    }

    let assignedCount = nCountries;
    while (assignedCount < NPROV) {
        let bestCid = -1, bestVal = Infinity;
        for (let i = 0; i < nCountries; i++) {
            if (frontiers[i].size === 0) continue;
            if (countryValue[i] < bestVal) { bestVal = countryValue[i]; bestCid = i; }
        }
        if (bestCid < 0) break;

        let bestPid = -1, bestScore = -1;
        for (const nb of frontiers[bestCid]) {
            if (countryOfProv[nb] !== -1) { frontiers[bestCid].delete(nb); continue; }
            const v = provinceValue(nb);
            if (v > bestScore) { bestScore = v; bestPid = nb; }
        }
        if (bestPid < 0) break;

        countryOfProv[bestPid] = bestCid;
        countryList[bestCid].provinces.push(bestPid);
        countryValue[bestCid] += bestScore;
        assignedCount++;
        frontiers[bestCid].delete(bestPid);

        for (const nb of provinceList[bestPid].neighbors) {
            if (countryOfProv[nb] === -1) {
                frontiers[bestCid].add(nb);
                for (let i = 0; i < nCountries; i++) {
                    if (i !== bestCid) frontiers[i].delete(nb);
                }
            }
        }
    }
    for (const pr of provinceList) {
        if (pr.cells > 0 && countryOfProv[pr.id] === -1) {
            let best = -1, bestD = Infinity;
            for (const c of countryList) {
                const cp = provinceList[c.capital];
                const dx = cp.cx - pr.cx, dy = cp.cy - pr.cy;
                const d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; best = c.id; }
            }
            countryOfProv[pr.id] = best;
            countryList[best].provinces.push(pr.id);
        }
    }

    countryMap = new Int16Array(COLS * ROWS).fill(-1);
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const p = provinceOf[idxOf(x, y)];
            countryMap[idxOf(x, y)] = p >= 0 ? countryOfProv[p] : -1;
        }
    }

    calcTerritorialWaters();
    rebuildWaterRegions();
    cacheCoastalWaterAccess();

    _countryOfProv = new Int16Array(NPROV).fill(-1);
    for (const c of countryList) {
        for (const pid of c.provinces) _countryOfProv[pid] = c.id;
    }

    provinceMap = provinceOf;

    const NAME_SYLL_A = ['Ar', 'Bel', 'Cor', 'Dun', 'El', 'Fen', 'Gal', 'Hal', 'Is', 'Kar', 'Lor', 'Mor', 'Nor', 'Os', 'Pel', 'Rin', 'Sil', 'Tar', 'Ur', 'Val', 'Wyn', 'Zar'];
    const NAME_SYLL_B = ['an', 'or', 'eth', 'ia', 'ath', 'on', 'is', 'wen', 'ar', 'esh', 'oth', 'und', 'yn'];
    const NAME_SUFFIX = ['', '', '', 'ia', 'land', 'mark', 'stan', 'grad'];
    const usedNames = new Set();
    for (const c of countryList) {
        let name;
        let tries = 0;
        do {
            const a = NAME_SYLL_A[(seededRandom() * NAME_SYLL_A.length) | 0];
            const b = NAME_SYLL_B[(seededRandom() * NAME_SYLL_B.length) | 0];
            const suf = NAME_SUFFIX[(seededRandom() * NAME_SUFFIX.length) | 0];
            name = a + b + suf;
            tries++;
        } while (usedNames.has(name) && tries < 20);
        usedNames.add(name);
        c.name = name;
        const cp = provinceList[c.capital];
        c.labelX = cp.cx;
        c.labelY = cp.cy;
    }
}

function calcTerritorialWaters() {
    const SEA_BORDER_RADIUS = 14;
    const seaDist = new Int16Array(COLS * ROWS).fill(-1);
    let seaFrontier = [];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (heightMap[y][x] > 0.5) continue;
            for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = x + ddx, ny = y + ddy;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                if (heightMap[ny][nx] <= 0.5) continue;
                const c = countryMap[idxOf(nx, ny)];
                if (c < 0) continue;
                const idx = idxOf(x, y);
                if (seaDist[idx] === -1) {
                    seaDist[idx] = 0;
                    countryMap[idx] = c;
                    seaFrontier.push([x, y]);
                }
            }
        }
    }
    let depth = 0;
    while (seaFrontier.length && depth < SEA_BORDER_RADIUS) {
        depth++;
        const next = [];
        for (const [cx, cy] of seaFrontier) {
            const cIdx = idxOf(cx, cy);
            const c = countryMap[cIdx];
            for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = cx + ddx, ny = cy + ddy;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                if (heightMap[ny][nx] > 0.5) continue;
                const nIdx = idxOf(nx, ny);
                if (seaDist[nIdx] !== -1) continue;
                seaDist[nIdx] = depth;
                countryMap[nIdx] = c;
                next.push([nx, ny]);
            }
        }
        seaFrontier = next;
    }
}

function rebuildWaterRegions() {
    G.waterRegionOf = new Int32Array(COLS * ROWS).fill(-1);
    G.waterIsOcean = [];
    let rid = 0;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const idx = idxOf(x, y);
            if (heightMap[y][x] > 0.5) continue;
            if (G.waterRegionOf[idx] !== -1) continue;
            let touchesEdge = (x === 0 || y === 0 || x === COLS-1 || y === ROWS-1);
            G.waterRegionOf[idx] = rid;
            const q = [[x, y]];
            for (let qi = 0; qi < q.length; qi++) {
                const [cx, cy] = q[qi];
                for (const [dx, dy] of dirs) {
                    const nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
                    if (heightMap[ny][nx] > 0.5) continue;
                    const nIdx = idxOf(nx, ny);
                    if (G.waterRegionOf[nIdx] !== -1) continue;
                    G.waterRegionOf[nIdx] = rid;
                    if (nx === 0 || ny === 0 || nx === COLS-1 || ny === ROWS-1) touchesEdge = true;
                    q.push([nx, ny]);
                }
            }
            G.waterIsOcean[rid] = touchesEdge;
            rid++;
        }
    }
}

function cacheCoastalWaterAccess() {
    if (!provinceList || !provinceOf || !G.waterRegionOf) return;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const pr of provinceList) {
        pr.seaZones = new Set();
    }
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (heightMap[y][x] <= 0.5) continue;
            const pid = provinceOf[idxOf(x, y)];
            if (pid < 0) continue;
            for (const [dx, dy] of dirs) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
                if (heightMap[ny][nx] > 0.5) continue;
                const wIdx = idxOf(nx, ny);
                const regionId = G.waterRegionOf[wIdx];
                if (regionId >= 0) provinceList[pid].seaZones.add(regionId);
            }
        }
    }
    for (const pr of provinceList) {
        pr.isCoastal = pr.seaZones.size > 0;
    }
}

function refreshPortWater(port, pr) {
    if (!port) return;
    if (port.vx >= 0 && port.vy >= 0 && G.waterRegionOf && heightMap[port.vy] && heightMap[port.vy][port.vx] <= 0.5) {
        port.waterRegionId = G.waterRegionOf[idxOf(port.vx, port.vy)];
        return;
    }
    const pos = typeof findPortVisualPosition === 'function' ? findPortVisualPosition(pr) : null;
    if (pos) {
        port.vx = pos.vx;
        port.vy = pos.vy;
        if (G.waterRegionOf) port.waterRegionId = G.waterRegionOf[idxOf(port.vx, port.vy)];
    } else {
        port.waterRegionId = -1;
    }
}

function canSeaTravel(fromProv, toProv) {
    if (!fromProv || !toProv) return false;
    const port = fromProv.port;
    if (!port || !port.built) return false;
    let rid = port.waterRegionId != null ? port.waterRegionId : -1;
    if (rid < 0 && port.vx >= 0 && G.waterRegionOf && heightMap[port.vy] && heightMap[port.vy][port.vx] <= 0.5) {
        rid = G.waterRegionOf[idxOf(port.vx, port.vy)];
        port.waterRegionId = rid;
    }
    if (rid < 0) return false;
    return toProv.seaZones && toProv.seaZones.has(rid);
}

function rebuildCountryMap() {
    _mapDirty = true;
    countryMap = new Int16Array(COLS * ROWS).fill(-1);
    const countryOfProvLocal = new Int16Array(provinceList.length).fill(-1);
    for (const c of countryList) {
        for (const pid of c.provinces) countryOfProvLocal[pid] = c.id;
    }
    for (let i = 0; i < COLS * ROWS; i++) {
        const p = provinceOf[i];
        countryMap[i] = p >= 0 ? countryOfProvLocal[p] : -1;
    }
    _countryOfProv = countryOfProvLocal;
    calcTerritorialWaters();
    provinceMap = provinceOf;
    if (typeof rebuildPlayerProvinceSet === 'function') rebuildPlayerProvinceSet();
}

function getProvinceBiome(pid) {
    const pr = provinceList[pid];
    if (pr && pr.biome) return pr.biome;
    const counts = {};
    const idxs = pr && pr.cellIndices && pr.cellIndices.length > 0 ? pr.cellIndices : null;
    if (idxs) {
        for (const idx of idxs) {
            const y = (idx / COLS) | 0, x = idx % COLS;
            const b = getBiomeName(heightMap[y][x], moistMap[y][x], latMap[y][x]);
            if (b === 'water') continue;
            counts[b] = (counts[b] || 0) + 1;
        }
    } else {
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (provinceOf[idxOf(x, y)] !== pid) continue;
                const b = getBiomeName(heightMap[y][x], moistMap[y][x], latMap[y][x]);
                if (b === 'water') continue;
                counts[b] = (counts[b] || 0) + 1;
            }
        }
    }
    let best = 'unknown', max = 0;
    for (const b in counts) { if (counts[b] > max) { max = counts[b]; best = b; } }
    return best;
}

function exportMapState() {
    const provinces = provinceList.map(pr => ({
        id: pr.id,
        country: -1,
        cx: Math.round(pr.cx * 1000) / 1000,
        cy: Math.round(pr.cy * 1000) / 1000,
        cells: pr.cells,
        neighbors: [...pr.neighbors].sort((a, b) => a - b),
        biome: getProvinceBiome(pr.id),
        population: pr.population || pr.cells,
        infrastructure: pr.infrastructure || 50,
        army: pr.army || Math.max(10, Math.round(pr.cells / 50)),
        port: pr.port || { built: false, ships: 0, buildTimer: 0, vx: -1, vy: -1 },
        resources: {}
    }));
    for (const c of countryList) {
        for (const pid of c.provinces) {
            provinces[pid].country = c.id;
        }
    }
    const countries = countryList.map(c => ({
        id: c.id,
        name: c.name,
        capital: c.capital,
        provinces: [...c.provinces].sort((a, b) => a - b),
        treasury: c.treasury || 0,
        treasuryHistory: c.treasuryHistory || [c.treasury || 0],
        crisisTurns: c.crisisTurns || 0,
        relations: {}
    }));
    const round3 = arr => arr.map(row => row.map(v => Math.round(v * 1000) / 1000));
    const state = {
        version: CURRENT_SCHEMA_VERSION,
        seed,
        params: {
            provCount: parseInt(document.getElementById('provCount').value),
            countryCount: parseInt(document.getElementById('countryCount').value),
            terrainFit: parseInt(document.getElementById('terrainFit').value)
        },
        grid: { cols: COLS, rows: ROWS },
        heightMap: round3(heightMap),
        moistMap: round3(moistMap),
        latMap: round3(latMap),
        provinceOf: Array.from(provinceOf),
        provinces,
        countries
    };
    const json = JSON.stringify(state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `map_seed${seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showMapStatus('Exported!');
}

function validateMapState(state) {
    const errors = [];
    if (!state || typeof state !== 'object') return { valid: false, errors: ['Invalid JSON structure'] };
    if (state.version !== CURRENT_SCHEMA_VERSION) errors.push(`Unsupported version: ${state.version} (expected ${CURRENT_SCHEMA_VERSION})`);
    if (!Array.isArray(state.provinces)) errors.push('Missing provinces array');
    if (!Array.isArray(state.countries)) errors.push('Missing countries array');
    if (!state.provinceOf || !Array.isArray(state.provinceOf)) errors.push('Missing provinceOf array');
    if (!state.heightMap || !Array.isArray(state.heightMap)) errors.push('Missing heightMap');
    if (!state.grid) errors.push('Missing grid info');
    if (errors.length > 0) return { valid: false, errors };
    const countryIds = new Set(state.countries.map(c => c.id));
    for (const p of state.provinces) {
        if (p.country < 0 || !countryIds.has(p.country)) {
            errors.push(`Province ${p.id}: invalid country ${p.country}`);
        }
    }
    for (const c of state.countries) {
        if (state.provinces[c.capital] === undefined) {
            errors.push(`Country ${c.id}: capital province ${c.capital} not found`);
        }
    }
    for (const p of state.provinces) {
        for (const nb of p.neighbors) {
            const nbProv = state.provinces[nb];
            if (!nbProv) { errors.push(`Province ${p.id}: neighbor ${nb} not found`); continue; }
            if (!nbProv.neighbors.includes(p.id)) {
                errors.push(`Asymmetric neighbors: ${p.id} -> ${nb} but ${nb} does not list ${p.id}`);
            }
        }
    }
    const expectedSize = state.grid.cols * state.grid.rows;
    if (state.provinceOf.length !== expectedSize) {
        errors.push(`provinceOf size mismatch: ${state.provinceOf.length} vs ${expectedSize}`);
    }
    for (let i = 0; i < state.provinceOf.length; i++) {
        const pid = state.provinceOf[i];
        if (pid < 0) continue;
        if (state.provinces[pid] === undefined) {
            errors.push(`provinceOf[${i}] references nonexistent province ${pid}`);
            if (errors.length > 20) { errors.push('... (truncated)'); break; }
        }
    }
    return { valid: errors.length === 0, errors };
}

function importMapState(jsonString) {
    let state;
    try { state = JSON.parse(jsonString); } catch(e) {
        showMapStatus('Import failed: invalid JSON');
        return false;
    }
    const check = validateMapState(state);
    if (!check.valid) {
        showMapStatus('Import failed: ' + check.errors[0]);
        console.error('Validation errors:', check.errors);
        return false;
    }
    seed = state.seed;
    document.getElementById('seedInput').value = seed;
    COLS = state.grid.cols;
    ROWS = state.grid.rows;
    document.getElementById('mapWidth').value = COLS;
    document.getElementById('mapWidthVal').textContent = COLS;
    document.getElementById('mapHeight').value = ROWS;
    document.getElementById('mapHeightVal').textContent = ROWS;
    const totalCells = COLS * ROWS;
    const maxProv = Math.max(20, Math.min(300, Math.floor(totalCells / 200)));
    document.getElementById('provCount').max = maxProv;
    if (parseInt(document.getElementById('provCount').value) > maxProv) {
        document.getElementById('provCount').value = maxProv;
        document.getElementById('provCountVal').textContent = maxProv;
    }
    heightMap = state.heightMap;
    moistMap = state.moistMap;
    latMap = state.latMap;
    document.getElementById('provCount').value = state.params.provCount;
    document.getElementById('provCountVal').textContent = state.params.provCount;
    document.getElementById('countryCount').value = state.params.countryCount;
    document.getElementById('countryCountVal').textContent = state.params.countryCount;
    document.getElementById('terrainFit').value = state.params.terrainFit;
    document.getElementById('terrainFitVal').textContent = state.params.terrainFit;
    provinceOf = new Int16Array(state.provinceOf);
    const importedProvinces = state.provinces.map(p => {
        const port = p.port || { built: false, ships: 0, buildTimer: 0, vx: -1, vy: -1 };
        return { ...p, port };
    });
    provinceList = importedProvinces.map(p => ({
        id: p.id,
        cells: p.cells,
        sumX: p.cx * p.cells,
        sumY: p.cy * p.cells,
        cx: p.cx,
        cy: p.cy,
        neighbors: new Set(p.neighbors),
        population: p.population || Math.max(10, Math.round(p.cells * 2)),
        infrastructure: p.infrastructure || 50,
        army: p.army || Math.max(10, Math.round(p.cells / 50)),
        port: p.port,
        biome: p.biome || getBiomeName(heightMap[p.cy | 0][p.cx | 0], moistMap[p.cy | 0][p.cx | 0], latMap[p.cy | 0][p.cx | 0])
    }));
    cacheCoastalProvinces();
    for (const p of importedProvinces) {
        const pr = provinceList.find(pl => pl.id === p.id);
        if (pr && pr.port && pr.port.built) {
            refreshPortWater(pr.port, pr);
        }
    }
    countryList = state.countries.map(c => ({
        id: c.id,
        name: c.name,
        capital: c.capital,
        provinces: [...c.provinces],
        labelX: provinceList[c.capital].cx,
        labelY: provinceList[c.capital].cy,
        treasury: c.treasury || 0,
        treasuryHistory: c.treasuryHistory || [c.treasury || 0],
        crisisTurns: c.crisisTurns || 0
    }));
    rebuildCountryMap();
    rebuildWaterRegions();
    cacheCoastalWaterAccess();
    lightMap = [];
    for (let y = 0; y < ROWS; y++) {
        lightMap[y] = [];
        for (let x = 0; x < COLS; x++) {
            let dx = 0, dy = 0;
            if (x > 0 && x < COLS - 1) dx = (heightMap[y][x + 1] - heightMap[y][x - 1]) * 0.5;
            if (y > 0 && y < ROWS - 1) dy = (heightMap[y + 1][x] - heightMap[y - 1][x]) * 0.5;
            lightMap[y][x] = Math.max(0.4, Math.min(1.7, 1.0 + (dx + dy) * 0.35));
        }
    }
    setCanvasSize();
    render();
    showMapStatus('Imported!');
    if (typeof initLlmPanel === 'function') initLlmPanel();
    return true;
}

function showMapStatus(msg) {
    const el = document.getElementById('mapStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = 1;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = 0; }, 2000);
}

let _cachedImgData = null;
let _baseCanvas = null;
let _baseCtx = null;

// Offscreen-canvas для базового слоя (ландшафт + границы). Кэш пересоздаётся
// при изменении размера карты; инвалидация — через _mapDirty.
function ensureBaseCanvas() {
    const w = canvas.width, h = canvas.height;
    if (!_baseCanvas || _baseCanvas.width !== w || _baseCanvas.height !== h) {
        if (typeof document !== 'undefined' && document.createElement) {
            try {
                _baseCanvas = document.createElement('canvas');
                _baseCanvas.width = w;
                _baseCanvas.height = h;
                _baseCtx = _baseCanvas.getContext ? _baseCanvas.getContext('2d') : null;
            } catch (e) {
                _baseCanvas = null;
                _baseCtx = null;
            }
        } else {
            _baseCanvas = null;
            _baseCtx = null;
        }
    }
    return _baseCtx;
}

function renderBaseTo(bctx) {
    const ps = pixelSize;
    const w = canvas.width, hc = canvas.height;
    if (!lightMap || lightMap.length !== ROWS) {
        lightMap = [];
        for (let y = 0; y < ROWS; y++) {
            lightMap[y] = [];
            for (let x = 0; x < COLS; x++) {
                let dx = 0, dy = 0;
                if (x > 0 && x < COLS - 1) dx = (heightMap[y][x + 1] - heightMap[y][x - 1]) * 0.5;
                if (y > 0 && y < ROWS - 1) dy = (heightMap[y + 1][x] - heightMap[y - 1][x]) * 0.5;
                lightMap[y][x] = Math.max(0.4, Math.min(1.7, 1.0 + (dx + dy) * 0.35));
            }
        }
    }
    const imgData = bctx.createImageData(w, hc);
    const data = imgData.data;

    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const h = heightMap[y][x];
            const m = moistMap[y][x];
            const lat = latMap[y][x];
            const light = lightMap[y][x];

            let col = getBiomeColor(h, m, lat);
            const r0 = col[0] * light, g0 = col[1] * light, b0 = col[2] * light;

            const px = x * ps, py = y * ps;

            for (let py0 = 0; py0 < ps; py0++) {
                const row = py + py0;
                for (let px0 = 0; px0 < ps; px0++) {
                    const isLastX = px0 === ps - 1;
                    const isLastY = py0 === ps - 1;
                    let r = r0, g = g0, b = b0;
                    if (isLastX || isLastY) {
                        const f = isLastX && isLastY ? 0.55 : 0.70;
                        r *= f; g *= f; b *= f;
                    }
                    const idx = ((row) * w + (px + px0)) * 4;
                    data[idx] = Math.min(255, Math.max(0, r)) | 0;
                    data[idx + 1] = Math.min(255, Math.max(0, g)) | 0;
                    data[idx + 2] = Math.min(255, Math.max(0, b)) | 0;
                    data[idx + 3] = 255;
                }
            }
        }
    }
    bctx.putImageData(imgData, 0, 0);
    drawBorders(bctx);
}

function render() {
    // Базовый слой (650 тыс. пикселей + 4 прохода границ) рисуем только при
    // изменениях; каждый кадр — быстрый drawImage + оверлеи.
    if (_mapDirty) {
        const bctx = ensureBaseCanvas();
        if (bctx) renderBaseTo(bctx);
        else renderBaseTo(ctx); // fallback: нет DOM/канваса (тесты) — рисуем напрямую
        _mapDirty = false;
    }
    if (_baseCtx) {
        try {
            ctx.drawImage(_baseCanvas, 0, 0);
        } catch (e) {
            renderBaseTo(ctx);
        }
    } else {
        renderBaseTo(ctx);
    }
    _mapRenderedOnce = true;
    document.getElementById('coord').textContent = '\u25c7';
    document.getElementById('elev').textContent = '';
}

const COUNTRY_COLORS = [
    [235, 90, 90],   [90, 150, 235],  [235, 195, 60],  [100, 210, 130],
    [200, 110, 220], [235, 150, 70],  [80, 210, 210],  [225, 90, 160],
    [160, 210, 80],  [130, 130, 235], [235, 170, 190], [90, 180, 110],
];

function drawBorders(targetCtx) {
    const g = targetCtx || ctx;
    if (!provinceMap || provinceMap.length !== COLS * ROWS) return;
    const showProv = document.getElementById('showProvinces').checked;
    const showCountry = document.getElementById('showCountries').checked && !!countryMap && countryMap.length === COLS * ROWS;
    if (!showProv && !showCountry) return;

    const ps = pixelSize;
    function idxOf(x, y) { return y * COLS + x; }

    if (showCountry) {
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                const c = countryMap[idxOf(x, y)];
                if (c < 0) continue;
                const isLand = heightMap[y][x] > 0.5;
                const col = COUNTRY_COLORS[c % COUNTRY_COLORS.length];
                const alpha = isLand ? 0.30 : 0.15;
                g.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${alpha})`;
                g.fillRect(x * ps, y * ps, ps, ps);
            }
        }
    }

    if (showProv) {
        g.strokeStyle = 'rgba(10, 8, 20, 0.5)';
        g.lineWidth = 1;
        g.beginPath();
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                const p = provinceMap[idxOf(x, y)];
                if (p < 0) continue;
                if (x < COLS - 1 && provinceMap[idxOf(x + 1, y)] !== p && provinceMap[idxOf(x + 1, y)] >= 0) {
                    const gx = (x + 1) * ps;
                    g.moveTo(gx, y * ps);
                    g.lineTo(gx, (y + 1) * ps);
                }
                if (y < ROWS - 1 && provinceMap[idxOf(x, y + 1)] !== p && provinceMap[idxOf(x, y + 1)] >= 0) {
                    const gy = (y + 1) * ps;
                    g.moveTo(x * ps, gy);
                    g.lineTo((x + 1) * ps, gy);
                }
            }
        }
        g.stroke();
    }

    if (showCountry) {
        const segmentsByColor = new Map();
        function addSeg(colorIdx, x1, y1, x2, y2) {
            if (!segmentsByColor.has(colorIdx)) segmentsByColor.set(colorIdx, []);
            segmentsByColor.get(colorIdx).push([x1, y1, x2, y2]);
        }
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                const c = countryMap[idxOf(x, y)];
                if (c < 0) continue;
                const isLandHere = heightMap[y][x] > 0.5;
                if (x < COLS - 1) {
                    const c2 = countryMap[idxOf(x + 1, y)];
                    if (c2 >= 0 && c2 !== c) {
                        // Рисуем границу только если хотя бы одна сторона — суша
                        if (isLandHere || heightMap[y][x + 1] > 0.5) {
                            const owner = Math.min(c, c2) % COUNTRY_COLORS.length;
                            const gx = (x + 1) * ps;
                            addSeg(owner, gx, y * ps, gx, (y + 1) * ps);
                        }
                    }
                }
                if (y < ROWS - 1) {
                    const c2 = countryMap[idxOf(x, y + 1)];
                    if (c2 >= 0 && c2 !== c) {
                        if (isLandHere || heightMap[y + 1][x] > 0.5) {
                            const owner = Math.min(c, c2) % COUNTRY_COLORS.length;
                            const gy = (y + 1) * ps;
                            addSeg(owner, x * ps, gy, (x + 1) * ps, gy);
                        }
                    }
                }
            }
        }
        // lineWidth масштабируется с pixelSize — убираем жёсткий минимум 3px
        g.lineWidth = Math.max(1, Math.round(ps * 0.65));
        g.lineCap = 'square';
        for (const [colorIdx, segs] of segmentsByColor) {
            const col = COUNTRY_COLORS[colorIdx];
            g.strokeStyle = `rgb(${Math.min(255, col[0] + 15)}, ${Math.min(255, col[1] + 15)}, ${Math.min(255, col[2] + 15)})`;
            g.beginPath();
            for (const [x1, y1, x2, y2] of segs) {
                g.moveTo(x1, y1);
                g.lineTo(x2, y2);
            }
            g.stroke();
        }

        g.strokeStyle = 'rgba(15, 10, 20, 0.4)';
        g.lineWidth = 1;
        g.beginPath();
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                const c = countryMap[idxOf(x, y)];
                if (c < 0) continue;
                const isLandHere = heightMap[y][x] > 0.5;
                if (x < COLS - 1 && countryMap[idxOf(x + 1, y)] !== c && countryMap[idxOf(x + 1, y)] >= 0) {
                    if (isLandHere || heightMap[y][x + 1] > 0.5) {
                        const gx = (x + 1) * ps;
                        g.moveTo(gx, y * ps);
                        g.lineTo(gx, (y + 1) * ps);
                    }
                }
                if (y < ROWS - 1 && countryMap[idxOf(x, y + 1)] !== c && countryMap[idxOf(x, y + 1)] >= 0) {
                    if (isLandHere || heightMap[y + 1][x] > 0.5) {
                        const gy = (y + 1) * ps;
                        g.moveTo(x * ps, gy);
                        g.lineTo((x + 1) * ps, gy);
                    }
                }
            }
        }
        g.stroke();

        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const c of countryList) {
            if (!c.name || c.provinces.length === 0) continue;
            const lx = c.labelX * ps, ly = c.labelY * ps;
            const fontSize = Math.max(11, Math.min(17, ps * 2.8));
            g.font = `${fontSize}px 'Courier New', monospace`;
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(10, 8, 18, 0.75)';
            g.strokeText(c.name.toUpperCase(), lx, ly);
            const col = COUNTRY_COLORS[c.id % COUNTRY_COLORS.length];
            g.fillStyle = `rgb(${Math.min(255, col[0] + 40)}, ${Math.min(255, col[1] + 40)}, ${Math.min(255, col[2] + 40)})`;
            g.fillText(c.name.toUpperCase(), lx, ly);
        }
    }
}


