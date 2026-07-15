/**
 * AI Worker - handles all AI decision making off the main thread
 * Runs even when browser tab is throttled
 */

import { Utils } from '../utils.js';
import { UNIT_DEFINITIONS, CITY_INCOME, TERRAIN } from '../constants.js';

let gameState = null;
let isProcessing = false;
let pendingInit = false;
let actionDelay = 100; // Delay between actions for visibility

// Action flow control
let pendingActions = [];

function sendAction(action) {
    self.postMessage({ type: 'action', action });
}

function waitForResult() {
    return new Promise(resolve => {
        pendingActions.push(resolve);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveNextAction() {
    if (pendingActions.length > 0) {
        pendingActions.shift()();
    }
}

self.onmessage = function(e) {
    const { type, data } = e.data;

    if (type === 'actionResult') {
        resolveNextAction();
    } else if (type === 'stateUpdate') {
        // Mid-turn state update - just refresh state, don't trigger new turn
        gameState = data;
    } else if (type === 'init') {
        // New turn - update state and start processing
        gameState = data;
        pendingInit = true;
        if (!isProcessing) {
            processTurn();
        }
    } else if (type === 'setSpeed') {
        actionDelay = Math.max(0, 2000 / data.speed);
    } else if (type === 'stop') {
        gameState = null;
    }
};

async function processTurn() {
    if (isProcessing) return;
    isProcessing = true;
    pendingInit = false;

    try {
        const player = gameState?.players[gameState.currentPlayerIndex];
        if (!player || !player.isAI || !player.isAlive) {
            isProcessing = false;
            return;
        }

        await handleUnitActions(player);
        await handleHeroActions(player);
        await handleProduction(player);

        // Signal end of AI turn - main thread will advance to next player
        sendAction({ type: 'endTurn' });
        await waitForResult();
    } catch (err) {
        console.error('AI Worker error:', err);
        // Try to end turn even on error
        sendAction({ type: 'endTurn' });
        await waitForResult();
    }

    isProcessing = false;

    // If a new init arrived while we were processing, start next turn
    if (pendingInit) {
        pendingInit = false;
        processTurn();
    }
}

async function handleUnitActions(player) {
    const units = gameState.units
        .filter(u => u.owner === player.id && u.hp > 0 && !u.isHero)
        .sort((a, b) => getUnitPriority(b) - getUnitPriority(a));

    for (const unit of units) {
        if (unit.hasMoved && unit.hasAttacked) continue;

        await executeUnitActions(unit, player);
    }
}

function getUnitPriority(unit) {
    const def = UNIT_DEFINITIONS[unit.type];
    let p = def.attack + def.defense + def.hp / 10;
    if (def.range > 1) p += 50;
    if (def.movement >= 4) p += 30;
    if (def.movement >= 3) p += 15;
    if (gameState.turnNumber <= 5 && def.movement >= 3) p += 25;
    p -= (1 - unit.hp / def.hp) * 30;
    return p;
}

async function executeUnitActions(unit, player) {
    const def = UNIT_DEFINITIONS[unit.type];
    const isRanged = def.range > 1;

    // Check for attack from current position
    const attackTarget = findBestAttack(unit);
    if (attackTarget && !unit.hasAttacked) {
        const dist = Utils.chebyshevDistance(unit.x, unit.y, attackTarget.x, attackTarget.y);
        const ranged = dist > 1;
        sendAction({
            type: 'attack',
            unitId: unit.id,
            targetX: attackTarget.x,
            targetY: attackTarget.y,
            isRanged: ranged
        });
        await waitForResult();
        await delay(actionDelay);

        if (isRanged && !unit.hasMoved) {
            const kitePos = findKitePosition(unit, attackTarget);
            if (kitePos) {
                sendAction({ type: 'move', unitId: unit.id, toX: kitePos.x, toY: kitePos.y });
                await waitForResult();
                await delay(actionDelay);
            }
        }
        return;
    }

    // Move if can
    if (!unit.hasMoved) {
        const moveTarget = findBestMove(unit, player);
        if (moveTarget) {
            sendAction({ type: 'move', unitId: unit.id, toX: moveTarget.x, toY: moveTarget.y });
            await waitForResult();
            await delay(actionDelay);

            // Re-check attacks after move
            const movedUnit = findUnit(unit.id);
            if (movedUnit && !movedUnit.hasAttacked) {
                const newTarget = findBestAttack(movedUnit);
                if (newTarget) {
                    const dist = Utils.chebyshevDistance(movedUnit.x, movedUnit.y, newTarget.x, newTarget.y);
                    sendAction({
                        type: 'attack',
                        unitId: movedUnit.id,
                        targetX: newTarget.x,
                        targetY: newTarget.y,
                        isRanged: dist > 1
                    });
                    await waitForResult();
                    await delay(actionDelay);
                }
            }
        }
    }
}

function findBestAttack(unit) {
    const def = UNIT_DEFINITIONS[unit.type];
    let best = null;
    let bestScore = -Infinity;

    for (const target of getAttackTargets(unit)) {
        const enemy = getStack(target.x, target.y);
        if (!enemy) continue;
        const score = evaluateTarget(unit, enemy, target.x, target.y);
        if (score > bestScore) {
            bestScore = score;
            best = target;
        }
    }

    return bestScore > 0 ? best : null;
}

function getAttackTargets(unit) {
    const def = UNIT_DEFINITIONS[unit.type];
    const targets = [];

    for (let dy = -def.range; dy <= def.range; dy++) {
        for (let dx = -def.range; dx <= def.range; dx++) {
            const x = unit.x + dx;
            const y = unit.y + dy;
            if (x < 0 || x >= gameState.mapWidth || y < 0 || y >= gameState.mapHeight) continue;
            if (dx === 0 && dy === 0) continue;
            if (Utils.chebyshevDistance(unit.x, unit.y, x, y) > def.range) continue;
            if (gameState.units.some(u => u.x === x && u.y === y && u.owner !== unit.owner && u.hp > 0)) {
                targets.push({ x, y });
            }
        }
    }

    return targets;
}

function getStack(x, y) {
    const units = gameState.units.filter(u => u.x === x && u.y === y && u.hp > 0);
    if (units.length === 0) return null;
    return { units, owner: units[0].owner, getCombatUnit: () => units[0] };
}

function evaluateTarget(unit, enemyStack, x, y) {
    const enemy = enemyStack.getCombatUnit();
    if (!enemy) return -1000;

    const enemyDef = UNIT_DEFINITIONS[enemy.type];
    const myDef = UNIT_DEFINITIONS[unit.type];
    let score = 0;

    if (enemy.isHero) score += 100;
    if (enemy.type === 'CATAPULT') score += 50;
    if (enemy.type === 'DRAGON') score += 80;
    score += (1 - enemy.hp / enemyDef.hp) * 40;

    const dmg = calculateDamage(unit, enemy, getDefenseBonus(x, y));
    if (dmg >= enemy.hp) score += 100;
    score += Math.min(dmg, enemy.hp) * 1.5;

    const city = gameState.cities.find(c => c.x === x && c.y === y);
    if (city && city.owner !== unit.owner) {
        if (dmg >= enemy.hp) score += 100;
        if (enemyStack.owner !== null) {
            const enemyPlayer = gameState.players[enemyStack.owner];
            if (enemyPlayer && enemyPlayer.cities.length === 1) score += 300;
        }
    }

    const dist = Utils.chebyshevDistance(unit.x, unit.y, x, y);
    if (myDef.range > 1) {
        if (dist > 1) score += 25;
        else score -= 30;
    }

    return score;
}

function calculateDamage(attacker, defender, terrainBonus = 0) {
    const atkDef = UNIT_DEFINITIONS[attacker.type];
    const defDef = UNIT_DEFINITIONS[defender.type];
    const atkPower = atkDef.attack * (attacker.hp / atkDef.hp);
    const defPower = (defDef.defense + terrainBonus) * (defender.hp / defDef.hp);
    return Math.max(1, Math.floor(atkPower - defPower * 0.5));
}

function getDefenseBonus(x, y) {
    const t = gameState.terrain[y]?.[x];
    if (t === TERRAIN.MOUNTAINS) return 4;
    if (t === TERRAIN.FOREST) return 2;
    if (t === TERRAIN.HILLS) return 1;
    return 0;
}

function findKitePosition(unit, attackTarget) {
    const reachable = getReachable(unit);
    const valid = reachable.filter(t => !t.isEnemy && !hasFriendlyUnit(t.x, t.y, unit.owner));

    if (valid.length === 0) return null;

    const def = UNIT_DEFINITIONS[unit.type];
    let best = null;
    let bestScore = -Infinity;

    for (const tile of valid) {
        let score = Utils.chebyshevDistance(tile.x, tile.y, attackTarget.x, attackTarget.y) * 20;
        if (score <= def.range && score > 1) score += 30;
        score -= countAdjacentEnemies(tile.x, tile.y, unit.owner) * 50;
        if (gameState.terrain[tile.y]?.[tile.x] === TERRAIN.MOUNTAINS) score += 15;
        if (gameState.terrain[tile.y]?.[tile.x] === TERRAIN.FOREST) score += 8;

        if (score > bestScore) {
            bestScore = score;
            best = tile;
        }
    }

    return best;
}

function findBestMove(unit, player) {
    const reachable = getReachable(unit);
    const valid = reachable.filter(t => !t.isEnemy && !hasFriendlyUnit(t.x, t.y, unit.owner));

    if (valid.length === 0) return null;

    let best = null;
    let bestScore = -Infinity;
    const def = UNIT_DEFINITIONS[unit.type];
    const isRanged = def.range > 1;

    for (const tile of valid) {
        let score = evaluatePosition(unit, tile.x, tile.y, player, isRanged);
        score -= tile.cost * 1.5;

        if (score > bestScore) {
            bestScore = score;
            best = tile;
        }
    }

    return best;
}

function evaluatePosition(unit, x, y, player, isRanged) {
    let score = 0;
    const def = UNIT_DEFINITIONS[unit.type];

    // Defend blockaded cities
    for (const city of gameState.cities) {
        if (city.owner !== player.id) continue;
        const dist = Utils.manhattanDistance(x, y, city.x, city.y);
        if (isCityBlockaded(city, player.id)) {
            if (dist === 0) score += 200;
            else if (dist <= 1) score += 120;
            else if (dist <= 3) score += 80;
        }
    }

    // Move toward priority targets
    const target = findPriorityTarget(unit, player, x, y);
    if (target) {
        if (target.dist === 0) {
            score += target.priority === 1 ? 300 : target.priority === 2 ? 250 : target.priority === 3 ? 200 : 150;
        } else if (target.dist < target.distance) {
            score += target.priority === 1 ? 80 : target.priority === 2 ? 70 : target.priority === 3 ? 60 : 50;
        }
    }

    // Ruins
    if (gameState.ruins.some(r => r.x === x && r.y === y)) score += 90;

    // City capture
    const city = gameState.cities.find(c => c.x === x && c.y === y);
    if (city && city.owner !== player.id) {
        const defenders = gameState.units.filter(u => u.x === x && u.y === y && u.owner !== player.id && u.hp > 0);
        if (city.owner === null && defenders.length === 0) score += 150;
        else if (defenders.length === 0) score += 120;
        else score += 30;
    }

    // Terrain
    const terrain = gameState.terrain[y]?.[x];
    if (terrain === TERRAIN.MOUNTAINS) score += 12;
    else if (terrain === TERRAIN.FOREST) score += 8;

    // Ranged positioning
    if (isRanged) {
        for (const other of gameState.units) {
            if (other.owner === player.id || other.hp <= 0) continue;
            const dist = Utils.chebyshevDistance(x, y, other.x, other.y);
            if (dist <= def.range && dist > 1) score += 25;
        }
    }

    // Approach neutral cities
    let nearestNeutral = null;
    let minDist = Infinity;
    for (const c of gameState.cities) {
        if (c.owner !== null) continue;
        const d = Utils.manhattanDistance(unit.x, unit.y, c.x, c.y);
        if (d < minDist) {
            minDist = d;
            nearestNeutral = c;
        }
    }
    if (nearestNeutral) {
        const d = Utils.manhattanDistance(x, y, nearestNeutral.x, nearestNeutral.y);
        if (d < Utils.manhattanDistance(unit.x, unit.y, nearestNeutral.x, nearestNeutral.y)) {
            score += 35;
        }
        if (d === 0) score += 100;
    }

    return score;
}

function findPriorityTarget(unit, player, fromX, fromY) {
    fromX = fromX ?? unit.x;
    fromY = fromY ?? unit.y;
    const maxDist = UNIT_DEFINITIONS[unit.type].movement * 3;

    let best = null;
    let bestScore = -Infinity;

    // Neutral cities
    for (const city of gameState.cities) {
        if (city.owner !== null) continue;
        const dist = Utils.manhattanDistance(fromX, fromY, city.x, city.y);
        if (dist > maxDist * 2) continue;
        const defenders = gameState.units.filter(u => u.x === city.x && u.y === city.y && u.hp > 0);
        if (defenders.length === 0) {
            const score = 1000 - dist * 2;
            if (score > bestScore) {
                bestScore = score;
                best = { x: city.x, y: city.y, priority: 1, dist, distance: dist };
            }
        }
    }

    // Enemy empty cities
    for (const city of gameState.cities) {
        if (city.owner === null || city.owner === player.id) continue;
        const dist = Utils.manhattanDistance(fromX, fromY, city.x, city.y);
        if (dist > maxDist * 2) continue;
        const defenders = gameState.units.filter(u => u.x === city.x && u.y === city.y && u.owner !== player.id && u.hp > 0);
        if (defenders.length === 0) {
            const score = 800 - dist * 5;
            if (score > bestScore) {
                bestScore = score;
                best = { x: city.x, y: city.y, priority: 2, dist, distance: dist };
            }
        }
    }

    // Ruins
    for (const ruin of gameState.ruins) {
        const dist = Utils.manhattanDistance(fromX, fromY, ruin.x, ruin.y);
        if (dist > maxDist * 2) continue;
        const score = 600 - dist * 8;
        if (score > bestScore) {
            bestScore = score;
            best = { x: ruin.x, y: ruin.y, priority: 3, dist, distance: dist };
        }
    }

    // Defended cities
    for (const city of gameState.cities) {
        if (city.owner === null || city.owner === player.id) continue;
        const dist = Utils.manhattanDistance(fromX, fromY, city.x, city.y);
        if (dist > maxDist) continue;
        const defenders = gameState.units.filter(u => u.x === city.x && u.y === city.y && u.owner !== player.id && u.hp > 0);
        if (defenders.length > 0) {
            const score = 200 - dist * 8;
            if (score > bestScore) {
                bestScore = score;
                best = { x: city.x, y: city.y, priority: 4, dist, distance: dist };
            }
        }
    }

    return best;
}

function getReachable(unit) {
    const def = UNIT_DEFINITIONS[unit.type];
    const reachable = [];

    for (let dy = -def.movement; dy <= def.movement; dy++) {
        for (let dx = -def.movement; dx <= def.movement; dx++) {
            const x = unit.x + dx;
            const y = unit.y + dy;
            if (x < 0 || x >= gameState.mapWidth || y < 0 || y >= gameState.mapHeight) continue;
            const dist = Utils.chebyshevDistance(unit.x, unit.y, x, y);
            if (dist > def.movement) continue;
            const terrain = gameState.terrain[y]?.[x];
            if (!terrain || !def.canEnter.includes(terrain)) continue;
            const isEnemy = gameState.units.some(u => u.x === x && u.y === y && u.owner !== unit.owner && u.hp > 0);
            reachable.push({ x, y, cost: dist, isEnemy });
        }
    }

    return reachable;
}

function hasFriendlyUnit(x, y, ownerId) {
    return gameState.units.some(u => u.x === x && u.y === y && u.owner === ownerId && u.hp > 0);
}

function countAdjacentEnemies(x, y, ownerId) {
    let count = 0;
    for (const u of gameState.units) {
        if (u.owner === ownerId || u.hp <= 0) continue;
        if (Utils.chebyshevDistance(x, y, u.x, u.y) === 1) count++;
    }
    return count;
}

function isCityBlockaded(city, playerId) {
    return gameState.units.some(u => u.owner !== playerId && u.hp > 0 && Utils.chebyshevDistance(city.x, city.y, u.x, u.y) === 1);
}

async function handleHeroActions(player) {
    const hero = gameState.units.find(u => u.owner === player.id && u.isHero && u.hp > 0 && !u.hasMoved);
    if (!hero) return;

    const reachable = getReachable(hero);
    const valid = reachable.filter(t => !t.isEnemy && !hasFriendlyUnit(t.x, t.y, player.id));

    // Neutral city
    const neutralCity = valid.find(t => {
        const city = gameState.cities.find(c => c.x === t.x && c.y === t.y);
        if (!city || city.owner !== null) return false;
        return !gameState.units.some(u => u.x === t.x && u.y === t.y && u.hp > 0);
    });
    if (neutralCity) {
        sendAction({ type: 'move', unitId: hero.id, toX: neutralCity.x, toY: neutralCity.y });
        await waitForResult();
        return;
    }

    // Enemy empty city
    const enemyCity = valid.find(t => {
        const city = gameState.cities.find(c => c.x === t.x && c.y === t.y);
        if (!city || city.owner === null || city.owner === player.id) return false;
        return !gameState.units.some(u => u.x === t.x && u.y === t.y && u.owner !== player.id && u.hp > 0);
    });
    if (enemyCity) {
        sendAction({ type: 'move', unitId: hero.id, toX: enemyCity.x, toY: enemyCity.y });
        await waitForResult();
        return;
    }

    // Ruin
    const ruin = valid.find(t => gameState.ruins.some(r => r.x === t.x && r.y === t.y));
    if (ruin) {
        sendAction({ type: 'move', unitId: hero.id, toX: ruin.x, toY: ruin.y });
        await waitForResult();
        return;
    }

    // Strategic move
    if (valid.length > 0) {
        const move = findBestMove(hero, player);
        if (move) {
            sendAction({ type: 'move', unitId: hero.id, toX: move.x, toY: move.y });
            await waitForResult();
            await delay(actionDelay);
        }
    }
}

async function handleProduction(player) {
    for (const city of gameState.cities) {
        if (city.owner !== player.id) continue;
        if (isCityBlockaded(city, player.id)) continue;

        const gold = player.gold;
        if (gold < 10) continue;

        let unitType = null;
        const hero = gameState.units.find(u => u.owner === player.id && u.isHero);

        if (!hero && gold >= 50) {
            unitType = 'HERO';
        } else {
            const comp = analyzeEnemy();
            if (comp.CAVALRY >= 2 && gold >= 20) unitType = 'HEAVY_INFANTRY';
            else if (comp.HEAVY_INFANTRY >= 2 && gold >= 15) unitType = 'ARCHER';
            else if (comp.DRAGON >= 1 && gold >= 40) unitType = 'CATAPULT';
            else if (gold >= 30) unitType = 'CAVALRY';
            else if (gold >= 20) unitType = 'HEAVY_INFANTRY';
            else if (gold >= 15) unitType = 'ARCHER';
            else if (gold >= 10) unitType = 'LIGHT_INFANTRY';
        }

        if (unitType) {
            const cost = UNIT_DEFINITIONS[unitType].cost;
            if (player.gold >= cost) {
                sendAction({ type: 'produce', cityId: city.id, unitType });
                await waitForResult();
            await delay(actionDelay);
                player.gold -= cost;
            }
        }
    }
}

function analyzeEnemy() {
    const comp = {};
    for (const type of Object.keys(UNIT_DEFINITIONS)) comp[type] = 0;
    for (const u of gameState.units) {
        if (u.owner === gameState.currentPlayerIndex || u.hp <= 0 || u.isHero) continue;
        comp[u.type] = (comp[u.type] || 0) + 1;
    }
    return comp;
}

function findUnit(id) {
    return gameState.units.find(u => u.id === id);
}

self.postMessage({ type: 'ready' });
