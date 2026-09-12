let _arrowTargets = [];
let _hoveredProvinceId = -1;

function drawArmyNumbers() {
    if (!provinceList) return;
    const ps = pixelSize;
    const fontSize = Math.max(9, Math.min(16, ps * 2.5));

    for (const pr of provinceList) {
        if (!pr.cells || pr.army === undefined || pr.army <= 0) continue;
        const x = pr.cx * ps, y = pr.cy * ps;

        // fmtNum (ui-controls.js) даёт компактные подписи: 1.2k, 15k, 1.2M.
        // Math.round убирает «кашу» из дробных значений, копящихся тик за тиком.
        const rawArmy = Math.round(pr.army);
        let label = typeof fmtNum === 'function' ? fmtNum(rawArmy) : rawArmy.toString();

        if (pr.port && pr.port.built && pr.port.buildTimer > 0) {
            label += '~';
        }

        ctx.font = `${fontSize}px 'Courier New', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const textW = ctx.measureText(label).width;

        const ownerId = findCountryOfProvince(pr.id);
        const oc = ownerId >= 0 ? COUNTRY_COLORS[ownerId % COUNTRY_COLORS.length] : [90, 90, 130];

        // small pennant/shield chip behind the number for legibility + ownership color
        const chipW = textW + fontSize * 2.0, chipH = fontSize * 1.3;
        const cx0 = x - chipW / 2, cy0 = y - chipH / 2 + 1;
        ctx.beginPath();
        const r = chipH * 0.35;
        ctx.moveTo(cx0 + r, cy0);
        ctx.lineTo(cx0 + chipW - r, cy0);
        ctx.quadraticCurveTo(cx0 + chipW, cy0, cx0 + chipW, cy0 + r);
        ctx.lineTo(cx0 + chipW, cy0 + chipH - r);
        ctx.quadraticCurveTo(cx0 + chipW, cy0 + chipH, cx0 + chipW - r, cy0 + chipH);
        ctx.lineTo(cx0 + r, cy0 + chipH);
        ctx.quadraticCurveTo(cx0, cy0 + chipH, cx0, cy0 + chipH - r);
        ctx.lineTo(cx0, cy0 + r);
        ctx.quadraticCurveTo(cx0, cy0, cx0 + r, cy0);
        ctx.closePath();
        ctx.fillStyle = `rgba(${oc[0]}, ${oc[1]}, ${oc[2]}, 0.28)`;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${oc[0]}, ${oc[1]}, ${oc[2]}, 0.6)`;
        ctx.stroke();

        // tiny crossed-swords glyph for provinces above a strength threshold
        if (pr.army >= 500) {
            const gs = fontSize * 0.6;
            const gx = cx0 - gs * 0.2, gy = y;
            ctx.strokeStyle = 'rgba(230,210,150,0.85)';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(gx - gs / 2, gy - gs / 2);
            ctx.lineTo(gx + gs / 2, gy + gs / 2);
            ctx.moveTo(gx + gs / 2, gy - gs / 2);
            ctx.lineTo(gx - gs / 2, gy + gs / 2);
            ctx.stroke();
        }

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(8, 6, 16, 0.85)';
        ctx.strokeText(label, x + 1, y + 1);
        ctx.fillStyle = '#e8ecf4';
        ctx.fillText(label, x + 1, y + 1);
    }
}

function drawCaptureAnimation() {
    if (!provinceList || G.captures.length === 0) return;
    const ps = pixelSize;
    const now = Date.now();
    const blink = (now % 400) < 200;

    for (const cap of G.captures) {
        if (!cap.isActive) continue;
        const targetProv = provinceList[cap.targetProvinceId];
        if (!targetProv || !targetProv.cellIndices) continue;

        const totalCells = cap.totalCells;
        const captured = Math.floor(cap.cellsCaptured);
        if (captured <= 0 || totalCells <= 0) continue;

        const attackerColor = COUNTRY_COLORS[cap.attackerCountryId % COUNTRY_COLORS.length];
        const defenderColor = COUNTRY_COLORS[cap.defenderCountryId % COUNTRY_COLORS.length];

        const cells = cap.sortedCellIndices || targetProv.cellIndices;
        const frontStart = Math.max(0, captured - Math.ceil(totalCells * 0.08));

        for (let i = 0; i < Math.min(captured, cells.length); i++) {
            const idx = cells[i];
            const x = idx % COLS, y = (idx / COLS) | 0;

            if (i >= frontStart && blink) {
                ctx.fillStyle = `rgba(${attackerColor[0]}, ${attackerColor[1]}, ${attackerColor[2]}, 0.7)`;
            } else {
                const t = captured > 0 ? (i / captured) : 0;
                const r = defenderColor[0] + (attackerColor[0] - defenderColor[0]) * t;
                const g = defenderColor[1] + (attackerColor[1] - defenderColor[1]) * t;
                const b = defenderColor[2] + (attackerColor[2] - defenderColor[2]) * t;
                ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, 0.45)`;
            }
            ctx.fillRect(x * ps, y * ps, ps, ps);
        }

        if (targetProv.cx !== undefined) {
            const bx = targetProv.cx * ps, by = targetProv.cy * ps - ps * 2.2;
            const s = Math.max(6, ps * 1.1);
            const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 180);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = `rgb(${attackerColor[0]},${attackerColor[1]},${attackerColor[2]})`;
            ctx.lineWidth = Math.max(1.3, s * 0.18);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(bx - s / 2, by - s / 2); ctx.lineTo(bx + s / 2, by + s / 2);
            ctx.moveTo(bx + s / 2, by - s / 2); ctx.lineTo(bx - s / 2, by + s / 2);
            ctx.stroke();
            ctx.restore();
        }
    }
}

function drawProgressBars() {
    if (!provinceList) return;
    const ps = pixelSize;
    const barWidth = Math.max(20, ps * 4);
    const barHeight = Math.max(3, ps * 0.5);

    for (const cap of G.captures) {
        if (!cap.isActive) continue;
        const targetProv = provinceList[cap.targetProvinceId];
        if (!targetProv || !targetProv.cells) continue;

        const progress = cap.totalCells > 0 ? cap.cellsCaptured / cap.totalCells : 0;
        const bx = targetProv.cx * ps - barWidth / 2;
        const by = targetProv.cy * ps + ps * 0.8;

        ctx.fillStyle = 'rgba(8, 6, 16, 0.6)';
        ctx.fillRect(bx, by, barWidth, barHeight);

        const color = COUNTRY_COLORS[cap.attackerCountryId % COUNTRY_COLORS.length];
        ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`;
        ctx.fillRect(bx, by, barWidth * Math.min(1, progress), barHeight);
    }
}

function drawArrows(fromProvinceId) {
    if (fromProvinceId == null) return;
    const fromProv = provinceList[fromProvinceId];
    if (!fromProv || !fromProv.cx) return;
    const ps = pixelSize;

    _arrowTargets = [];
    const isPlayerProv = isOwnProvince(fromProv);

    function drawArrowTo(toProv, color, isSea, fromXOverride, fromYOverride) {
        const x1 = (fromXOverride != null ? fromXOverride : fromProv.cx) * ps;
        const y1 = (fromYOverride != null ? fromYOverride : fromProv.cy) * ps;
        const x2 = toProv.cx * ps, y2 = toProv.cy * ps;

        const dx = x2 - x1, dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 5) return;

        const cpx = (x1 + x2) / 2 + dy * 0.15;
        const cpy = (y1 + y2) / 2 - dx * 0.15;

        ctx.strokeStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.7)';
        ctx.lineWidth = Math.max(2.5, ps * 0.5);
        if (isSea) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cpx, cpy, x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        const t = 0.85;
        const ax = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cpx + t * t * x2;
        const ay = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cpy + t * t * y2;

        const angle = Math.atan2(y2 - cpy, x2 - cpx);
        const arrowSize = Math.max(6, ps * 1.1);
        ctx.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.8)';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - arrowSize * Math.cos(angle - 0.4), ay - arrowSize * Math.sin(angle - 0.4));
        ctx.lineTo(ax - arrowSize * Math.cos(angle + 0.4), ay - arrowSize * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
    }

    for (const nbId of fromProv.neighbors) {
        const toProv = provinceList[nbId];
        if (!toProv || !toProv.cells) continue;

        const isEnemy = isPlayerProv && !isOwnProvince(toProv);
        const isFriendly = isPlayerProv && isOwnProvince(toProv);
        if (!isPlayerProv) {
            const myCountry = findCountryOfProvince(fromProv.id);
            const theirCountry = findCountryOfProvince(toProv.id);
            if (myCountry < 0 || theirCountry < 0) continue;
            if (myCountry === theirCountry) continue;
        }
        if (!isEnemy && !isFriendly) continue;

        _arrowTargets.push(nbId);
        const color = isEnemy ? [235, 80, 80] : [80, 200, 100];
        drawArrowTo(toProv, color, false);
    }

    const fromPort = fromProv.port;
    const idleShipCount = G.ships.filter(s => s.portProvinceId === fromProv.id && s.state === 'idle').length;
    if (isPlayerProv && fromPort && fromPort.built && idleShipCount > 0) {
        const fx = fromPort.vx >= 0 ? fromPort.vx + 0.5 : null;
        const fy = fromPort.vy >= 0 ? fromPort.vy + 0.5 : null;
        for (const pr of provinceList) {
            if (pr.id === fromProv.id || !pr.cells || !pr.isCoastal) continue;
            if (!canSeaTravel(fromProv, pr)) continue;

            _arrowTargets.push(pr.id);
            // Все чужие прибрежные провинции — потенциальные цели десанта (красные),
            // свои — синие. «Нейтральных» морских целей не бывает: провинция всегда чья-то.
            const isEnemy = !isOwnProvince(pr);
            const color = isEnemy ? [235, 80, 80] : [60, 140, 230];
            drawArrowTo(pr, color, true, fx, fy);
        }
    }
}

function hideArrows() {
    _arrowTargets = [];
}

function drawSelectionHighlight() {
    if (G.selectedProvinceId == null) return;
    const pr = provinceList[G.selectedProvinceId];
    if (!pr || !pr.cx) return;
    const ps = pixelSize;

    const x = pr.cx * ps, y = pr.cy * ps;
    const radius = Math.max(8, ps * 1.5);
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 260);

    ctx.strokeStyle = `rgba(255, 240, 180, ${0.55 + 0.35 * pulse})`;
    ctx.lineWidth = Math.max(2, ps * 0.4);
    ctx.beginPath();
    ctx.arc(x, y, radius + pulse * 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // small corner ticks for a "targeting reticle" feel
    const tick = radius * 0.55;
    ctx.lineWidth = Math.max(1.5, ps * 0.3);
    ctx.strokeStyle = 'rgba(255, 240, 180, 0.9)';
    for (const [ax, ay] of [[1,-1],[1,1],[-1,-1],[-1,1]]) {
        const bx = x + ax * (radius + 3), by = y + ay * (radius + 3);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - ax * tick * 0.5, by);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx, by - ay * tick * 0.5);
        ctx.stroke();
    }
}

function drawAnchorIcon(cx, cy, size, color) {
    const r = size * 0.22;
    ctx.save();
    ctx.strokeStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.lineWidth = Math.max(1, size * 0.14);
    ctx.lineCap = 'round';

    // ring
    ctx.beginPath();
    ctx.arc(cx, cy - size * 0.42, r, 0, Math.PI * 2);
    ctx.stroke();

    // shaft
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.22);
    ctx.lineTo(cx, cy + size * 0.42);
    ctx.stroke();

    // crossbar
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.28, cy - size * 0.02);
    ctx.lineTo(cx + size * 0.28, cy - size * 0.02);
    ctx.stroke();

    // flukes (curved arms)
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.42);
    ctx.quadraticCurveTo(cx - size * 0.5, cy + size * 0.42, cx - size * 0.42, cy + size * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.42);
    ctx.quadraticCurveTo(cx + size * 0.5, cy + size * 0.42, cx + size * 0.42, cy + size * 0.12);
    ctx.stroke();

    ctx.restore();
}

function drawPorts() {
    if (!provinceList) return;
    const ps = pixelSize;
    const size = Math.max(9, ps * 2.6);
    for (const pr of provinceList) {
        if (!pr.port || !pr.port.built || pr.port.vx === undefined || pr.port.vy === undefined) continue;
        const x = pr.port.vx * ps + ps / 2;
        const y = pr.port.vy * ps + ps / 2;
        const countryId = findCountryOfProvince(pr.id);
        if (countryId < 0) continue;
        const color = COUNTRY_COLORS[countryId % COUNTRY_COLORS.length];

        // soft backing disc so the anchor reads against any terrain
        ctx.beginPath();
        ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10, 14, 24, 0.55)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.55)`;
        ctx.stroke();

        drawAnchorIcon(x, y, size, color);

        if (pr.port.buildTimer > 0) {
            // under-construction: dashed ring
            ctx.beginPath();
            ctx.setLineDash([2, 2]);
            ctx.strokeStyle = 'rgba(230, 200, 120, 0.8)';
            ctx.lineWidth = 1;
            ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (pr.port.ships > 0) {
            const maxDots = Math.min(pr.port.ships, G.params.maxShipsPerPort);
            const dotR = Math.max(1.2, size * 0.09);
            for (let i = 0; i < maxDots; i++) {
                const angle = (-Math.PI / 2) + (i / 6) * Math.PI * 2;
                const dx = x + Math.cos(angle) * size * 0.85;
                const dy = y + Math.sin(angle) * size * 0.85;
                ctx.beginPath();
                ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
                ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
                ctx.fill();
            }
        }
    }
}

function drawShipIcon(x, y, angle, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const bob = Math.sin(Date.now() / 450 + x * 0.1 + y * 0.1) * size * 0.08;
    ctx.translate(0, bob);

    ctx.beginPath();
    ctx.moveTo(-size * 0.55, size * 0.15);
    ctx.quadraticCurveTo(0, size * 0.4, size * 0.55, size * 0.15);
    ctx.lineTo(size * 0.4, -size * 0.08);
    ctx.lineTo(-size * 0.4, -size * 0.08);
    ctx.closePath();
    ctx.fillStyle = '#5a4632';
    ctx.fill();
    ctx.strokeStyle = '#3a2e20';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -size * 0.08);
    ctx.lineTo(0, -size * 0.65);
    ctx.lineTo(size * 0.4, -size * 0.12);
    ctx.closePath();
    ctx.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.9)';
    ctx.fill();

    ctx.strokeStyle = '#3a2e20';
    ctx.lineWidth = Math.max(1.5, size * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.65);
    ctx.lineTo(0, size * 0.08);
    ctx.stroke();

    ctx.restore();
}

function drawFleetAnims() {
    if (!G.fleetAnims || G.fleetAnims.length === 0) return;
    const size = Math.max(14, pixelSize * 3.5);
    for (const anim of G.fleetAnims) {
        const pos = getAnimPosition(anim);
        if (!pos) continue;
        const color = COUNTRY_COLORS[anim.countryId % COUNTRY_COLORS.length];

        let angle = Math.PI / 2;
        if (anim.path && anim.path.length >= 2) {
            const t = Math.min(1, anim.progress + 0.05);
            const totalSegs = anim.path.length - 1;
            const nextIdx = Math.min(Math.floor(t * totalSegs), totalSegs - 1);
            const p0 = anim.path[nextIdx];
            const p1 = anim.path[Math.min(nextIdx + 1, anim.path.length - 1)];
            const dx = p1.x - p0.x, dy = p1.y - p0.y;
            if (dx !== 0 || dy !== 0) {
                angle = Math.atan2(dy, dx) + Math.PI / 2;
                if (anim.state === 'returning') angle += Math.PI;
            }
        }

        drawShipIcon(pos.x, pos.y, angle, size, color);

        if (anim.state === 'arrived') {
            ctx.globalAlpha = 0.35 + 0.5 * Math.sin(Date.now() / 150);
            ctx.strokeStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
}

function drawShips() {
    if (!G.ships || G.ships.length === 0) return;
    const size = Math.max(10, pixelSize * 2.5);
    for (const ship of G.ships) {
        if (ship.state === 'used') continue;
        const color = COUNTRY_COLORS[ship.ownerCid % COUNTRY_COLORS.length];
        let angle = 0;
        if (ship.state === 'sailing' && ship.path && ship.pathIndex < ship.path.length - 1) {
            const p0 = ship.path[ship.pathIndex];
            const p1 = ship.path[Math.min(ship.pathIndex + 1, ship.path.length - 1)];
            const dx = p1.x - p0.x, dy = p1.y - p0.y;
            angle = Math.atan2(dy, dx) + Math.PI / 2;
        }
        drawShipIcon(ship.x, ship.y, angle, size, color);
    }
}
