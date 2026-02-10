import { Utils, Events } from '../utils.js';
import { MovementSystem } from './MovementSystem.js';
import { CombatSystem } from './CombatSystem.js';
import { UNIT_DEFINITIONS, CITY_INCOME, TERRAIN } from '../constants.js';

/**
 * AI system for controlling bot players
 * Implements turn-based strategy with tactical decisions
 */
export class AISystem {
    constructor(game) {
        this.game = game;
        this.map = game.map;
        this.players = game.players;
        this.isRunning = false;
        this.thinkDelay = 500; // Delay between AI actions for visibility

        // Track which units attacked which targets this turn (for focus fire)
        this.focusFireMemory = new Map();
    }

    /**
     * Execute AI turn for the current player
     */
    async playTurn() {
        if (this.isRunning) return;
        this.isRunning = true;

        const player = this.players[this.game.state.currentPlayerIndex];
        if (!player.isAI || !player.isAlive) {
            this.isRunning = false;
            return;
        }

        // Reset focus fire tracking for new turn
        this.focusFireMemory.clear();

        Events.emit('ai:turnStarted', { player });

        try {
            // Phase 1: Handle city production
            await this.handleProduction(player);

            // Phase 2: Retreat damaged units first (before combat)
            await this.handleRetreats(player);

            // Phase 3: Move and attack with units (sorted by tactical priority)
            await this.handleUnitActions(player);

            // Phase 4: Hero actions (explore ruins, capture cities)
            await this.handleHeroActions(player);

            // Small delay before ending turn
            await this.delay(this.thinkDelay);

        } catch (error) {
            console.error('AI error:', error);
        }

        this.isRunning = false;
        Events.emit('ai:turnEnded', { player });

        // End turn
        this.game.endTurn();
    }

    /**
     * Handle city production decisions with context-aware strategy
     */
    async handleProduction(player) {
        // Calculate economic situation
        const income = this.calculateIncome(player);
        const turn = this.game.turn || 1;
        const isLateGame = turn > 20;

        // Get enemy army composition for counter-strategy
        const enemyComposition = this.analyzeEnemyComposition(player);
        const mapHasWater = this.analyzeMapTerrain();

        for (const city of player.cities) {
            // Check if city is blockaded - cannot produce if enemy adjacent
            if (this.map.isCityBlockaded(city, player.id)) {
                Events.emit('ai:blockaded', { player, city });
                continue; // Skip this city, it's under siege
            }

            // Decide what to build based on comprehensive analysis
            const unitType = this.decideProduction(player, income, isLateGame, enemyComposition, mapHasWater, city);
            const cost = UNIT_DEFINITIONS[unitType].cost;

            if (player.gold >= cost) {
                Events.emit('ai:producing', { player, city, unitType });
                this.game.produceUnit(city, unitType);
                await this.delay(300);
            }
        }
    }

    /**
     * Calculate player's income per turn
     */
    calculateIncome(player) {
        let income = 0;
        for (const city of player.cities) {
            const size = city.population >= 20 ? 'large' : city.population >= 10 ? 'medium' : 'small';
            income += CITY_INCOME[size];
        }
        return income;
    }

    /**
     * Analyze enemy army composition across all opponents
     */
    analyzeEnemyComposition(player) {
        const composition = {};
        for (const type of Object.keys(UNIT_DEFINITIONS)) {
            composition[type] = 0;
        }

        for (const otherUnit of this.map.units) {
            if (otherUnit.owner !== player.id && otherUnit.hp > 0 && !otherUnit.isHero) {
                composition[otherUnit.type] = (composition[otherUnit.type] || 0) + 1;
            }
        }

        return composition;
    }

    /**
     * Analyze if map has significant water areas
     */
    analyzeMapTerrain() {
        let waterTiles = 0;
        for (let y = 0; y < this.map.height; y++) {
            for (let x = 0; x < this.map.width; x++) {
                if (this.map.getTerrain(x, y) === TERRAIN.WATER) {
                    waterTiles++;
                }
            }
        }
        const totalTiles = this.map.width * this.map.height;
        return waterTiles / totalTiles > 0.15; // More than 15% water
    }

    /**
     * Decide which unit to produce based on comprehensive strategic analysis
     */
    decideProduction(player, income, isLateGame, enemyComposition, mapHasWater, city) {
        const units = player.units;
        const gold = player.gold;

        // Count unit types
        const counts = {};
        for (const type of Object.keys(UNIT_DEFINITIONS)) {
            counts[type] = units.filter(u => u.type === type && u.hp > 0).length;
        }

        // Reserve gold for hero replacement if hero is dead
        const hero = player.getHero();
        if (!hero && gold < 50) {
            // Save up for strong units - but if we have plenty gold, spend
            if (gold >= 40) return 'CATAPULT';
            if (gold >= 30) return 'CAVALRY';
            if (gold >= 20) return 'HEAVY_INFANTRY';
            return 'LIGHT_INFANTRY';
        }

        // Priority 1: Counter-strategy against enemy composition
        const enemyCavalry = enemyComposition.CAVALRY || 0;
        const enemyArchers = enemyComposition.ARCHER || 0;
        const enemyHeavy = enemyComposition.HEAVY_INFANTRY || 0;
        const enemyDragons = enemyComposition.DRAGON || 0;

        // If enemy has many cavalry (fast but low defense), build heavy infantry
        if (enemyCavalry >= 2 && counts.HEAVY_INFANTRY < 3 && gold >= 20) {
            return 'HEAVY_INFANTRY';
        }

        // If enemy has many heavy infantry, build archers (kite them)
        if (enemyHeavy >= 2 && counts.ARCHER < 3 && gold >= 15) {
            return 'ARCHER';
        }

        // If enemy has dragons, build archers or catapults for ranged damage
        if (enemyDragons >= 1 && gold >= 40) {
            return 'CATAPULT';
        }

        // Priority 2: Map-based decisions
        if (mapHasWater && counts.DRAGON < 1 && gold >= 100) {
            return 'DRAGON'; // Dragons can fly over water
        }

        // Priority 3: Early game expansion
        if (!isLateGame) {
            // Need cheap fast units for expansion
            if (counts.LIGHT_INFANTRY < 2 && gold >= 10) {
                return 'LIGHT_INFANTRY';
            }
            if (counts.CAVALRY < 1 && gold >= 30) {
                return 'CAVALRY';
            }
        }

        // Priority 4: Balanced army composition with role-based targets
        const targetRanged = 2;    // Archers + Catapults
        const targetCavalry = 2;   // Fast units
        const targetHeavy = 2;     // Tough units

        const currentRanged = counts.ARCHER + counts.CATAPULT;
        const currentCavalry = counts.CAVALRY;
        const currentHeavy = counts.HEAVY_INFANTRY + counts.DRAGON;

        if (currentRanged < targetRanged && gold >= 15) {
            if (gold >= 40 && counts.CATAPULT < 1) return 'CATAPULT';
            return 'ARCHER';
        }

        if (currentCavalry < targetCavalry && gold >= 30) {
            return 'CAVALRY';
        }

        if (currentHeavy < targetHeavy) {
            if (gold >= 100 && counts.DRAGON < 1) return 'DRAGON';
            if (gold >= 20) return 'HEAVY_INFANTRY';
        }

        // Priority 5: Economic-based late game
        if (isLateGame || income >= 30) {
            if (gold >= 100) return 'DRAGON';
            if (gold >= 40) return 'CATAPULT';
            if (gold >= 30) return 'CAVALRY';
        }

        // Priority 6: Emergency reserves
        if (counts.LIGHT_INFANTRY < 1 && gold >= 10) {
            return 'LIGHT_INFANTRY';
        }

        // Fallback based on available gold
        if (gold >= 40) return 'CATAPULT';
        if (gold >= 30) return 'CAVALRY';
        if (gold >= 20) return 'HEAVY_INFANTRY';
        if (gold >= 15) return 'ARCHER';
        return 'LIGHT_INFANTRY';
    }

    /**
     * Handle retreats for damaged units before combat
     */
    async handleRetreats(player) {
        const damagedUnits = player.units.filter(u => {
            if (u.hp <= 0 || u.isHero) return false;
            const def = UNIT_DEFINITIONS[u.type];
            const healthPercent = u.hp / def.hp;
            return healthPercent < 0.3 && !u.hasMoved; // Less than 30% HP
        });

        for (const unit of damagedUnits) {
            // Find safe retreat position
            const retreatTarget = this.findRetreatTarget(unit, player);
            if (retreatTarget) {
                this.game.moveUnit(unit, retreatTarget.x, retreatTarget.y);
                await this.delay(300);
            }
        }
    }

    /**
     * Find safe position to retreat to (towards own cities, away from enemies)
     */
    findRetreatTarget(unit, player) {
        const reachable = MovementSystem.getReachableTiles(unit, this.map);

        // Filter valid retreat positions
        const validMoves = reachable.filter(t => {
            // Can't stop on friendly units
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            if (existingUnit) return false;

            // Don't retreat into enemies
            if (t.isEnemy) return false;

            return true;
        });

        if (validMoves.length === 0) return null;

        // Find nearest owned city for safety
        let nearestCity = null;
        let minCityDist = Infinity;
        for (const city of player.cities) {
            const dist = Utils.manhattanDistance(unit.x, unit.y, city.x, city.y);
            if (dist < minCityDist) {
                minCityDist = dist;
                nearestCity = city;
            }
        }

        // Score retreat positions
        const scoredMoves = validMoves.map(tile => {
            let score = 0;

            // Prefer movement towards own cities
            if (nearestCity) {
                const distBefore = Utils.manhattanDistance(unit.x, unit.y, nearestCity.x, nearestCity.y);
                const distAfter = Utils.manhattanDistance(tile.x, tile.y, nearestCity.x, nearestCity.y);
                if (distAfter < distBefore) {
                    score += 50; // Strong bonus for moving towards safety
                }
            }

            // Avoid enemies - penalize tiles near enemies
            for (const otherUnit of this.map.units) {
                if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                    const enemyDist = Utils.manhattanDistance(tile.x, tile.y, otherUnit.x, otherUnit.y);
                    if (enemyDist <= 2) {
                        score -= 30; // Penalty for being near enemies
                    }
                    if (enemyDist <= 1) {
                        score -= 100; // Heavy penalty for adjacency
                    }
                }
            }

            // Prefer defensive terrain
            const terrain = this.map.getTerrain(tile.x, tile.y);
            if (terrain === TERRAIN.MOUNTAINS) score += 20;
            if (terrain === TERRAIN.FOREST) score += 10;

            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
    }

    /**
     * Handle all unit movements and attacks with tactical priority
     */
    async handleUnitActions(player) {
        // Sort units by tactical priority for action order
        const units = player.units
            .filter(u => u.hp > 0 && !u.isHero)
            .sort((a, b) => this.prioritizeUnitForAction(b, player) - this.prioritizeUnitForAction(a, player));

        for (const unit of units) {
            if (unit.hasMoved && unit.hasAttacked) continue;

            await this.handleSingleUnit(unit, player);
            await this.delay(200);
        }
    }

    /**
     * Prioritize units for action order
     * Ranged units first (to position safely), then fast units, then strong units
     */
    prioritizeUnitForAction(unit, player) {
        const def = UNIT_DEFINITIONS[unit.type];
        let priority = def.attack + def.defense + def.hp / 10;

        // Ranged units act first to get into position
        if (def.range > 1) priority += 50;

        // Fast units act early for flanking
        if (def.movement >= 4) priority += 20;

        // Damaged units act later (let healthy ones engage first)
        const healthPercent = unit.hp / def.hp;
        priority -= (1 - healthPercent) * 30;

        return priority;
    }

    /**
     * Handle a single unit's turn with advanced tactics
     */
    async handleSingleUnit(unit, player) {
        const def = UNIT_DEFINITIONS[unit.type];
        const isRangedUnit = def.range > 1;

        // Get available targets from current position
        const currentAttackTargets = MovementSystem.getAttackTargets(unit, this.map);

        // Find best attack target considering damage efficiency
        let bestCurrentAttack = null;
        if (currentAttackTargets.length > 0 && !unit.hasAttacked) {
            let bestScore = -Infinity;
            for (const target of currentAttackTargets) {
                const enemyStack = this.map.getStack(target.x, target.y);
                if (enemyStack) {
                    const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y, player);
                    if (score > bestScore) {
                        bestScore = score;
                        bestCurrentAttack = { target, enemyStack, score };
                    }
                }
            }
        }

        // For ranged units: prioritize kiting (attack from current position, then move away)
        if (isRangedUnit && bestCurrentAttack && !unit.hasAttacked) {
            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestCurrentAttack.target.x, bestCurrentAttack.target.y) > 1;
            this.game.performAttack(unit, bestCurrentAttack.enemyStack, isRanged);
            await this.delay(400);

            // After ranged attack, try to move to safer position (kiting)
            if (!unit.hasMoved) {
                const kiteTarget = this.findKitePosition(unit, bestCurrentAttack.target, player);
                if (kiteTarget) {
                    this.game.moveUnit(unit, kiteTarget.x, kiteTarget.y);
                    await this.delay(300);
                }
            }
            return;
        }

        // For melee units: attack from current position if good target
        if (bestCurrentAttack && !unit.hasAttacked && bestCurrentAttack.score > 0) {
            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestCurrentAttack.target.x, bestCurrentAttack.target.y) > 1;
            this.game.performAttack(unit, bestCurrentAttack.enemyStack, isRanged);
            await this.delay(400);

            // After melee attack, limited movement options
            if (!unit.hasMoved) {
                // Can still move if we haven't
                const retreatTarget = this.findRetreatAfterAttack(unit, player);
                if (retreatTarget) {
                    this.game.moveUnit(unit, retreatTarget.x, retreatTarget.y);
                    await this.delay(300);
                }
            }
            return;
        }

        // No good attack from current position - try to move and attack
        if (!unit.hasMoved) {
            const reachable = MovementSystem.getReachableTiles(unit, this.map);

            // Filter valid moves (respect 1 unit per tile)
            const validMoves = reachable.filter(t => {
                const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
                return !existingUnit && !t.isEnemy;
            });

            // Find best move considering tactical situation
            const moveTarget = this.findBestMoveTarget(unit, validMoves, player, isRangedUnit);

            if (moveTarget) {
                this.game.moveUnit(unit, moveTarget.x, moveTarget.y);
                await this.delay(300);

                // After moving, check for attack targets from new position
                if (!unit.hasAttacked) {
                    const newAttackTargets = MovementSystem.getAttackTargets(unit, this.map);
                    let bestPostMoveAttack = null;
                    let bestScore = -Infinity;

                    for (const target of newAttackTargets) {
                        const enemyStack = this.map.getStack(target.x, target.y);
                        if (enemyStack) {
                            const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y, player);
                            if (score > bestScore) {
                                bestScore = score;
                                bestPostMoveAttack = { target, enemyStack };
                            }
                        }
                    }

                    if (bestPostMoveAttack && bestScore > 0) {
                        const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestPostMoveAttack.target.x, bestPostMoveAttack.target.y) > 1;
                        this.game.performAttack(unit, bestPostMoveAttack.enemyStack, isRanged);
                        await this.delay(400);
                    }
                }
            }
        }
    }

    /**
     * Find position to kite to after ranged attack (away from enemy, towards safety)
     */
    findKitePosition(unit, attackTarget, player) {
        const reachable = MovementSystem.getReachableTiles(unit, this.map);

        const validMoves = reachable.filter(t => {
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            return !existingUnit && !t.isEnemy;
        });

        if (validMoves.length === 0) return null;

        const scoredMoves = validMoves.map(tile => {
            let score = 0;

            // Move away from the target we just attacked
            const distFromTarget = Utils.chebyshevDistance(tile.x, tile.y, attackTarget.x, attackTarget.y);
            score += distFromTarget * 20; // Bonus for distance from attacked enemy

            // But stay within attack range for next turn
            const def = UNIT_DEFINITIONS[unit.type];
            if (distFromTarget <= def.range && distFromTarget > 1) {
                score += 30; // Sweet spot: in range but not adjacent
            }

            // Avoid other enemies
            for (const otherUnit of this.map.units) {
                if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                    const enemyDist = Utils.chebyshevDistance(tile.x, tile.y, otherUnit.x, otherUnit.y);
                    if (enemyDist <= 1) {
                        score -= 50; // Avoid adjacency to any enemy
                    }
                }
            }

            // Prefer defensive terrain
            const terrain = this.map.getTerrain(tile.x, tile.y);
            if (terrain === TERRAIN.MOUNTAINS) score += 15;
            if (terrain === TERRAIN.FOREST) score += 8;

            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
    }

    /**
     * Find position to retreat to after melee attack (defensive position)
     */
    findRetreatAfterAttack(unit, player) {
        const reachable = MovementSystem.getReachableTiles(unit, this.map);

        const validMoves = reachable.filter(t => {
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            return !existingUnit && !t.isEnemy;
        });

        if (validMoves.length === 0) return null;

        // If unit is damaged, try to move away from enemies
        const def = UNIT_DEFINITIONS[unit.type];
        const healthPercent = unit.hp / def.hp;

        if (healthPercent > 0.6) {
            return null; // Healthy units stay in combat
        }

        return this.findRetreatTarget(unit, player);
    }

    /**
     * Evaluate an attack target with advanced scoring (higher score = better target)
     */
    evaluateAttackTarget(unit, enemyStack, targetX, targetY, player) {
        const enemy = enemyStack.getCombatUnit();
        if (!enemy) return -1000;

        let score = 0;
        const enemyDef = UNIT_DEFINITIONS[enemy.type];
        const myDef = UNIT_DEFINITIONS[unit.type];

        // Priority based on enemy value (high-value targets)
        if (enemy.isHero) score += 100;
        if (enemy.type === 'CATAPULT') score += 50;
        if (enemy.type === 'DRAGON') score += 80;

        // Focus fire: bonus for damaged enemies (easier kills)
        const damagePercent = 1 - (enemy.hp / enemyDef.hp);
        score += damagePercent * 40;

        // Check if we can kill it
        const terrainBonus = this.map.getDefenseBonus(targetX, targetY);
        const damage = CombatSystem.calculateDamage(unit, enemy, terrainBonus);
        if (damage >= enemy.hp) {
            score += 60; // Kill bonus

            // Extra bonus for efficient kills (we take no damage)
            score += 20;
        }

        // DAMAGE EFFICIENCY: Calculate expected retaliation damage
        const myTerrainBonus = this.map.getDefenseBonus(unit.x, unit.y);
        const retaliationDamage = CombatSystem.calculateDamage(enemy, unit, myTerrainBonus);
        const damageToMe = Math.min(unit.hp, retaliationDamage);

        // Prefer fights where we deal more damage than we take
        const damageEfficiency = damage - damageToMe;
        score += damageEfficiency * 2;

        // Avoid suicidal attacks (where we would die)
        if (damageToMe >= unit.hp) {
            // Only attack if we can kill and it's a high-value target
            if (damage < enemy.hp || (!enemy.isHero && enemy.type !== 'DRAGON' && enemy.type !== 'CATAPULT')) {
                score -= 200; // Strong penalty for suicidal attacks
            }
        }

        // City capture bonus
        const city = this.map.getCity(targetX, targetY);
        if (city && city.owner !== unit.owner) {
            // Check if we can actually capture (kill all defenders)
            if (damage >= enemy.hp) {
                const remaining = this.map.getUnitsAt(targetX, targetY).filter(u => u.owner !== unit.owner && u.hp > 0);
                if (remaining.length <= 1) {
                    score += 50; // Capture bonus
                }
            }
        }

        // Range efficiency: for ranged units, prefer staying at range
        const distance = Utils.chebyshevDistance(unit.x, unit.y, targetX, targetY);
        if (myDef.range > 1) {
            if (distance > 1 && distance <= myDef.range) {
                score += 25; // Bonus for ranged attacks
            }
            if (distance === 1) {
                score -= 30; // Penalty for melee with ranged unit
            }
        }

        // Focus fire coordination: bonus if other units are targeting this enemy
        const enemyKey = `${targetX},${targetY}`;
        const focusCount = this.focusFireMemory.get(enemyKey) || 0;
        if (focusCount > 0) {
            score += 15; // Bonus for focusing fire
        }

        // Record that we're considering attacking this target
        this.focusFireMemory.set(enemyKey, focusCount + 1);

        return score;
    }

    /**
     * Find the best strategic move when no immediate attacks available
     */
    findBestMoveTarget(unit, validMoves, player, isRangedUnit) {
        if (validMoves.length === 0) return null;

        const def = UNIT_DEFINITIONS[unit.type];
        const isFastUnit = def.movement >= 4;

        const scoredMoves = validMoves.map(tile => {
            let score = this.evaluateStrategicMove(unit, tile.x, tile.y, player, isRangedUnit, isFastUnit);
            // Prefer closer moves (less wasted movement)
            score -= tile.cost * 1.5;
            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
    }

    /**
     * Evaluate strategic value of a position
     */
    evaluateStrategicMove(unit, x, y, player, isRangedUnit, isFastUnit) {
        let score = 0;
        const def = UNIT_DEFINITIONS[unit.type];

        // 1. CITY DEFENSE: Protect own cities
        for (const city of player.cities) {
            const distToCity = Utils.manhattanDistance(x, y, city.x, city.y);
            if (distToCity <= 2) {
                // Check if city is threatened
                const hasEnemyNearby = this.hasEnemyNear(city.x, city.y, player);
                if (hasEnemyNearby) {
                    score += 40; // High priority for defending threatened cities
                } else {
                    score += 15; // Moderate for general city defense
                }
            }
        }

        // 2. CITY CAPTURE: Approach undefended neutral/enemy cities
        for (const city of this.map.cities) {
            if (city.owner === player.id) continue;

            const distToCity = Utils.manhattanDistance(x, y, city.x, city.y);
            const distBefore = Utils.manhattanDistance(unit.x, unit.y, city.x, city.y);

            // Check if city is undefended
            const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.owner !== player.id && u.hp > 0);

            if (defenders.length === 0 && distAfter < distBefore) {
                score += 35; // Good to approach empty cities
            }

            // If we're close enough to capture
            if (distToCity === 0) {
                if (city.owner === null) {
                    score += 50; // Capture neutral city
                } else if (defenders.length === 0) {
                    score += 45; // Capture enemy empty city
                }
            }
        }

        // 3. FLANKING: Fast units should flank enemies
        if (isFastUnit) {
            const nearestEnemy = this.findNearestEnemy(unit, player);
            if (nearestEnemy) {
                const distBefore = Utils.manhattanDistance(unit.x, unit.y, nearestEnemy.x, nearestEnemy.y);
                const distAfter = Utils.manhattanDistance(x, y, nearestEnemy.x, nearestEnemy.y);

                // Fast units want to approach from behind/side (get closer but not necessarily adjacent)
                if (distAfter < distBefore && distAfter > 1) {
                    score += 20;
                }

                // Bonus for getting behind enemy lines (near their cities)
                if (nearestEnemy.owner !== null) {
                    const enemyCities = this.map.cities.filter(c => c.owner === nearestEnemy.owner);
                    for (const enemyCity of enemyCities) {
                        const distToEnemyCity = Utils.manhattanDistance(x, y, enemyCity.x, enemyCity.y);
                        if (distToEnemyCity < Utils.manhattanDistance(unit.x, unit.y, enemyCity.x, enemyCity.y)) {
                            score += 15; // Approaching enemy territory
                        }
                    }
                }
            }
        }

        // 4. RANGED POSITIONING: Ranged units want line of sight to enemies
        if (isRangedUnit) {
            for (const otherUnit of this.map.units) {
                if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                    const dist = Utils.chebyshevDistance(x, y, otherUnit.x, otherUnit.y);
                    if (dist <= def.range && dist > 1) {
                        score += 25; // Can attack from here
                    }
                }
            }

            // Ranged units want to be behind friendly units
            let friendlyUnitsNearby = 0;
            for (const friendly of player.units) {
                if (friendly !== unit && friendly.hp > 0) {
                    const friendlyDist = Utils.chebyshevDistance(x, y, friendly.x, friendly.y);
                    if (friendlyDist <= 2) {
                        friendlyUnitsNearby++;
                    }
                }
            }
            score += friendlyUnitsNearby * 10; // Bonus for being near friendly units
        }

        // 5. DEFENSIVE TERRAIN: Use terrain bonuses effectively
        const terrain = this.map.getTerrain(x, y);
        if (terrain === TERRAIN.MOUNTAINS) {
            score += 12; // Best defensive bonus
        } else if (terrain === TERRAIN.FOREST) {
            score += 8;
        }

        // Ranged units especially like hills (mountains)
        if (isRangedUnit && terrain === TERRAIN.MOUNTAINS) {
            score += 10;
        }

        // 6. AVOID DANGER: Don't move adjacent to strong enemies unless ready to fight
        for (const otherUnit of this.map.units) {
            if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                const enemyDist = Utils.chebyshevDistance(x, y, otherUnit.x, otherUnit.y);
                const enemyDef = UNIT_DEFINITIONS[otherUnit.type];

                if (enemyDist === 1) {
                    // Adjacent to enemy - check if we can win the fight
                    const terrainBonus = this.map.getDefenseBonus(x, y);
                    const myDamage = CombatSystem.calculateDamage(unit, otherUnit, 0); // Enemy terrain bonus handled elsewhere
                    const enemyDamage = CombatSystem.calculateDamage(otherUnit, unit, terrainBonus);

                    // If we'd lose the exchange, penalty
                    if (enemyDamage > myDamage && !unit.isHero) {
                        score -= 30;
                    } else {
                        score += 10; // We can win, good position
                    }
                }
            }
        }

        // 7. EXPLORATION: Heroes and fast units explore ruins
        if (unit.isHero || isFastUnit) {
            const ruin = this.map.getRuin(x, y);
            if (ruin) {
                score += 60;
            }
        }

        return score;
    }

    /**
     * Check if there's an enemy near a position
     */
    hasEnemyNear(x, y, player) {
        for (const unit of this.map.units) {
            if (unit.owner !== player.id && unit.hp > 0) {
                const dist = Utils.manhattanDistance(x, y, unit.x, unit.y);
                if (dist <= 3) return true;
            }
        }
        return false;
    }

    /**
     * Prioritize units for action order (stronger units first)
     * @deprecated Use prioritizeUnitForAction instead
     */
    prioritizeUnit(unit) {
        const def = UNIT_DEFINITIONS[unit.type];
        return def.attack + def.defense + def.hp / 10;
    }

    /**
     * Handle hero-specific actions with care for survival
     */
    async handleHeroActions(player) {
        const hero = player.getHero();
        if (!hero || hero.hasMoved) return;

        const reachable = MovementSystem.getReachableTiles(hero, this.map);

        // Filter out tiles occupied by friendly units
        const validMoves = reachable.filter(t => {
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            return !existingUnit;
        });

        // Check if hero would be in danger at each position
        const safeMoves = validMoves.filter(t => {
            if (t.isEnemy) return false;

            // Check if moving here would put us adjacent to enemies
            for (const unit of this.map.units) {
                if (unit.owner !== player.id && unit.hp > 0) {
                    const dist = Utils.chebyshevDistance(t.x, t.y, unit.x, unit.y);
                    if (dist === 1) {
                        // Would be adjacent to enemy - check if we could die
                        const terrainBonus = this.map.getDefenseBonus(t.x, t.y);
                        const enemyDamage = CombatSystem.calculateDamage(unit, hero, terrainBonus);
                        if (enemyDamage >= hero.hp) {
                            return false; // Too dangerous
                        }
                    }
                }
            }
            return true;
        });

        // Priority 1: Explore ruins (if safe)
        const ruin = safeMoves.find(t => this.map.getRuin(t.x, t.y));
        if (ruin) {
            this.game.moveUnit(hero, ruin.x, ruin.y);
            await this.delay(300);
            return;
        }

        // Priority 2: Capture undefended cities (if safe)
        const cityTile = safeMoves.find(t => {
            const city = this.map.getCity(t.x, t.y);
            if (!city || city.owner === player.id) return false;
            const defenders = this.map.getUnitsAt(t.x, t.y).filter(u => u.owner !== player.id && u.hp > 0);
            return defenders.length === 0;
        });

        if (cityTile) {
            this.game.moveUnit(hero, cityTile.x, cityTile.y);
            await this.delay(300);
            return;
        }

        // Priority 3: Stay near friendly units for protection
        const supportiveMove = this.findSupportivePosition(hero, safeMoves, player);
        if (supportiveMove) {
            this.game.moveUnit(hero, supportiveMove.x, supportiveMove.y);
            await this.delay(300);
            return;
        }

        // Priority 4: Strategic move (only if safe)
        if (safeMoves.length > 0) {
            const moveTarget = this.findBestMoveTarget(hero, safeMoves, player, false);
            if (moveTarget) {
                this.game.moveUnit(hero, moveTarget.x, moveTarget.y);
                await this.delay(300);
            }
        }
    }

    /**
     * Find position near friendly units for hero support
     */
    findSupportivePosition(hero, validMoves, player) {
        if (validMoves.length === 0) return null;

        const scoredMoves = validMoves.map(tile => {
            let score = 0;

            // Count nearby friendly units
            let friendlyCount = 0;
            for (const unit of player.units) {
                if (unit !== hero && unit.hp > 0) {
                    const dist = Utils.chebyshevDistance(tile.x, tile.y, unit.x, unit.y);
                    if (dist <= 2) {
                        friendlyCount++;
                        score += 20; // Bonus for each nearby friendly unit
                    }
                }
            }

            // Bonus for being near cities
            for (const city of player.cities) {
                const dist = Utils.manhattanDistance(tile.x, tile.y, city.x, city.y);
                if (dist <= 2) {
                    score += 15;
                }
            }

            // Defensive terrain bonus
            const terrain = this.map.getTerrain(tile.x, tile.y);
            if (terrain === TERRAIN.MOUNTAINS) score += 10;
            if (terrain === TERRAIN.FOREST) score += 5;

            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
    }

    /**
     * Find nearest enemy unit
     */
    findNearestEnemy(unit, player) {
        let nearest = null;
        let minDist = Infinity;

        for (const otherUnit of this.map.units) {
            if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                const dist = Utils.manhattanDistance(unit.x, unit.y, otherUnit.x, otherUnit.y);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = otherUnit;
                }
            }
        }

        return nearest;
    }

    /**
     * Find nearest neutral city
     */
    findNearestNeutralCity(unit) {
        let nearest = null;
        let minDist = Infinity;

        for (const city of this.map.cities) {
            if (city.owner === null) {
                const dist = Utils.manhattanDistance(unit.x, unit.y, city.x, city.y);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = city;
                }
            }
        }

        return nearest;
    }

    /**
     * Utility: delay for async operations
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
