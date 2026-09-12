const BIOME_GROWTH = {
    meadow: 1.4,
    savanna: 1.2,
    plain: 1.1,
    jungle: 1.3,
    light_jungle: 1.2,
    dense_rainforest: 1.1,
    cloud_forest: 0.8,
    forest: 0.9,
    coniferous_forest: 0.7,
    dry_steppe: 0.6,
    semi_desert: 0.4,
    dunes: 0.3,
    dry_hills: 0.5,
    foothills: 0.6,
    rocky_slopes: 0.4,
    tundra: 0.3,
    sparse_taiga: 0.4,
    taiga: 0.6,
    alpine: 0.2
};

const BIOME_INFRA_CAP = {
    meadow: 90,
    savanna: 80,
    plain: 85,
    jungle: 65,
    light_jungle: 70,
    dense_rainforest: 55,
    cloud_forest: 50,
    forest: 70,
    coniferous_forest: 60,
    dry_steppe: 40,
    semi_desert: 30,
    dunes: 20,
    dry_hills: 45,
    foothills: 50,
    rocky_slopes: 35,
    tundra: 25,
    sparse_taiga: 30,
    taiga: 45,
    alpine: 15
};

const POP_CAP_PER_CELL = 8;

function processEconomyTurn() {
    for (const pr of provinceList) {
        if (pr.cells <= 0) continue;

        const biome = pr.biome || getBiomeName(heightMap[pr.cy | 0][pr.cx | 0], moistMap[pr.cy | 0][pr.cx | 0], latMap[pr.cy | 0][pr.cx | 0]);
        const foodMod = BIOME_GROWTH[biome] || 0.8;
        const growth = G.params.growthRate * foodMod;
        pr.population += pr.population * growth;
        pr.population = Math.min(pr.population, pr.cells * POP_CAP_PER_CELL);
        pr.population = Math.max(1, Math.round(pr.population));
    }

    for (const c of countryList) {
        if (c.provinces.length === 0) continue;

        let taxes = 0;
        let infraCost = 0;
        let armyCost = 0;
        let portCost = 0;

        for (const pid of c.provinces) {
            const pr = provinceList[pid];
            if (!pr || pr.cells <= 0) continue;
            taxes += pr.population * G.params.taxRate * (pr.infrastructure / 100);
            infraCost += pr.infrastructure * G.params.infraUpkeepRate;
            armyCost += pr.army * G.params.armyUpkeepRate;
            if (pr.port && pr.port.built) {
                portCost += G.params.portUpkeep;
                portCost += pr.port.ships * G.params.shipUpkeep;
            }
        }

        c.treasury += taxes - infraCost - armyCost - portCost;

        if (c.treasuryHistory) {
            c.treasuryHistory.push(c.treasury);
            if (c.treasuryHistory.length > 20) c.treasuryHistory.shift();
        }

        if (c.treasury < 0) {
            c.crisisTurns = (c.crisisTurns || 0) + 1;
            if (c.crisisTurns >= 3) {
                for (const pid of c.provinces) {
                    const pr = provinceList[pid];
                    if (pr && pr.cells > 0) {
                        pr.infrastructure = Math.max(0, pr.infrastructure - 1);
                    }
                }
            }
        } else {
            c.crisisTurns = 0;
        }

        if (c.crisisTurns === 3) {
            addGameLog(c.name + ': economic crisis!');
        }

        for (const pid of c.provinces) {
            const pr = provinceList[pid];
            if (!pr || pr.cells <= 0) continue;
            const biome = pr.biome || getBiomeName(heightMap[pr.cy | 0][pr.cx | 0], moistMap[pr.cy | 0][pr.cx | 0], latMap[pr.cy | 0][pr.cx | 0]);
            const cap = BIOME_INFRA_CAP[biome] || 50;
            if (c.treasury >= 0) {
                pr.infrastructure += (cap - pr.infrastructure) * 0.005;
            }
        }
    }
}
